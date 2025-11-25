// Background hover decoder - moves FFmpeg decoding off the UI thread
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};

use super::decoder::VideoDecoder;

/// Request sent to the background decode thread
enum HoverRequest {
    /// Decode a frame at the given position (0.0 to 1.0)
    Decode { path: PathBuf, position: f32 },
    /// Stop the background thread
    Stop,
}

/// Response from the background decode thread
pub struct HoverFrame {
    pub video_path: PathBuf,
    pub _position: f32,
    pub rgba_data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Background hover decoder that never blocks the UI thread
///
/// Architecture:
/// - UI sends decode requests via channel (non-blocking)
/// - Background thread processes requests and decodes frames
/// - UI polls for results via try_recv (non-blocking)
pub struct HoverDecoder {
    request_tx: Sender<HoverRequest>,
    response_rx: Receiver<HoverFrame>,
    thread_handle: Option<JoinHandle<()>>,
    /// Cached preview size from last successful decode
    preview_size: (u32, u32),
    /// Track what we've requested to avoid duplicate requests
    last_requested: Option<(PathBuf, f32)>,
}

impl HoverDecoder {
    /// Create a new background hover decoder
    pub fn new() -> Self {
        let (request_tx, request_rx) = mpsc::channel();
        let (response_tx, response_rx) = mpsc::channel();

        let thread_handle = thread::spawn(move || {
            decode_thread_main(request_rx, response_tx);
        });

        Self {
            request_tx,
            response_rx,
            thread_handle: Some(thread_handle),
            preview_size: (320, 180), // Default, will be updated on first decode
            last_requested: None,
        }
    }

    /// Request a frame decode (non-blocking)
    /// Returns immediately - use poll_frame() to get the result
    pub fn request_frame(&mut self, path: &PathBuf, position: f32) {
        // Avoid sending duplicate requests for the same position
        let key = (path.clone(), (position * 100.0).round() as i32);
        if let Some((last_path, last_pos)) = &self.last_requested {
            let last_key = (last_path.clone(), (*last_pos * 100.0).round() as i32);
            if key.0 == last_key.0 && key.1 == last_key.1 {
                return; // Already requested this exact frame
            }
        }

        self.last_requested = Some((path.clone(), position));
        let _ = self.request_tx.send(HoverRequest::Decode {
            path: path.clone(),
            position,
        });
    }

    /// Poll for a decoded frame (non-blocking)
    /// Returns None if no frame is ready yet
    pub fn poll_frame(&mut self) -> Option<HoverFrame> {
        match self.response_rx.try_recv() {
            Ok(frame) => {
                // Update cached preview size
                self.preview_size = (frame.width, frame.height);
                Some(frame)
            }
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => None,
        }
    }

    /// Get the preview dimensions (from last decoded frame or default)
    #[allow(dead_code)]
    pub fn preview_size(&self) -> (u32, u32) {
        self.preview_size
    }

    /// Clear any pending requests (e.g., when hover ends)
    pub fn clear_pending(&mut self) {
        self.last_requested = None;
        // Drain any pending responses
        while self.response_rx.try_recv().is_ok() {}
    }
}

impl Default for HoverDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for HoverDecoder {
    fn drop(&mut self) {
        // Signal thread to stop
        let _ = self.request_tx.send(HoverRequest::Stop);

        // Wait for thread to finish
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}

/// Background thread main loop
fn decode_thread_main(
    request_rx: Receiver<HoverRequest>,
    response_tx: Sender<HoverFrame>,
) {
    let mut current_decoder: Option<(PathBuf, VideoDecoder)> = None;

    loop {
        // Block waiting for next request
        let request = match request_rx.recv() {
            Ok(req) => req,
            Err(_) => break, // Channel closed
        };

        match request {
            HoverRequest::Stop => break,

            HoverRequest::Decode { path, position } => {
                // Check if we need to open a new video
                let needs_new_decoder = match &current_decoder {
                    Some((current_path, _)) => current_path != &path,
                    None => true,
                };

                if needs_new_decoder {
                    // Open new video
                    match VideoDecoder::open(&path) {
                        Ok(decoder) => {
                            current_decoder = Some((path.clone(), decoder));
                        }
                        Err(_) => {
                            current_decoder = None;
                            continue;
                        }
                    }
                }

                // Decode the frame
                if let Some((video_path, decoder)) = &mut current_decoder {
                    let (width, height) = decoder.preview_size();

                    if let Some(rgba_data) = decoder.seek_and_decode(position) {
                        let frame = HoverFrame {
                            video_path: video_path.clone(),
                            _position: position,
                            rgba_data,
                            width,
                            height,
                        };

                        // Send response (ignore errors - UI may have moved on)
                        let _ = response_tx.send(frame);
                    }
                }
            }
        }
    }
}
