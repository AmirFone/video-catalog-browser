// Video repository - CRUD operations for videos table
use rusqlite::{params, Connection, Result};
use std::path::PathBuf;

use crate::app::Video;

/// Insert a video into the database
pub fn insert_video(conn: &Connection, video: &Video, file_hash: &str, directory: &str) -> Result<()> {
    conn.execute(
        r#"
        INSERT OR REPLACE INTO videos (
            id, file_path, file_name, file_size, duration,
            width, height, created_at, directory,
            has_sprite, thumbnail_path, sprite_path,
            file_hash, file_mtime, scanned_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        "#,
        params![
            video.id,
            video.file_path.display().to_string(),
            video.file_name,
            video.file_size as i64,
            video.duration,
            video.width.map(|w| w as i64),
            video.height.map(|h| h as i64),
            video.created_at.to_rfc3339(),
            directory,
            video.has_sprite as i64,
            video.thumbnail_path.as_ref().map(|p| p.display().to_string()),
            video.sprite_path.as_ref().map(|p| p.display().to_string()),
            file_hash,
            video.created_at.to_rfc3339(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

/// Get all videos from the database
pub fn get_all_videos(conn: &Connection) -> Result<Vec<Video>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            v.id, v.file_path, v.file_name, v.file_size, v.duration,
            v.width, v.height, v.created_at, v.has_sprite,
            v.thumbnail_path, v.sprite_path,
            COALESCE(s.is_favorite, 0) as is_favorite
        FROM videos v
        LEFT JOIN selections s ON v.id = s.video_id
        ORDER BY v.created_at DESC
        "#,
    )?;

    let videos = stmt.query_map([], |row| {
        let file_path: String = row.get(1)?;
        let thumbnail_path: Option<String> = row.get(9)?;
        let sprite_path: Option<String> = row.get(10)?;
        let created_at_str: String = row.get(7)?;

        Ok(Video {
            id: row.get(0)?,
            file_path: PathBuf::from(file_path),
            file_name: row.get(2)?,
            file_size: row.get::<_, i64>(3)? as u64,
            duration: row.get(4)?,
            width: row.get::<_, Option<i64>>(5)?.map(|w| w as u32),
            height: row.get::<_, Option<i64>>(6)?.map(|h| h as u32),
            created_at: chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now()),
            _has_thumbnail: thumbnail_path.is_some(),
            has_sprite: row.get::<_, i64>(8)? != 0,
            thumbnail_path: thumbnail_path.map(PathBuf::from),
            sprite_path: sprite_path.map(PathBuf::from),
            is_favorite: row.get::<_, i64>(11)? != 0,
        })
    })?;

    videos.collect()
}

/// Check if a video exists by file hash
#[allow(dead_code)]
pub fn get_video_by_hash(conn: &Connection, file_hash: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT id FROM videos WHERE file_hash = ?1")?;
    let mut rows = stmt.query(params![file_hash])?;

    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

/// Get all file hashes from the database
pub fn get_all_file_hashes(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT file_hash FROM videos WHERE file_hash IS NOT NULL")?;
    let hashes = stmt.query_map([], |row| row.get(0))?;
    hashes.collect()
}

/// Toggle favorite status for a video
pub fn toggle_favorite(conn: &Connection, video_id: &str, is_favorite: bool) -> Result<()> {
    // First try to update existing record
    let updated = conn.execute(
        "UPDATE selections SET is_favorite = ?2 WHERE video_id = ?1",
        params![video_id, is_favorite as i64],
    )?;

    // If no existing record, insert new one
    if updated == 0 {
        conn.execute(
            r#"
            INSERT INTO selections (id, video_id, is_favorite, notes, created_at)
            VALUES (?1, ?2, ?3, '', datetime('now'))
            "#,
            params![
                format!("sel_{}", video_id),
                video_id,
                is_favorite as i64
            ],
        )?;
    }
    Ok(())
}
