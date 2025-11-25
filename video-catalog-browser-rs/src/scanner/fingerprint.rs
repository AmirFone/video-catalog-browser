// File fingerprinting for change detection
use std::path::Path;
use std::fs::File;
use std::io::Read;
use anyhow::Result;
use md5::{Md5, Digest};

/// Generate a fingerprint for a file
/// Uses: MD5(first 64KB + file size + modification time)
/// This matches the Node.js implementation for compatibility
pub fn get_file_fingerprint(path: &Path) -> Result<String> {
    let metadata = std::fs::metadata(path)?;
    let file_size = metadata.len();
    let mtime = metadata.modified()?;

    // Read first 64KB
    let mut file = File::open(path)?;
    let mut buffer = vec![0u8; 65536]; // 64KB
    let bytes_read = file.read(&mut buffer)?;
    buffer.truncate(bytes_read);

    // Create hash
    let mut hasher = Md5::new();
    hasher.update(&buffer);
    hasher.update(file_size.to_string().as_bytes());
    hasher.update(format!("{:?}", mtime).as_bytes());

    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}
