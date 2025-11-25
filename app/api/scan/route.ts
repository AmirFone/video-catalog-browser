import { NextRequest, NextResponse } from 'next/server';
import { scanAndProcessDirectory, validatePath, ScanProgressCallback } from '@/app/lib/scanner';
import { getScanStatus, initDatabase, isDatabaseInitialized, getCurrentRootPath } from '@/app/lib/db';

// Rolling status messages for UI
const ROLLING_MESSAGES = [
  'Scanning for videos...',
  'Extracting video metadata...',
  'Generating thumbnails...',
  'Indexing your library...',
  'Pro tip: Previously scanned videos are cached - no reprocessing needed!',
];

// Store active scan state
let activeScan: {
  id: string;
  status: 'counting' | 'scanning' | 'complete' | 'error';
  phase: 'count' | 'metadata' | 'done';
  totalVideos: number;
  videosProcessed: number;
  videosSkipped: number;
  currentFile: string;
  message: string;
  messageIndex: number;
  lastMessageChange: number;
  rootPath: string;
} | null = null;

// Rotate message every 3 seconds
function getRotatingMessage(): string {
  if (!activeScan) return ROLLING_MESSAGES[0];

  const now = Date.now();
  if (now - activeScan.lastMessageChange > 3000) {
    activeScan.messageIndex = (activeScan.messageIndex + 1) % ROLLING_MESSAGES.length;
    activeScan.lastMessageChange = now;
  }

  return ROLLING_MESSAGES[activeScan.messageIndex];
}

// POST: Start a new directory scan
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: dirPath } = body;

    if (!dirPath) {
      return NextResponse.json(
        { success: false, error: 'Path is required' },
        { status: 400 }
      );
    }

    // Validate the path
    const validation = await validatePath(dirPath);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    // Check if a scan is already in progress
    if (activeScan && (activeScan.status === 'scanning' || activeScan.status === 'counting')) {
      return NextResponse.json(
        { success: false, error: 'A scan is already in progress' },
        { status: 409 }
      );
    }

    // Initialize database for this path (on source drive)
    initDatabase(dirPath);

    // Initialize active scan state
    activeScan = {
      id: '',
      status: 'counting',
      phase: 'count',
      totalVideos: 0,
      videosProcessed: 0,
      videosSkipped: 0,
      currentFile: '',
      message: ROLLING_MESSAGES[0],
      messageIndex: 0,
      lastMessageChange: Date.now(),
      rootPath: dirPath,
    };

    // Progress callback
    const onProgress: ScanProgressCallback = (data) => {
      if (activeScan) {
        activeScan.status = data.phase === 'counting' ? 'counting' : 'scanning';
        activeScan.phase = data.phase === 'counting' ? 'count' : 'metadata';
        activeScan.totalVideos = data.totalVideos;
        activeScan.videosProcessed = data.processed;
        activeScan.videosSkipped = data.skipped;
        activeScan.currentFile = data.currentFile;
        activeScan.message = getRotatingMessage();
      }
    };

    // Run scan asynchronously
    scanAndProcessDirectory(dirPath, onProgress)
      .then(({ scanId, videosFound, videosProcessed, videosSkipped }) => {
        if (activeScan) {
          activeScan.id = scanId;
          activeScan.status = 'complete';
          activeScan.phase = 'done';
          activeScan.totalVideos = videosFound;
          activeScan.videosProcessed = videosProcessed;
          activeScan.videosSkipped = videosSkipped;
          activeScan.message = videosSkipped > 0
            ? `Scan complete! ${videosSkipped} videos were already indexed.`
            : `Scan complete! Found ${videosFound} videos.`;
        }
      })
      .catch((error) => {
        if (activeScan) {
          activeScan.status = 'error';
          activeScan.message = `Error: ${error.message}`;
        }
        console.error('Scan error:', error);
      });

    return NextResponse.json({
      success: true,
      message: 'Scan started',
      path: dirPath,
    });
  } catch (error) {
    console.error('Scan error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start scan' },
      { status: 500 }
    );
  }
}

// GET: Get scan status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scanId = searchParams.get('id');

  if (scanId) {
    // Get specific scan status from database
    const status = getScanStatus(scanId);
    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Scan not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, ...status });
  }

  // Return active scan status with extended info
  if (activeScan) {
    // Update rotating message
    activeScan.message = getRotatingMessage();

    return NextResponse.json({
      success: true,
      status: activeScan.status,
      phase: activeScan.phase,
      totalVideos: activeScan.totalVideos,
      videosProcessed: activeScan.videosProcessed,
      videosSkipped: activeScan.videosSkipped,
      currentFile: activeScan.currentFile,
      message: activeScan.message,
      rootPath: activeScan.rootPath,
    });
  }

  // Return idle status with last used directory info
  const lastRootPath = getCurrentRootPath();
  return NextResponse.json({
    success: true,
    status: 'idle',
    lastDirectory: lastRootPath,
  });
}
