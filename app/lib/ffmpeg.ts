import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { FFmpegMetadata, SpriteConfig } from './types';
import { getDataDir } from './db';

// Get centralized proxy directory path for a given root path
export function getProxyDir(rootPath: string): string {
  return path.join(getDataDir(rootPath), 'proxies');
}

// Ensure proxy directory exists (centralized at root level)
export async function ensureProxyDir(rootPath: string): Promise<string> {
  const proxyDir = getProxyDir(rootPath);
  await fs.mkdir(proxyDir, { recursive: true });
  return proxyDir;
}

// Extract video metadata using ffprobe
export async function getVideoMetadata(filePath: string): Promise<FFmpegMetadata> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    const ffprobe = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const videoStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
        const format = data.format || {};

        const metadata: FFmpegMetadata = {
          duration: parseFloat(format.duration) || 0,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          codec: videoStream?.codec_name || 'unknown',
          frameRate: parseFrameRate(videoStream?.r_frame_rate),
          bitRate: parseInt(format.bit_rate) || 0,
        };

        resolve(metadata);
      } catch (error) {
        reject(new Error(`Failed to parse ffprobe output: ${error}`));
      }
    });

    ffprobe.on('error', (error) => {
      reject(new Error(`Failed to start ffprobe: ${error.message}`));
    });
  });
}

// Parse frame rate from ffprobe format (e.g., "30000/1001")
function parseFrameRate(frameRate: string | undefined): number {
  if (!frameRate) return 30;

  if (frameRate.includes('/')) {
    const [num, den] = frameRate.split('/').map(Number);
    return den ? num / den : 30;
  }

  return parseFloat(frameRate) || 30;
}

// Generate a single thumbnail from video
export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  timestamp: number = 1
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-ss', String(timestamp),
      '-i', inputPath,
      '-vframes', '1',
      '-vf', 'scale=384:-1',
      '-q:v', '5',
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg thumbnail exited with code ${code}: ${stderr}`));
        return;
      }
      // Verify file was actually created
      if (!existsSync(outputPath)) {
        reject(new Error(`Thumbnail file not created at ${outputPath}`));
        return;
      }
      resolve();
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });
  });
}

// Generate sprite sheet for hover scrubbing
export async function generateSpriteSheet(
  inputPath: string,
  outputPath: string,
  duration: number
): Promise<SpriteConfig> {
  // Calculate sprite configuration based on video duration
  let fps: number;
  let columns: number;
  let rows: number;

  if (duration <= 60) {
    // Short videos: 1 frame per second, up to 60 frames
    fps = 1;
    columns = 10;
    rows = Math.ceil(Math.min(duration, 60) / columns);
  } else if (duration <= 300) {
    // 1-5 min videos: frame every 3 seconds
    fps = 1 / 3;
    columns = 10;
    rows = 10;
  } else if (duration <= 1800) {
    // 5-30 min videos: frame every 12 seconds
    fps = 1 / 12;
    columns = 15;
    rows = 10;
  } else {
    // Long videos: frame every 30 seconds, max 200 frames
    fps = 1 / 30;
    columns = 20;
    rows = 10;
  }

  const totalFrames = Math.min(Math.ceil(duration * fps), columns * rows);
  const interval = duration / totalFrames;

  // Smaller sprite thumbnails for faster loading
  const thumbWidth = 160;
  const thumbHeight = 90; // 16:9 aspect ratio

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', `fps=${fps},scale=${thumbWidth}:${thumbHeight}:force_original_aspect_ratio=decrease,pad=${thumbWidth}:${thumbHeight}:(ow-iw)/2:(oh-ih)/2,tile=${columns}x${rows}`,
      '-frames:v', '1',
      '-q:v', '5',
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg sprite sheet exited with code ${code}: ${stderr}`));
        return;
      }

      // Verify file was actually created
      if (!existsSync(outputPath)) {
        reject(new Error(`Sprite sheet file not created at ${outputPath}`));
        return;
      }

      const config: SpriteConfig = {
        width: thumbWidth,
        height: thumbHeight,
        columns,
        rows,
        interval,
        totalFrames,
      };

      resolve(config);
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });
  });
}

// Generate 480p proxy video (optimized for preview scrubbing)
export async function generateProxy(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  // First get duration for progress calculation
  const metadata = await getVideoMetadata(inputPath);
  const totalDuration = metadata.duration;

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=-2:360,fps=10',  // 360p @ 10fps for smooth scrubbing
      '-c:v', 'libx265',      // H.265/HEVC for better compression
      '-crf', '28',           // More aggressive compression for RAW files
      '-preset', 'fast',
      '-tag:v', 'hvc1',       // Safari/iOS compatibility
      '-g', '30',
      '-c:a', 'aac',
      '-b:a', '96k',          // Lower audio bitrate (sufficient for preview)
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';

    ffmpeg.stdout.on('data', (data) => {
      const output = data.toString();
      // Parse progress from ffmpeg output
      const timeMatch = output.match(/out_time_ms=(\d+)/);
      if (timeMatch && totalDuration > 0 && onProgress) {
        const currentTime = parseInt(timeMatch[1]) / 1000000; // Convert microseconds to seconds
        const progress = Math.min((currentTime / totalDuration) * 100, 100);
        onProgress(Math.round(progress));
      }
    });

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg proxy exited with code ${code}: ${stderr}`));
        return;
      }
      // Verify file was actually created
      if (!existsSync(outputPath)) {
        reject(new Error(`Proxy file not created at ${outputPath}`));
        return;
      }
      resolve();
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });
  });
}

// Generate all proxy assets (proxy video, sprite sheet, thumbnail) - runs in parallel
export async function generateAllProxyAssets(
  videoId: string,
  inputPath: string,
  rootPath: string,
  duration: number,
  onProgress?: (stage: string, progress: number) => void
): Promise<{ proxyPath: string; spritePath: string; thumbnailPath: string; spriteConfig: SpriteConfig }> {
  const proxyDir = await ensureProxyDir(rootPath);

  const proxyPath = path.join(proxyDir, `${videoId}_proxy.mp4`);
  const spritePath = path.join(proxyDir, `${videoId}_sprite.jpg`);
  const thumbnailPath = path.join(proxyDir, `${videoId}_thumb.jpg`);

  const thumbnailTime = Math.min(duration * 0.1, 5); // 10% into video or 5 seconds

  // Run thumbnail, sprite, and proxy generation in PARALLEL for better performance
  onProgress?.('all', 0);

  const [, spriteConfig] = await Promise.all([
    // Thumbnail generation
    generateThumbnail(inputPath, thumbnailPath, thumbnailTime)
      .then(() => onProgress?.('thumbnail', 100)),

    // Sprite sheet generation
    generateSpriteSheet(inputPath, spritePath, duration)
      .then((config) => {
        onProgress?.('sprite', 100);
        return config;
      }),

    // Proxy video generation (with progress updates)
    generateProxy(inputPath, proxyPath, (progress) => {
      onProgress?.('proxy', progress);
    }).then(() => onProgress?.('proxy', 100))
  ]);

  return { proxyPath, spritePath, thumbnailPath, spriteConfig };
}

// Generate only thumbnail (for initial scan)
export async function generateThumbnailOnly(
  videoId: string,
  inputPath: string,
  rootPath: string,
  duration: number
): Promise<string> {
  const proxyDir = await ensureProxyDir(rootPath);
  const thumbnailPath = path.join(proxyDir, `${videoId}_thumb.jpg`);
  const thumbnailTime = Math.min(duration * 0.1, 5);
  await generateThumbnail(inputPath, thumbnailPath, thumbnailTime);
  return thumbnailPath;
}

// Generate only sprite sheet (for initial scan)
export async function generateSpriteSheetOnly(
  videoId: string,
  inputPath: string,
  rootPath: string,
  duration: number
): Promise<{ spritePath: string; spriteConfig: SpriteConfig }> {
  const proxyDir = await ensureProxyDir(rootPath);
  const spritePath = path.join(proxyDir, `${videoId}_sprite.jpg`);
  const spriteConfig = await generateSpriteSheet(inputPath, spritePath, duration);
  return { spritePath, spriteConfig };
}

// Check if FFmpeg is available
export async function checkFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version']);

    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });

    ffmpeg.on('error', () => {
      resolve(false);
    });
  });
}

// Format duration in HH:MM:SS or MM:SS
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Format file size in human readable format
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
