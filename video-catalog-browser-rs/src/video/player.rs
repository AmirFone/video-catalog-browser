// Video player for in-app playback using ffmpeg-next
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use anyhow::Result;

extern crate ffmpeg_next as ffmpeg;

/// Video frame data
#[derive(Clone)]
pub struct VideoFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub _timestamp: f64,
}

/// Player state shared between threads
#[derive(Clone)]
pub struct PlayerState {
    pub playing: bool,
    pub current_time: f64,
    pub duration: f64,
    pub seek_requested: Option<f64>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            playing: false,
            current_time: 0.0,
            duration: 0.0,
            seek_requested: None,
        }
    }
}

/// Command sent to the decoder thread
enum PlayerCommand {
    Play,
    Pause,
    Seek(f64),
    Stop,
}

/// Video player with background decoding thread
pub struct VideoPlayer {
    _path: PathBuf,
    state: Arc<Mutex<PlayerState>>,
    frame_receiver: Receiver<VideoFrame>,
    command_sender: Sender<PlayerCommand>,
    decoder_thread: Option<JoinHandle<()>>,
    pub _width: u32,
    pub _height: u32,
}

impl VideoPlayer {
    /// Create a new video player for the given file
    pub fn new(path: &Path) -> Result<Self> {
        ffmpeg::init()?;

        // Open file to get metadata
        let format_ctx = ffmpeg::format::input(path)?;
        let stream = format_ctx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or_else(|| anyhow::anyhow!("No video stream found"))?;

        let context_decoder = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;
        let decoder = context_decoder.decoder().video()?;

        let width = decoder.width();
        let height = decoder.height();

        let duration = if format_ctx.duration() > 0 {
            format_ctx.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE)
        } else {
            0.0
        };

        // Create shared state
        let state = Arc::new(Mutex::new(PlayerState {
            playing: false,
            current_time: 0.0,
            duration,
            seek_requested: None,
        }));

        // Create channels
        let (frame_sender, frame_receiver) = mpsc::channel();
        let (command_sender, command_receiver) = mpsc::channel();

        // Spawn decoder thread
        let path_clone = path.to_path_buf();
        let state_clone = Arc::clone(&state);
        let decoder_thread = thread::spawn(move || {
            decoder_thread_main(path_clone, state_clone, frame_sender, command_receiver);
        });

        Ok(Self {
            _path: path.to_path_buf(),
            state,
            frame_receiver,
            command_sender,
            decoder_thread: Some(decoder_thread),
            _width: width,
            _height: height,
        })
    }

    /// Start playback
    pub fn play(&mut self) {
        {
            let mut state = self.state.lock().unwrap();
            state.playing = true;
        }
        let _ = self.command_sender.send(PlayerCommand::Play);
    }

    /// Pause playback
    pub fn pause(&mut self) {
        {
            let mut state = self.state.lock().unwrap();
            state.playing = false;
        }
        let _ = self.command_sender.send(PlayerCommand::Pause);
    }

    /// Toggle play/pause
    pub fn toggle_playback(&mut self) {
        let playing = {
            let state = self.state.lock().unwrap();
            state.playing
        };
        if playing {
            self.pause();
        } else {
            self.play();
        }
    }

    /// Check if currently playing
    pub fn is_playing(&self) -> bool {
        self.state.lock().unwrap().playing
    }

    /// Seek to a position (0.0 to 1.0)
    pub fn seek(&mut self, position: f64) {
        let duration = self.duration();
        let target_time = position.clamp(0.0, 1.0) * duration;
        {
            let mut state = self.state.lock().unwrap();
            state.seek_requested = Some(target_time);
        }
        let _ = self.command_sender.send(PlayerCommand::Seek(target_time));
    }

    /// Get current position as fraction (0.0 to 1.0)
    pub fn current_position(&self) -> f64 {
        let state = self.state.lock().unwrap();
        if state.duration > 0.0 {
            state.current_time / state.duration
        } else {
            0.0
        }
    }

    /// Get current time in seconds
    pub fn current_time(&self) -> f64 {
        self.state.lock().unwrap().current_time
    }

    /// Get total duration in seconds
    pub fn duration(&self) -> f64 {
        self.state.lock().unwrap().duration
    }

    /// Get the next frame if available (non-blocking)
    pub fn get_frame(&mut self) -> Option<VideoFrame> {
        self.frame_receiver.try_recv().ok()
    }

    /// Stop the player and clean up
    pub fn stop(&mut self) {
        let _ = self.command_sender.send(PlayerCommand::Stop);
        if let Some(handle) = self.decoder_thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for VideoPlayer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Main decoder thread function
fn decoder_thread_main(
    path: PathBuf,
    state: Arc<Mutex<PlayerState>>,
    frame_sender: Sender<VideoFrame>,
    command_receiver: Receiver<PlayerCommand>,
) {
    let Ok(mut format_ctx) = ffmpeg::format::input(&path) else {
        return;
    };

    let Some(stream) = format_ctx.streams().best(ffmpeg::media::Type::Video) else {
        return;
    };

    let video_stream_index = stream.index();
    let time_base = stream.time_base();
    let time_base_f64 = f64::from(time_base.numerator()) / f64::from(time_base.denominator());

    let Ok(context_decoder) = ffmpeg::codec::context::Context::from_parameters(stream.parameters()) else {
        return;
    };

    let Ok(mut decoder) = context_decoder.decoder().video() else {
        return;
    };

    let width = decoder.width();
    let height = decoder.height();

    // Scale to reasonable display size (max 1280 width)
    let display_width = width.min(1280);
    let display_height = (height as f32 * (display_width as f32 / width as f32)) as u32;

    let Ok(mut scaler) = ffmpeg::software::scaling::Context::get(
        decoder.format(),
        width,
        height,
        ffmpeg::format::Pixel::RGBA,
        display_width,
        display_height,
        ffmpeg::software::scaling::Flags::BILINEAR,
    ) else {
        return;
    };

    let mut playing = false;
    let mut last_frame_time = Instant::now();
    let target_frame_duration = Duration::from_secs_f64(1.0 / 30.0); // 30 FPS target

    let mut decoded_frame = ffmpeg::frame::Video::empty();
    let mut scaled_frame = ffmpeg::frame::Video::empty();

    loop {
        // Check for commands (non-blocking)
        while let Ok(cmd) = command_receiver.try_recv() {
            match cmd {
                PlayerCommand::Play => playing = true,
                PlayerCommand::Pause => playing = false,
                PlayerCommand::Stop => return,
                PlayerCommand::Seek(target_time) => {
                    let timestamp = (target_time * f64::from(ffmpeg::ffi::AV_TIME_BASE)) as i64;
                    let _ = format_ctx.seek(timestamp, ..timestamp);
                    decoder.flush();

                    // Update state
                    let mut s = state.lock().unwrap();
                    s.current_time = target_time;
                    s.seek_requested = None;
                }
            }
        }

        if !playing {
            thread::sleep(Duration::from_millis(16));
            continue;
        }

        // Rate limiting
        let elapsed = last_frame_time.elapsed();
        if elapsed < target_frame_duration {
            thread::sleep(target_frame_duration - elapsed);
        }
        last_frame_time = Instant::now();

        // Decode next frame
        let mut got_frame = false;
        for (stream, packet) in format_ctx.packets() {
            if stream.index() != video_stream_index {
                continue;
            }

            if decoder.send_packet(&packet).is_err() {
                continue;
            }

            while decoder.receive_frame(&mut decoded_frame).is_ok() {
                if scaler.run(&decoded_frame, &mut scaled_frame).is_ok() {
                    // Extract frame data
                    let data = scaled_frame.data(0);
                    let stride = scaled_frame.stride(0);

                    let mut rgba_data = Vec::with_capacity((display_width * display_height * 4) as usize);
                    for y in 0..display_height as usize {
                        let row_start = y * stride;
                        let row_end = row_start + (display_width * 4) as usize;
                        rgba_data.extend_from_slice(&data[row_start..row_end]);
                    }

                    // Calculate timestamp
                    let pts = decoded_frame.pts().unwrap_or(0);
                    let timestamp = pts as f64 * time_base_f64;

                    // Update state
                    {
                        let mut s = state.lock().unwrap();
                        s.current_time = timestamp;
                    }

                    // Send frame
                    let frame = VideoFrame {
                        data: rgba_data,
                        width: display_width,
                        height: display_height,
                        _timestamp: timestamp,
                    };

                    if frame_sender.send(frame).is_err() {
                        return; // Receiver dropped, stop thread
                    }

                    got_frame = true;
                    break;
                }
            }

            if got_frame {
                break;
            }
        }

        // If we didn't get a frame, we might be at the end
        if !got_frame {
            // Loop or stop at end
            let mut s = state.lock().unwrap();
            s.playing = false;
            playing = false;
        }
    }
}
