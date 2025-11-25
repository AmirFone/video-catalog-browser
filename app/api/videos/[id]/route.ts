import { NextRequest, NextResponse } from 'next/server';
import { getVideoById, getSelectionByVideoId, isDatabaseInitialized } from '@/app/lib/db';

// GET: Get single video details
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

    const selection = getSelectionByVideoId(id);

    return NextResponse.json({
      success: true,
      video: {
        ...video,
        selection: selection || undefined,
      },
    });
  } catch (error) {
    console.error('Error fetching video:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch video' },
      { status: 500 }
    );
  }
}
