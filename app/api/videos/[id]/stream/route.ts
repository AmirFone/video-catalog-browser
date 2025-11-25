import { NextRequest, NextResponse } from 'next/server';
import { getVideoById, isDatabaseInitialized } from '@/app/lib/db';
import fs from 'fs';
import path from 'path';

// GET: Stream video file with range support
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check if database is initialized
    if (!isDatabaseInitialized()) {
      return NextResponse.json(
        { success: false, error: 'No video library loaded' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'proxy'; // 'proxy' or 'original'

    const video = getVideoById(id);
    if (!video) {
      return NextResponse.json(
        { success: false, error: 'Video not found' },
        { status: 404 }
      );
    }

    // Determine which file to serve
    let filePath: string;
    if (type === 'proxy' && video.proxyPath) {
      filePath = video.proxyPath;
    } else {
      filePath = video.filePath;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, error: 'Video file not found' },
        { status: 404 }
      );
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.get('range');

    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.mov' ? 'video/quicktime' : 'video/mp4';

    if (range) {
      // Handle range request for video seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const fileStream = fs.createReadStream(filePath, { start, end });

      return new NextResponse(fileStream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
        },
      });
    }

    // Full file request
    const fileStream = fs.createReadStream(filePath);

    return new NextResponse(fileStream as unknown as ReadableStream, {
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error) {
    console.error('Error streaming video:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to stream video' },
      { status: 500 }
    );
  }
}
