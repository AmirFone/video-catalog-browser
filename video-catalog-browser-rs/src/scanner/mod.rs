// Scanner module - recursive directory scanning and video processing
mod directory;
mod fingerprint;

#[allow(unused_imports)]
pub use directory::*;
pub use fingerprint::*;

use std::path::Path;
use std::sync::{Arc, Mutex};
use anyhow::Result;
use walkdir::WalkDir;
use rayon::prelude::*;

use crate::app::Video;
use crate::db::Database;

/// Supported video extensions
const VIDEO_EXTENSIONS: &[&str] = &[".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"];

/// Directories to skip
const SKIP_DIRS: &[&str] = &["node_modules", "__MACOSX", ".Trash", ".Spotlight-V100", ".fseventsd", ".vcb-data"];

/// Scan progress information
#[derive(Debug, Clone, Default)]
pub struct ScanProgress {
    pub status: ScanStatus,
    pub total_videos: usize,
    pub videos_processed: usize,
    pub videos_skipped: usize,
    pub current_file: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub enum ScanStatus {
    #[default]
    Counting,
    Scanning,
    Complete,
    #[allow(dead_code)]
    Error,
}

/// Scan result type
pub type ScanResult = Result<Vec<Video>>;

/// Intermediate processing result (no DB operations)
struct ProcessedVideo {
    video: Video,
    fingerprint: String,
    directory: String,
}

/// Scan a directory for video files
pub fn scan_directory(path: &Path, progress: Arc<Mutex<Option<ScanProgress>>>) -> ScanResult {
    // Phase 1: Count videos
    {
        let mut prog = progress.lock().unwrap();
        if let Some(p) = prog.as_mut() {
            p.status = ScanStatus::Counting;
        }
    }

    let video_paths: Vec<_> = find_video_files(path);
    let total_videos = video_paths.len();

    {
        let mut prog = progress.lock().unwrap();
        if let Some(p) = prog.as_mut() {
            p.total_videos = total_videos;
            p.status = ScanStatus::Scanning;
        }
    }

    // Set up database
    let vcb_data_dir = path.join(".vcb-data");
    std::fs::create_dir_all(&vcb_data_dir)?;

    let db_path = vcb_data_dir.join("catalog.db");
    let db = Database::open(&db_path)?;

    // Create proxies directory
    let proxies_dir = vcb_data_dir.join("proxies");
    std::fs::create_dir_all(&proxies_dir)?;

    // Get existing fingerprints from DB to skip already processed files
    let existing_hashes: std::collections::HashSet<String> =
        crate::db::get_all_file_hashes(db.conn())
            .unwrap_or_default()
            .into_iter()
            .collect();

    // Phase 2: Process videos in parallel (no DB operations here)
    let processed_count = Arc::new(Mutex::new(0usize));
    let skipped_count = Arc::new(Mutex::new(0usize));
    let proxies_dir_arc = Arc::new(proxies_dir);

    let processed_videos: Vec<ProcessedVideo> = video_paths
        .par_iter()
        .filter_map(|video_path| {
            // Update progress with current file
            {
                let mut prog = progress.lock().unwrap();
                if let Some(p) = prog.as_mut() {
                    p.current_file = Some(video_path.file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default());
                }
            }

            // Calculate fingerprint
            let fingerprint = match get_file_fingerprint(video_path) {
                Ok(fp) => fp,
                Err(_) => return None,
            };

            // Check if already processed (using in-memory set)
            if existing_hashes.contains(&fingerprint) {
                let mut skipped = skipped_count.lock().unwrap();
                *skipped += 1;

                let mut prog = progress.lock().unwrap();
                if let Some(p) = prog.as_mut() {
                    p.videos_skipped = *skipped;
                }

                return None;
            }

            // Get video metadata
            let metadata = match get_video_metadata(video_path) {
                Ok(m) => m,
                Err(_) => return None,
            };

            // Generate thumbnail
            let thumb_hash = &fingerprint[..16];
            let thumbnail_path = proxies_dir_arc.join(format!("{}_thumb.jpg", thumb_hash));
            let _ = generate_thumbnail(video_path, &thumbnail_path, metadata.duration);

            // Generate sprite sheet
            let sprite_path = proxies_dir_arc.join(format!("{}_sprite.jpg", thumb_hash));
            let has_sprite = generate_sprite_sheet(video_path, &sprite_path, metadata.duration).is_ok();

            let video = Video {
                id: generate_id(&video_path.display().to_string()),
                file_path: video_path.clone(),
                file_name: video_path.file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default(),
                file_size: metadata.file_size,
                duration: metadata.duration,
                width: metadata.width,
                height: metadata.height,
                created_at: metadata.created_at,
                _has_thumbnail: thumbnail_path.exists(),
                has_sprite,
                thumbnail_path: if thumbnail_path.exists() { Some(thumbnail_path) } else { None },
                sprite_path: if has_sprite { Some(sprite_path) } else { None },
                is_favorite: false,
            };

            let directory = video_path.parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default();

            // Update processed count
            {
                let mut processed = processed_count.lock().unwrap();
                *processed += 1;

                let mut prog = progress.lock().unwrap();
                if let Some(p) = prog.as_mut() {
                    p.videos_processed = *processed;
                }
            }

            Some(ProcessedVideo {
                video,
                fingerprint,
                directory,
            })
        })
        .collect();

    // Phase 3: Insert into database sequentially (DB is not thread-safe)
    for pv in &processed_videos {
        let _ = crate::db::insert_video(db.conn(), &pv.video, &pv.fingerprint, &pv.directory);
    }

    // Mark complete
    {
        let mut prog = progress.lock().unwrap();
        if let Some(p) = prog.as_mut() {
            p.status = ScanStatus::Complete;
        }
    }

    // Load all videos from database (includes previously scanned)
    let all_videos = crate::db::get_all_videos(db.conn())?;

    Ok(all_videos)
}

/// Find all video files in a directory
fn find_video_files(path: &Path) -> Vec<std::path::PathBuf> {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            // Skip hidden files and directories
            if name.starts_with('.') {
                return false;
            }
            // Skip known non-video directories
            if entry.file_type().is_dir() {
                return !SKIP_DIRS.contains(&name.as_ref());
            }
            true
        })
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            if entry.file_type().is_file() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                VIDEO_EXTENSIONS.iter().any(|ext| name.ends_with(ext))
            } else {
                false
            }
        })
        .map(|entry| entry.into_path())
        .collect()
}

/// Generate a deterministic ID from file path
fn generate_id(file_path: &str) -> String {
    let mut hash: i64 = 0;
    for c in file_path.chars() {
        hash = ((hash << 5).wrapping_sub(hash)).wrapping_add(c as i64);
        hash &= hash;
    }
    format!("{:x}", hash.unsigned_abs())
}

/// Video metadata
#[derive(Debug)]
pub struct VideoMetadata {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: u64,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Get video metadata using ffprobe
fn get_video_metadata(path: &Path) -> Result<VideoMetadata> {
    use std::process::Command;

    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()?;

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)?;

    // Extract duration from format
    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    // Extract video stream info
    let video_stream = json["streams"]
        .as_array()
        .and_then(|streams| {
            streams.iter().find(|s| s["codec_type"] == "video")
        });

    let width = video_stream
        .and_then(|s| s["width"].as_u64())
        .map(|w| w as u32);

    let height = video_stream
        .and_then(|s| s["height"].as_u64())
        .map(|h| h as u32);

    // Get file size and creation time
    let metadata = std::fs::metadata(path)?;
    let file_size = metadata.len();

    let created_at = metadata.created()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t))
        .unwrap_or_else(|_| chrono::Utc::now());

    Ok(VideoMetadata {
        duration,
        width,
        height,
        file_size,
        created_at,
    })
}

/// Generate thumbnail using ffmpeg
fn generate_thumbnail(input: &Path, output: &Path, duration: f64) -> Result<()> {
    use std::process::Command;

    // Seek to 10% of duration or 5 seconds, whichever is less
    let timestamp = (duration * 0.1).min(5.0);

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-ss", &timestamp.to_string(),
            "-i",
        ])
        .arg(input)
        .args([
            "-vframes", "1",
            "-vf", "scale=384:-1",
            "-q:v", "5",
        ])
        .arg(output)
        .output()?;

    if status.status.success() {
        Ok(())
    } else {
        anyhow::bail!("FFmpeg thumbnail generation failed")
    }
}

/// Generate sprite sheet using ffmpeg
fn generate_sprite_sheet(input: &Path, output: &Path, duration: f64) -> Result<()> {
    use std::process::Command;

    // Calculate sprite configuration based on duration
    let (fps, cols, rows) = if duration <= 60.0 {
        ("fps=1", 10, (duration.ceil() as usize / 10).max(1).min(6))
    } else if duration <= 300.0 {
        ("fps=1/3", 10, 10)
    } else if duration <= 1800.0 {
        ("fps=1/12", 15, 10)
    } else {
        ("fps=1/30", 20, 10)
    };

    let filter = format!(
        "{},scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile={}x{}",
        fps, cols, rows
    );

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
        ])
        .arg(input)
        .args([
            "-vf", &filter,
            "-frames:v", "1",
            "-q:v", "5",
        ])
        .arg(output)
        .output()?;

    if status.status.success() {
        Ok(())
    } else {
        anyhow::bail!("FFmpeg sprite sheet generation failed")
    }
}
