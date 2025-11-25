import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import pLimit from 'p-limit';
import {
  insertVideo,
  insertVideosBatch,
  generateId,
  createScan,
  updateScanProgress,
  completeScan,
  failScan,
  updateVideoThumbnail,
  updateVideoThumbnailAndSprite,
  getVideoByPath,
  initDatabase,
  VideoInsertData
} from './db';
import { getVideoMetadata, generateThumbnailOnly, generateSpriteSheetOnly, ensureProxyDir } from './ffmpeg';
import { Video } from './types';

// Video file extensions to search for
const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.avi', '.mkv', '.webm'];

// Concurrency limit for parallel operations
const METADATA_CONCURRENCY = 4;

// Check if a file is a video based on extension
function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

// Check if path should be skipped (hidden files, data directory, etc.)
function shouldSkipPath(name: string): boolean {
  // Skip hidden files/folders (except our data dir which we'll skip explicitly)
  if (name.startsWith('.')) {
    return true;
  }
  // Skip system folders
  if (['node_modules', '__MACOSX', '.Trash', '.Spotlight-V100', '.fseventsd'].includes(name)) {
    return true;
  }
  return false;
}

// Generate quick file fingerprint without reading entire file
export async function getFileFingerprint(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);

  // Read first 64KB of file for partial hash
  const fd = await fs.open(filePath, 'r');
  const buffer = Buffer.alloc(65536); // 64KB
  const { bytesRead } = await fd.read(buffer, 0, 65536, 0);
  await fd.close();

  // Create hash combining: first 64KB content + file size + mtime
  const hash = crypto.createHash('md5')
    .update(buffer.subarray(0, bytesRead))
    .update(String(stats.size))
    .update(stats.mtime.toISOString())
    .digest('hex');

  return hash;
}

// Recursively scan directory for video files
export async function* scanDirectory(rootPath: string): AsyncGenerator<string> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldSkipPath(entry.name)) {
        continue;
      }

      const fullPath = path.join(rootPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        yield* scanDirectory(fullPath);
      } else if (entry.isFile() && isVideoFile(entry.name)) {
        yield fullPath;
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${rootPath}:`, error);
  }
}

// Quick count of videos in directory (for progress bar total)
export async function quickCountVideos(rootPath: string): Promise<number> {
  let count = 0;
  for await (const _ of scanDirectory(rootPath)) {
    count++;
  }
  return count;
}

// Scan progress callback type
export interface ScanProgressCallback {
  (data: {
    phase: 'counting' | 'processing';
    totalVideos: number;
    processed: number;
    skipped: number;
    currentFile: string;
  }): void;
}

// Process a single video file with fingerprint check
async function processVideoFile(
  filePath: string,
  rootPath: string,
  generateThumbs: boolean = true
): Promise<{ video: Video | null; skipped: boolean }> {
  try {
    // Get file fingerprint
    const fingerprint = await getFileFingerprint(filePath);
    const stats = await fs.stat(filePath);
    const fileMtime = stats.mtime.toISOString();

    // Check if video already exists with same fingerprint (skip reprocessing)
    const existing = getVideoByPath(filePath);
    if (existing && existing.fileHash === fingerprint) {
      // File unchanged, skip processing
      return { video: existing, skipped: true };
    }

    // Get video metadata using ffprobe
    const metadata = await getVideoMetadata(filePath);

    // Prepare video data for insertion
    const videoData: VideoInsertData = {
      filePath,
      fileName: path.basename(filePath),
      fileSize: stats.size,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      createdAt: stats.birthtime.toISOString(),
      directory: path.dirname(filePath),
      fileHash: fingerprint,
      fileMtime: fileMtime,
    };

    // Insert video record
    const video = insertVideo(videoData);

    // Generate thumbnail AND sprite in parallel (for immediate hover scrubbing)
    if (generateThumbs && metadata.duration > 0) {
      try {
        const [thumbnailPath, spriteResult] = await Promise.all([
          generateThumbnailOnly(video.id, filePath, rootPath, metadata.duration),
          generateSpriteSheetOnly(video.id, filePath, rootPath, metadata.duration)
        ]);
        updateVideoThumbnailAndSprite(video.id, thumbnailPath, spriteResult.spritePath);
      } catch (thumbError) {
        console.error(`Failed to generate thumbnail/sprite for ${filePath}:`, thumbError);
      }
    }

    return { video, skipped: false };
  } catch (error) {
    console.error(`Error processing video ${filePath}:`, error);
    return { video: null, skipped: false };
  }
}

// Scan a directory and process all video files with parallel processing
export async function scanAndProcessDirectory(
  rootPath: string,
  onProgress?: ScanProgressCallback
): Promise<{ scanId: string; videosFound: number; videosProcessed: number; videosSkipped: number }> {
  // Verify directory exists
  try {
    const stats = await fs.stat(rootPath);
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory');
    }
  } catch {
    throw new Error(`Invalid directory path: ${rootPath}`);
  }

  // Initialize database for this root path (stored on source drive)
  initDatabase(rootPath);

  // Create scan record
  const scanId = createScan(rootPath);

  // Phase 1: Quick count of all videos
  onProgress?.({
    phase: 'counting',
    totalVideos: 0,
    processed: 0,
    skipped: 0,
    currentFile: 'Counting videos...',
  });

  const videoPaths: string[] = [];
  for await (const videoPath of scanDirectory(rootPath)) {
    videoPaths.push(videoPath);
    onProgress?.({
      phase: 'counting',
      totalVideos: videoPaths.length,
      processed: 0,
      skipped: 0,
      currentFile: videoPath,
    });
  }

  const totalVideos = videoPaths.length;

  // Phase 2: Process videos with parallel metadata extraction
  let videosProcessed = 0;
  let videosSkipped = 0;
  let videosFound = 0;

  // Use p-limit for bounded concurrency
  const limit = pLimit(METADATA_CONCURRENCY);

  // Process in batches for progress updates
  const processVideo = async (videoPath: string) => {
    const result = await processVideoFile(videoPath, rootPath, true);

    if (result.video) {
      videosFound++;
      if (result.skipped) {
        videosSkipped++;
      } else {
        videosProcessed++;
      }
    }

    onProgress?.({
      phase: 'processing',
      totalVideos,
      processed: videosProcessed,
      skipped: videosSkipped,
      currentFile: videoPath,
    });

    updateScanProgress(scanId, videosFound);

    return result;
  };

  // Process all videos with concurrency limit
  await Promise.all(
    videoPaths.map(videoPath => limit(() => processVideo(videoPath)))
  );

  // Mark scan as complete
  completeScan(scanId, videosFound);

  return { scanId, videosFound, videosProcessed, videosSkipped };
}

// Quick scan - just find video files without processing metadata
export async function quickScanDirectory(rootPath: string): Promise<string[]> {
  const videos: string[] = [];

  for await (const videoPath of scanDirectory(rootPath)) {
    videos.push(videoPath);
  }

  return videos;
}

// Count videos in directory without full processing
export async function countVideosInDirectory(rootPath: string): Promise<number> {
  let count = 0;

  for await (const _ of scanDirectory(rootPath)) {
    count++;
  }

  return count;
}

// Validate if path is accessible
export async function validatePath(dirPath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const stats = await fs.stat(dirPath);

    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' };
    }

    // Try to read directory to check permissions
    await fs.readdir(dirPath);

    return { valid: true };
  } catch (error: unknown) {
    if (error instanceof Error) {
      if ('code' in error && error.code === 'ENOENT') {
        return { valid: false, error: 'Directory does not exist' };
      }
      if ('code' in error && error.code === 'EACCES') {
        return { valid: false, error: 'Permission denied' };
      }
      return { valid: false, error: error.message };
    }
    return { valid: false, error: 'Unknown error' };
  }
}

// Get recently used directories from settings
export function getRecentDirectories(): string[] {
  // This would be stored in the settings table
  // For now, return empty array
  return [];
}
