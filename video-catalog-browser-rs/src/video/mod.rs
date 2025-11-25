// Video processing module
// Contains: metadata extraction, thumbnail generation, sprite sheets, proxy generation

mod decoder;
mod hover_decoder;
mod player;

#[allow(unused_imports)]
pub use decoder::VideoDecoder;
pub use hover_decoder::HoverDecoder;
#[allow(unused_imports)]
pub use hover_decoder::HoverFrame;
#[allow(unused_imports)]
pub use player::{VideoPlayer, VideoFrame, PlayerState};
