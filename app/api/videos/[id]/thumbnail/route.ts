import { NextRequest, NextResponse } from 'next/server';
import { getVideoById, isDatabaseInitialized } from '@/app/lib/db';
import fs from 'fs';

// GET: Serve video thumbnail
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

    if (!video.thumbnailPath || !fs.existsSync(video.thumbnailPath)) {
      // Return a placeholder SVG instead of 404
      const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="216" viewBox="0 0 384 216">
        <rect fill="#1a1a1a" width="384" height="216"/>
        <g fill="#444" transform="translate(192, 90)">
          <path d="M-30,-20 L-30,20 L20,0 Z" />
        </g>
        <text x="192" y="150" fill="#666" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14">No Preview</text>
      </svg>`;

      return new NextResponse(placeholderSvg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    const fileBuffer = fs.readFileSync(video.thumbnailPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to serve thumbnail' },
      { status: 500 }
    );
  }
}
