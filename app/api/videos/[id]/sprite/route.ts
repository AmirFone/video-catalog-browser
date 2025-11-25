import { NextRequest, NextResponse } from 'next/server';
import { getVideoById, isDatabaseInitialized } from '@/app/lib/db';
import fs from 'fs';

// GET: Serve video sprite sheet for hover scrubbing
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

    const video = getVideoById(id);
    if (!video) {
      return NextResponse.json(
        { success: false, error: 'Video not found' },
        { status: 404 }
      );
    }

    if (!video.spritePath || !fs.existsSync(video.spritePath)) {
      // Return a placeholder SVG instead of 404
      const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <rect fill="#1a1a1a" width="1920" height="1080"/>
        <text x="960" y="540" fill="#444" text-anchor="middle" font-family="system-ui, sans-serif" font-size="48">Sprite Not Available</text>
      </svg>`;

      return new NextResponse(placeholderSvg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    const fileBuffer = fs.readFileSync(video.spritePath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving sprite:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to serve sprite' },
      { status: 500 }
    );
  }
}
