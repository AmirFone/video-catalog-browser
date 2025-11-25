// Video decoder for hover scrubbing using ffmpeg-next
use std::path::Path;
use anyhow::Result;

extern crate ffmpeg_next as ffmpeg;

/// Video decoder for extracting frames at specific positions
pub struct VideoDecoder {
    format_ctx: ffmpeg::format::context::Input,
    video_stream_index: usize,
    decoder: ffmpeg::decoder::Video,
    scaler: ffmpeg::software::scaling::Context,
    pub duration: f64,
    pub _width: u32,
    pub _height: u32,
    preview_width: u32,
    preview_height: u32,
}

impl VideoDecoder {
    /// Open a video file for decoding
    pub fn open(path: &Path) -> Result<Self> {
        ffmpeg::init()?;

        let format_ctx = ffmpeg::format::input(path)?;

        let stream = format_ctx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or_else(|| anyhow::anyhow!("No video stream found"))?;

        let video_stream_index = stream.index();

        let context_decoder = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;
        let decoder = context_decoder.decoder().video()?;

        let width = decoder.width();
        let height = decoder.height();

        // Calculate preview dimensions (max 320px width, maintain aspect ratio)
        let preview_width = 320u32;
        let preview_height = (height as f32 * (preview_width as f32 / width as f32)) as u32;

        // Create scaler to convert to RGBA at preview size
        let scaler = ffmpeg::software::scaling::Context::get(
            decoder.format(),
            width,
            height,
            ffmpeg::format::Pixel::RGBA,
            preview_width,
            preview_height,
            ffmpeg::software::scaling::Flags::BILINEAR,
        )?;

        // Get duration in seconds
        let duration = if format_ctx.duration() > 0 {
            format_ctx.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE)
        } else {
            // Try to get duration from stream
            let time_base = stream.time_base();
            if stream.duration() > 0 {
                stream.duration() as f64 * f64::from(time_base.numerator()) / f64::from(time_base.denominator())
            } else {
                0.0
            }
        };

        Ok(Self {
            format_ctx,
            video_stream_index,
            decoder,
            scaler,
            duration,
            _width: width,
            _height: height,
            preview_width,
            preview_height,
        })
    }

    /// Get preview dimensions
    pub fn preview_size(&self) -> (u32, u32) {
        (self.preview_width, self.preview_height)
    }

    /// Seek to a position (0.0 to 1.0) and decode a frame
    /// Returns RGBA pixel data
    pub fn seek_and_decode(&mut self, position: f32) -> Option<Vec<u8>> {
        let position = position.clamp(0.0, 1.0);
        let target_time = self.duration * position as f64;

        // Convert to timestamp in AV_TIME_BASE units
        let timestamp = (target_time * f64::from(ffmpeg::ffi::AV_TIME_BASE)) as i64;

        // Seek to the position
        if self.format_ctx.seek(timestamp, ..timestamp).is_err() {
            // Try seeking backwards if forward seek fails
            let _ = self.format_ctx.seek(0, ..timestamp);
        }

        // Flush decoder buffers after seek
        self.decoder.flush();

        // Decode frames until we get one
        self.decode_next_frame()
    }

    /// Decode the next frame from the current position
    fn decode_next_frame(&mut self) -> Option<Vec<u8>> {
        let mut decoded_frame = ffmpeg::frame::Video::empty();
        let mut scaled_frame = ffmpeg::frame::Video::empty();

        // Iterate through packets
        for (stream, packet) in self.format_ctx.packets() {
            if stream.index() != self.video_stream_index {
                continue;
            }

            // Send packet to decoder
            if self.decoder.send_packet(&packet).is_err() {
                continue;
            }

            // Try to receive decoded frame
            while self.decoder.receive_frame(&mut decoded_frame).is_ok() {
                // Scale and convert to RGBA
                if self.scaler.run(&decoded_frame, &mut scaled_frame).is_ok() {
                    // Extract RGBA data
                    let data = scaled_frame.data(0);
                    let stride = scaled_frame.stride(0);
                    let height = self.preview_height as usize;
                    let width = self.preview_width as usize;

                    // Copy data accounting for stride
                    let mut rgba_data = Vec::with_capacity(width * height * 4);
                    for y in 0..height {
                        let row_start = y * stride;
                        let row_end = row_start + width * 4;
                        rgba_data.extend_from_slice(&data[row_start..row_end]);
                    }

                    return Some(rgba_data);
                }
            }
        }

        None
    }
}
