// GPU Texture cache with LRU eviction
use std::path::PathBuf;
use std::num::NonZeroUsize;
use lru::LruCache;
use egui::{TextureHandle, ColorImage, Context};

/// Texture cache for thumbnail images
/// Uses LRU eviction to manage memory
#[allow(dead_code)]
pub struct TextureCache {
    /// LRU cache of texture handles (video_id -> TextureHandle)
    cache: LruCache<String, TextureHandle>,
}

#[allow(dead_code)]
impl TextureCache {
    /// Create a new texture cache with the given maximum size
    pub fn new(max_size: usize) -> Self {
        Self {
            cache: LruCache::new(NonZeroUsize::new(max_size).unwrap()),
        }
    }

    /// Get a texture from the cache, loading it if not present
    pub fn get_or_load(&mut self, ctx: &Context, id: &str, path: &PathBuf) -> Option<&TextureHandle> {
        if !self.cache.contains(id) {
            // Load from disk
            let img = image::open(path).ok()?.to_rgba8();
            let (w, h) = img.dimensions();
            let color_image = ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &img);
            let handle = ctx.load_texture(id, color_image, egui::TextureOptions::LINEAR);
            self.cache.put(id.to_string(), handle);
        }
        self.cache.get(id)
    }

    /// Get a texture from the cache (without loading)
    pub fn get(&mut self, id: &str) -> Option<&TextureHandle> {
        self.cache.get(id)
    }

    /// Check if a texture is in the cache
    pub fn contains(&self, id: &str) -> bool {
        self.cache.contains(id)
    }

    /// Insert a texture into the cache
    pub fn insert(&mut self, id: String, texture: TextureHandle) {
        self.cache.put(id, texture);
    }

    /// Load a texture from raw RGBA data
    pub fn load_from_rgba(&mut self, ctx: &Context, id: &str, data: &[u8], width: u32, height: u32) -> &TextureHandle {
        let color_image = ColorImage::from_rgba_unmultiplied([width as usize, height as usize], data);
        let handle = ctx.load_texture(id, color_image, egui::TextureOptions::LINEAR);
        self.cache.put(id.to_string(), handle);
        self.cache.get(id).unwrap()
    }

    /// Get the number of cached textures
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Check if the cache is empty
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    /// Clear the cache
    pub fn clear(&mut self) {
        self.cache.clear();
    }
}
