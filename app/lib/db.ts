import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { VideoRow, SelectionRow, ProxyJobRow, rowToVideo, rowToSelection, rowToProxyJob, Video, Selection, ProxyJob, SortOption } from './types';

// Database instance management
let db: Database.Database | null = null;
let currentDbPath: string | null = null;
let currentRootPath: string | null = null;

// Get the data directory path for a given root path
export function getDataDir(rootPath: string): string {
  return path.join(rootPath, '.vcb-data');
}

// Get database path for a given root path
export function getDatabasePath(rootPath: string): string {
  return path.join(getDataDir(rootPath), 'catalog.db');
}

// Initialize database for a specific root path (on source drive)
export function initDatabase(rootPath: string): Database.Database {
  const dataDir = getDataDir(rootPath);
  const dbPath = getDatabasePath(rootPath);

  // If same database is already open, return it
  if (db && currentDbPath === dbPath) {
    return db;
  }

  // Close existing database if different
  if (db) {
    db.close();
    db = null;
  }

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Open new database
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  currentDbPath = dbPath;
  currentRootPath = rootPath;

  initializeSchema(db);

  return db;
}

// Get current root path
export function getCurrentRootPath(): string | null {
  return currentRootPath;
}

// Get active database (requires initDatabase to be called first)
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase(rootPath) first.');
  }
  return db;
}

// Check if database is initialized
export function isDatabaseInitialized(): boolean {
  return db !== null;
}

// Initialize database schema
function initializeSchema(database: Database.Database): void {
  database.exec(`
    -- Videos table
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

    -- Selections table (favorites, notes)
    CREATE TABLE IF NOT EXISTS selections (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      is_favorite INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_selections_video_id ON selections(video_id);

    -- Proxy generation queue
    CREATE TABLE IF NOT EXISTS proxy_queue (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_proxy_queue_status ON proxy_queue(status);

    -- Scan sessions
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scanning',
      videos_found INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    -- Application settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// Generate a simple hash ID from file path
export function generateId(filePath: string): string {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Video insert data type
export interface VideoInsertData {
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  directory: string;
  fileHash?: string;
  fileMtime?: string;
}

// Video operations
export function insertVideo(video: VideoInsertData): Video {
  const db = getDatabase();
  const id = generateId(video.filePath);
  const scannedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO videos (id, file_path, file_name, file_size, duration, width, height, created_at, directory, file_hash, file_mtime, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    video.filePath,
    video.fileName,
    video.fileSize,
    video.duration,
    video.width,
    video.height,
    video.createdAt,
    video.directory,
    video.fileHash || null,
    video.fileMtime || null,
    scannedAt
  );

  return getVideoById(id)!;
}

// Batch insert videos for better performance
export function insertVideosBatch(videos: VideoInsertData[]): Video[] {
  const db = getDatabase();
  const scannedAt = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO videos (id, file_path, file_name, file_size, duration, width, height, created_at, directory, file_hash, file_mtime, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((videoList: VideoInsertData[]) => {
    const insertedIds: string[] = [];
    for (const video of videoList) {
      const id = generateId(video.filePath);
      insertStmt.run(
        id,
        video.filePath,
        video.fileName,
        video.fileSize,
        video.duration,
        video.width,
        video.height,
        video.createdAt,
        video.directory,
        video.fileHash || null,
        video.fileMtime || null,
        scannedAt
      );
      insertedIds.push(id);
    }
    return insertedIds;
  });

  const insertedIds = insertMany(videos);
  return insertedIds.map(id => getVideoById(id)!).filter(Boolean);
}

export function getVideoById(id: string): Video | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined;
  return row ? rowToVideo(row) : null;
}

export function getVideoByPath(filePath: string): Video | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM videos WHERE file_path = ?').get(filePath) as VideoRow | undefined;
  return row ? rowToVideo(row) : null;
}

export function getVideosByDirectory(directory: string, sortBy: SortOption = 'date-desc'): Video[] {
  const db = getDatabase();

  let orderClause: string;
  switch (sortBy) {
    case 'date-asc':
      orderClause = 'created_at ASC';
      break;
    case 'date-desc':
      orderClause = 'created_at DESC';
      break;
    case 'duration-asc':
      orderClause = 'duration ASC';
      break;
    case 'duration-desc':
      orderClause = 'duration DESC';
      break;
    case 'name-asc':
      orderClause = 'file_name ASC';
      break;
    case 'name-desc':
      orderClause = 'file_name DESC';
      break;
    default:
      orderClause = 'created_at DESC';
  }

  const rows = db.prepare(`
    SELECT * FROM videos
    WHERE directory LIKE ?
    ORDER BY ${orderClause}
  `).all(`${directory}%`) as VideoRow[];

  return rows.map(rowToVideo);
}

export function getAllVideos(sortBy: SortOption = 'date-desc'): Video[] {
  const db = getDatabase();

  let orderClause: string;
  switch (sortBy) {
    case 'date-asc':
      orderClause = 'created_at ASC';
      break;
    case 'date-desc':
      orderClause = 'created_at DESC';
      break;
    case 'duration-asc':
      orderClause = 'duration ASC';
      break;
    case 'duration-desc':
      orderClause = 'duration DESC';
      break;
    case 'name-asc':
      orderClause = 'file_name ASC';
      break;
    case 'name-desc':
      orderClause = 'file_name DESC';
      break;
    default:
      orderClause = 'created_at DESC';
  }

  const rows = db.prepare(`SELECT * FROM videos ORDER BY ${orderClause}`).all() as VideoRow[];
  return rows.map(rowToVideo);
}

export function updateVideoProxy(id: string, proxyPath: string, spritePath: string, thumbnailPath: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE videos
    SET has_proxy = 1, has_sprite = 1, proxy_path = ?, sprite_path = ?, thumbnail_path = ?
    WHERE id = ?
  `).run(proxyPath, spritePath, thumbnailPath, id);
}

export function updateVideoThumbnail(id: string, thumbnailPath: string): void {
  const db = getDatabase();
  db.prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?').run(thumbnailPath, id);
}

export function updateVideoThumbnailAndSprite(id: string, thumbnailPath: string, spritePath: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE videos
    SET thumbnail_path = ?, sprite_path = ?, has_sprite = 1
    WHERE id = ?
  `).run(thumbnailPath, spritePath, id);
}

export function deleteVideosByDirectory(directory: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM videos WHERE directory LIKE ?').run(`${directory}%`);
}

// Selection operations
export function getSelectionByVideoId(videoId: string): Selection | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM selections WHERE video_id = ?').get(videoId) as SelectionRow | undefined;
  return row ? rowToSelection(row) : null;
}

export function upsertSelection(videoId: string, isFavorite: boolean, notes: string): Selection {
  const db = getDatabase();
  const id = generateId(`selection-${videoId}`);
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO selections (id, video_id, is_favorite, notes, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET is_favorite = ?, notes = ?
  `).run(id, videoId, isFavorite ? 1 : 0, notes, createdAt, isFavorite ? 1 : 0, notes);

  return getSelectionByVideoId(videoId)!;
}

export function getFavorites(): Selection[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM selections WHERE is_favorite = 1').all() as SelectionRow[];
  return rows.map(rowToSelection);
}

export function getAllSelections(): Selection[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM selections').all() as SelectionRow[];
  return rows.map(rowToSelection);
}

// Proxy queue operations
export function addToProxyQueue(videoId: string): ProxyJob {
  const db = getDatabase();
  const id = generateId(`proxy-${videoId}-${Date.now()}`);
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO proxy_queue (id, video_id, status, progress, created_at)
    VALUES (?, ?, 'queued', 0, ?)
  `).run(id, videoId, createdAt);

  return getProxyJobById(id)!;
}

export function getProxyJobById(id: string): ProxyJob | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM proxy_queue WHERE id = ?').get(id) as ProxyJobRow | undefined;
  return row ? rowToProxyJob(row) : null;
}

export function getProxyQueueStatus(): { queue: ProxyJob[]; currentJob: ProxyJob | null; completed: number; total: number } {
  const db = getDatabase();

  const queuedRows = db.prepare("SELECT * FROM proxy_queue WHERE status = 'queued' ORDER BY created_at ASC").all() as ProxyJobRow[];
  const processingRow = db.prepare("SELECT * FROM proxy_queue WHERE status = 'processing' LIMIT 1").get() as ProxyJobRow | undefined;
  const completedCount = db.prepare("SELECT COUNT(*) as count FROM proxy_queue WHERE status = 'complete'").get() as { count: number };
  const totalCount = db.prepare("SELECT COUNT(*) as count FROM proxy_queue").get() as { count: number };

  return {
    queue: queuedRows.map(rowToProxyJob),
    currentJob: processingRow ? rowToProxyJob(processingRow) : null,
    completed: completedCount.count,
    total: totalCount.count,
  };
}

export function updateProxyJobStatus(id: string, status: ProxyJob['status'], progress: number = 0, error?: string): void {
  const db = getDatabase();

  if (status === 'processing') {
    db.prepare('UPDATE proxy_queue SET status = ?, progress = ?, started_at = ? WHERE id = ?')
      .run(status, progress, new Date().toISOString(), id);
  } else if (status === 'complete' || status === 'error') {
    db.prepare('UPDATE proxy_queue SET status = ?, progress = ?, completed_at = ?, error = ? WHERE id = ?')
      .run(status, progress, new Date().toISOString(), error || null, id);
  } else {
    db.prepare('UPDATE proxy_queue SET status = ?, progress = ? WHERE id = ?')
      .run(status, progress, id);
  }
}

export function getNextQueuedJob(): ProxyJob | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM proxy_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as ProxyJobRow | undefined;
  return row ? rowToProxyJob(row) : null;
}

// Settings operations
export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || null;
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// Scan session operations
export function createScan(rootPath: string): string {
  const db = getDatabase();
  const id = generateId(`scan-${rootPath}-${Date.now()}`);
  const startedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO scans (id, root_path, status, videos_found, started_at)
    VALUES (?, ?, 'scanning', 0, ?)
  `).run(id, rootPath, startedAt);

  return id;
}

export function updateScanProgress(id: string, videosFound: number): void {
  const db = getDatabase();
  db.prepare('UPDATE scans SET videos_found = ? WHERE id = ?').run(videosFound, id);
}

export function completeScan(id: string, videosFound: number): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE scans SET status = 'complete', videos_found = ?, completed_at = ?
    WHERE id = ?
  `).run(videosFound, new Date().toISOString(), id);
}

export function failScan(id: string, error: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE scans SET status = 'error', completed_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);
}

export function getScanStatus(id: string): { status: string; videosFound: number } | null {
  const db = getDatabase();
  const row = db.prepare('SELECT status, videos_found FROM scans WHERE id = ?').get(id) as { status: string; videos_found: number } | undefined;
  return row ? { status: row.status, videosFound: row.videos_found } : null;
}
