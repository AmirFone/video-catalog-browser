// App-level settings - persisted across sessions
use directories::ProjectDirs;
use rusqlite::{params, Connection, Result};
use std::path::PathBuf;

/// Library history entry
#[derive(Debug, Clone)]
pub struct LibraryEntry {
    pub id: i64,
    pub path: PathBuf,
    pub name: String,
    pub video_count: i64,
    pub last_opened: String,
    #[allow(dead_code)]
    pub thumbnail_path: Option<PathBuf>,
}

/// App-level settings manager
pub struct AppSettings {
    conn: Connection,
}

impl AppSettings {
    /// Open or create the app settings database
    pub fn open() -> Result<Self> {
        let settings_path = Self::get_settings_path();

        // Create parent directory if needed
        if let Some(parent) = settings_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(&settings_path)?;

        // Enable WAL mode
        conn.pragma_update(None, "journal_mode", "WAL")?;

        let settings = Self { conn };
        settings.initialize_schema()?;

        Ok(settings)
    }

    /// Get the path to the settings database
    fn get_settings_path() -> PathBuf {
        if let Some(proj_dirs) = ProjectDirs::from("com", "videoteam", "VideoCatalogBrowser") {
            proj_dirs.config_dir().join("settings.db")
        } else {
            // Fallback to home directory
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".vcb-settings.db")
        }
    }

    /// Initialize database schema
    fn initialize_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS library_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                video_count INTEGER DEFAULT 0,
                last_opened TEXT NOT NULL,
                thumbnail_path TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_library_history_last_opened
                ON library_history(last_opened DESC);
            "#,
        )?;
        Ok(())
    }

    /// Get a setting value
    pub fn get(&self, key: &str) -> Option<String> {
        let mut stmt = self.conn
            .prepare("SELECT value FROM app_settings WHERE key = ?1")
            .ok()?;

        stmt.query_row(params![key], |row| row.get(0)).ok()
    }

    /// Set a setting value
    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    /// Get last sort option
    pub fn get_sort_option(&self) -> Option<String> {
        self.get("last_sort_option")
    }

    /// Set last sort option
    pub fn set_sort_option(&self, value: &str) -> Result<()> {
        self.set("last_sort_option", value)
    }

    /// Get last view mode
    pub fn get_view_mode(&self) -> Option<String> {
        self.get("last_view_mode")
    }

    /// Set last view mode
    pub fn set_view_mode(&self, value: &str) -> Result<()> {
        self.set("last_view_mode", value)
    }

    /// Add or update a library in history
    pub fn update_library(&self, path: &PathBuf, name: &str, video_count: i64, thumbnail_path: Option<&PathBuf>) -> Result<()> {
        let path_str = path.display().to_string();
        let thumb_str = thumbnail_path.map(|p| p.display().to_string());
        let now = chrono::Utc::now().to_rfc3339();

        self.conn.execute(
            r#"
            INSERT INTO library_history (path, name, video_count, last_opened, thumbnail_path)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(path) DO UPDATE SET
                name = ?2,
                video_count = ?3,
                last_opened = ?4,
                thumbnail_path = COALESCE(?5, thumbnail_path)
            "#,
            params![path_str, name, video_count, now, thumb_str],
        )?;
        Ok(())
    }

    /// Get all library history entries, ordered by last opened
    pub fn get_library_history(&self) -> Result<Vec<LibraryEntry>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, path, name, video_count, last_opened, thumbnail_path
            FROM library_history
            ORDER BY last_opened DESC
            LIMIT 20
            "#,
        )?;

        let entries = stmt.query_map([], |row| {
            let path_str: String = row.get(1)?;
            let thumb_str: Option<String> = row.get(5)?;

            Ok(LibraryEntry {
                id: row.get(0)?,
                path: PathBuf::from(path_str),
                name: row.get(2)?,
                video_count: row.get(3)?,
                last_opened: row.get(4)?,
                thumbnail_path: thumb_str.map(PathBuf::from),
            })
        })?;

        entries.collect()
    }

    /// Remove a library from history
    pub fn remove_library(&self, id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM library_history WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Check if a library path exists in history
    #[allow(dead_code)]
    pub fn library_exists(&self, path: &PathBuf) -> bool {
        let path_str = path.display().to_string();
        let mut stmt = match self.conn.prepare("SELECT 1 FROM library_history WHERE path = ?1") {
            Ok(s) => s,
            Err(_) => return false,
        };

        stmt.exists(params![path_str]).unwrap_or(false)
    }
}

// Need to bring in dirs for fallback
mod dirs {
    use std::path::PathBuf;

    pub fn home_dir() -> Option<PathBuf> {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}
