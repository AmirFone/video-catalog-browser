import { NextRequest, NextResponse } from 'next/server';
import { getVideoById, addToProxyQueue, getNextQueuedJob, updateProxyJobStatus, updateVideoProxy, getAllVideos, isDatabaseInitialized, getCurrentRootPath } from '@/app/lib/db';
import { generateAllProxyAssets } from '@/app/lib/ffmpeg';

// Track if proxy generation is running
let isGenerating = false;

// Process proxy generation queue
async function processQueue() {
  if (isGenerating) return;

  // Get root path for centralized proxy storage
  const rootPath = getCurrentRootPath();
  if (!rootPath) {
    console.error('No root path available for proxy generation');
    return;
  }

  isGenerating = true;

  try {
    let job = getNextQueuedJob();

    while (job) {
      // Mark job as processing
      updateProxyJobStatus(job.id, 'processing', 0);

      const video = getVideoById(job.videoId);
      if (!video) {
        updateProxyJobStatus(job.id, 'error', 0, 'Video not found');
        job = getNextQueuedJob();
        continue;
      }

      try {
        // Track progress for parallel operations
        let thumbnailDone = false;
        let spriteDone = false;
        let proxyProgress = 0;

        // Generate proxy assets (using centralized rootPath for storage)
        const result = await generateAllProxyAssets(
          video.id,
          video.filePath,
          rootPath, // Use centralized root path instead of video directory
          video.duration,
          (stage, progress) => {
            // Track progress for each stage (running in parallel)
            if (stage === 'thumbnail' && progress === 100) {
              thumbnailDone = true;
            } else if (stage === 'sprite' && progress === 100) {
              spriteDone = true;
            } else if (stage === 'proxy') {
              proxyProgress = progress;
            }

            // Calculate overall progress: thumbnail (5%) + sprite (15%) + proxy (80%)
            const overallProgress =
              (thumbnailDone ? 5 : 0) +
              (spriteDone ? 15 : 0) +
              (proxyProgress * 0.8);

            updateProxyJobStatus(job!.id, 'processing', Math.round(overallProgress));
          }
        );

        // Update video with proxy paths
        updateVideoProxy(video.id, result.proxyPath, result.spritePath, result.thumbnailPath);

        // Mark job as complete
        updateProxyJobStatus(job.id, 'complete', 100);
      } catch (error) {
        console.error(`Error generating proxy for ${video.fileName}:`, error);
        updateProxyJobStatus(job.id, 'error', 0, String(error));
      }

      // Get next job
      job = getNextQueuedJob();
    }
  } finally {
    isGenerating = false;
  }
}

// POST: Add videos to proxy generation queue
export async function POST(request: NextRequest) {
  try {
    // Check if database is initialized
    if (!isDatabaseInitialized()) {
      return NextResponse.json(
        { success: false, error: 'No video library loaded. Please scan a directory first.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { videoIds, all } = body;

    let idsToQueue: string[] = [];

    if (all) {
      // Queue all videos without proxies
      const allVideos = getAllVideos();
      idsToQueue = allVideos
        .filter((v) => !v.hasProxy)
        .map((v) => v.id);
    } else if (videoIds && Array.isArray(videoIds)) {
      idsToQueue = videoIds;
    } else {
      return NextResponse.json(
        { success: false, error: 'No videos specified' },
        { status: 400 }
      );
    }

    // Add to queue
    let queued = 0;
    for (const videoId of idsToQueue) {
      const video = getVideoById(videoId);
      if (video && !video.hasProxy) {
        addToProxyQueue(videoId);
        queued++;
      }
    }

    // Start processing queue in background
    processQueue().catch(console.error);

    return NextResponse.json({
      success: true,
      queued,
      message: `Added ${queued} videos to proxy generation queue`,
    });
  } catch (error) {
    console.error('Error adding to proxy queue:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add to proxy queue' },
      { status: 500 }
    );
  }
}
