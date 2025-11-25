// Database module
mod schema;
mod video_repo;

#[allow(unused_imports)]
pub use schema::*;
pub use video_repo::*;

use rusqlite::{Connection, Result};
use std::path::Path;

/// Database wrapper
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open or create database at the given path
    pub fn open(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // Enable WAL mode for better concurrent read performance
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = Self { conn };
        db.initialize_schema()?;

        Ok(db)
    }

    /// Initialize database schema
    fn initialize_schema(&self) -> Result<()> {
        self.conn.execute_batch(SCHEMA)?;
        Ok(())
    }

    /// Get a reference to the connection
    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

/// SQL schema matching the Node.js app
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    file_path TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    duration REAL NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL,
    directory TEXT NOT NULL,
    has_proxy INTEGER DEFAULT 0,
    has_sprite INTEGER DEFAULT 0,
    proxy_path TEXT,
    sprite_path TEXT,
    thumbnail_path TEXT,
    file_hash TEXT,
    file_mtime TEXT,
    scanned_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_directory ON videos(directory);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_videos_duration ON videos(duration);
CREATE INDEX IF NOT EXISTS idx_videos_file_hash ON videos(file_hash);

CREATE TABLE IF NOT EXISTS selections (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    is_favorite INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_selections_video_id ON selections(video_id);

CREATE TABLE IF NOT EXISTS proxy_queue (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'queued',
    progress INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_proxy_queue_status ON proxy_queue(status);

CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    root_path TEXT NOT NULL,
    status TEXT DEFAULT 'scanning',
    videos_found INTEGER DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;
