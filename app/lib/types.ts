// Core video type
export interface Video {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  directory: string;
  hasProxy: boolean;
  hasSprite: boolean;
  proxyPath: string | null;
  spritePath: string | null;
  thumbnailPath: string | null;
  // Fingerprint fields for skip-reprocessing
  fileHash: string | null;
  fileMtime: string | null;
  scannedAt: string | null;
}

// Database row type (snake_case from SQLite)
export interface VideoRow {
  id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  duration: number;
  width: number | null;
  height: number | null;
  created_at: string;
  directory: string;
  has_proxy: number;
  has_sprite: number;
  proxy_path: string | null;
  sprite_path: string | null;
  thumbnail_path: string | null;
  // Fingerprint fields
  file_hash: string | null;
  file_mtime: string | null;
  scanned_at: string | null;
}

// Selection/favorites type
export interface Selection {
  id: string;
  videoId: string;
  isFavorite: boolean;
  notes: string;
  createdAt: string;
}

export interface SelectionRow {
  id: string;
  video_id: string;
  is_favorite: number;
  notes: string | null;
  created_at: string;
}

// Proxy queue type
export interface ProxyJob {
  id: string;
  videoId: string;
  status: 'queued' | 'processing' | 'complete' | 'error';
  progress: number;
  createdAt: string;
  error?: string;
}

export interface ProxyJobRow {
  id: string;
  video_id: string;
  status: string;
  progress: number;
  created_at: string;
  error: string | null;
}

// Scan status
export interface ScanStatus {
  id: string;
  status: 'scanning' | 'complete' | 'error';
  rootPath: string;
  videosFound: number;
  startedAt: string;
  completedAt?: string;
}

// Extended scan progress for enhanced loading screen
export interface ExtendedScanProgress {
  status: 'idle' | 'counting' | 'scanning' | 'complete' | 'error';
  phase: 'count' | 'metadata' | 'done';
  totalVideos: number;
  videosProcessed: number;
  videosSkipped: number;
  currentFile: string;
  message: string;
}

// Proxy generation status
export interface ProxyStatus {
  isProcessing: boolean;
  currentJob: ProxyJob | null;
  queue: ProxyJob[];
  completed: number;
  total: number;
}

// Sprite sheet configuration
export interface SpriteConfig {
  width: number;       // Width of each thumbnail
  height: number;      // Height of each thumbnail
  columns: number;     // Thumbnails per row
  rows: number;        // Total rows
  interval: number;    // Seconds between each thumbnail
  totalFrames: number; // Total number of frames
}

// Sort options
export type SortOption = 'date-asc' | 'date-desc' | 'duration-asc' | 'duration-desc' | 'name-asc' | 'name-desc';

// API response types
export interface ScanResponse {
  success: boolean;
  scanId?: string;
  error?: string;
}

export interface VideosResponse {
  videos: Video[];
  total: number;
}

export interface ProxyGenerateResponse {
  success: boolean;
  queued: number;
  error?: string;
}

// Video with selection data
export interface VideoWithSelection extends Video {
  selection?: Selection;
}

// FFmpeg metadata from probe
export interface FFmpegMetadata {
  duration: number;
  width: number;
  height: number;
  codec: string;
  frameRate: number;
  bitRate: number;
}

// Convert database row to Video object
export function rowToVideo(row: VideoRow): Video {
  return {
    id: row.id,
    filePath: row.file_path,
    fileName: row.file_name,
    fileSize: row.file_size,
    duration: row.duration,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    directory: row.directory,
    hasProxy: row.has_proxy === 1,
    hasSprite: row.has_sprite === 1,
    proxyPath: row.proxy_path,
    spritePath: row.sprite_path,
    thumbnailPath: row.thumbnail_path,
    fileHash: row.file_hash,
    fileMtime: row.file_mtime,
    scannedAt: row.scanned_at,
  };
}

// Convert database row to Selection object
export function rowToSelection(row: SelectionRow): Selection {
  return {
    id: row.id,
    videoId: row.video_id,
    isFavorite: row.is_favorite === 1,
    notes: row.notes || '',
    createdAt: row.created_at,
  };
}

// Convert database row to ProxyJob object
export function rowToProxyJob(row: ProxyJobRow): ProxyJob {
  return {
    id: row.id,
    videoId: row.video_id,
    status: row.status as ProxyJob['status'],
    progress: row.progress,
    createdAt: row.created_at,
    error: row.error || undefined,
  };
}
