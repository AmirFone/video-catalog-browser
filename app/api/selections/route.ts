import { NextRequest, NextResponse } from 'next/server';
import { upsertSelection, getFavorites, getAllSelections, getVideoById, isDatabaseInitialized } from '@/app/lib/db';

// GET: Get all selections or favorites
export async function GET(request: NextRequest) {
  try {
    // Check if database is initialized
    if (!isDatabaseInitialized()) {
      return NextResponse.json({
        success: true,
        selections: [],
        total: 0,
      });
    }

    const { searchParams } = new URL(request.url);
    const favoritesOnly = searchParams.get('favorites') === 'true';

    const selections = favoritesOnly ? getFavorites() : getAllSelections();

    // Include video data with selections
    const selectionsWithVideos = selections.map((selection) => {
      const video = getVideoById(selection.videoId);
      return {
        ...selection,
        video,
      };
    });

    return NextResponse.json({
      success: true,
      selections: selectionsWithVideos,
      total: selectionsWithVideos.length,
    });
  } catch (error) {
    console.error('Error fetching selections:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch selections' },
      { status: 500 }
    );
  }
}

// POST: Create or update a selection
export async function POST(request: NextRequest) {
  try {
    // Check if database is initialized
    if (!isDatabaseInitialized()) {
      return NextResponse.json(
        { success: false, error: 'No video library loaded' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { videoId, isFavorite, notes } = body;

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: 'videoId is required' },
        { status: 400 }
      );
    }

    // Verify video exists
    const video = getVideoById(videoId);
    if (!video) {
      return NextResponse.json(
        { success: false, error: 'Video not found' },
        { status: 404 }
      );
    }

    const selection = upsertSelection(
      videoId,
      isFavorite ?? false,
      notes ?? ''
    );

    return NextResponse.json({
      success: true,
      selection,
    });
  } catch (error) {
    console.error('Error updating selection:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update selection' },
      { status: 500 }
    );
  }
}
