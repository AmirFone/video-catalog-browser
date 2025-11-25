import { NextRequest, NextResponse } from 'next/server';
import { getAllVideos, getVideosByDirectory, getSelectionByVideoId, isDatabaseInitialized, initDatabase } from '@/app/lib/db';
import { SortOption, VideoWithSelection } from '@/app/lib/types';

// GET: List videos with optional filtering and sorting
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const directory = searchParams.get('directory');
    const sortBy = (searchParams.get('sort') || 'date-desc') as SortOption;
    const favoritesOnly = searchParams.get('favorites') === 'true';

    // Initialize database if directory is provided and not yet initialized
    if (directory && !isDatabaseInitialized()) {
      initDatabase(directory);
    }

    // Return empty if database not initialized
    if (!isDatabaseInitialized()) {
      return NextResponse.json({
        success: true,
        videos: [],
        total: 0,
      });
    }

    // Get videos
    let videos = directory
      ? getVideosByDirectory(directory, sortBy)
      : getAllVideos(sortBy);

    // Add selection data to each video
    const videosWithSelections: VideoWithSelection[] = videos.map((video) => {
      const selection = getSelectionByVideoId(video.id);
      return {
        ...video,
        selection: selection || undefined,
      };
    });

    // Filter to favorites only if requested
    const filteredVideos = favoritesOnly
      ? videosWithSelections.filter((v) => v.selection?.isFavorite)
      : videosWithSelections;

    return NextResponse.json({
      success: true,
      videos: filteredVideos,
      total: filteredVideos.length,
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch videos' },
      { status: 500 }
    );
  }
}
