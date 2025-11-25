'use client';

import { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import VideoCard from './VideoCard';
import { VideoWithSelection } from '@/app/lib/types';

interface VideoGridProps {
  videos: VideoWithSelection[];
  isLoading: boolean;
  onSelectVideo: (video: VideoWithSelection) => void;
  onToggleFavorite: (videoId: string, isFavorite: boolean) => void;
}

// Number of columns in the grid
const COLUMNS = 4;
const GAP = 16; // Gap between cards in pixels
const CARD_ASPECT_RATIO = 0.85; // Height/Width ratio for cards (including info)

export default function VideoGrid({
  videos,
  isLoading,
  onSelectVideo,
  onToggleFavorite,
}: VideoGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Calculate rows for virtualization
  const rows = useMemo(() => {
    const result: VideoWithSelection[][] = [];
    for (let i = 0; i < videos.length; i += COLUMNS) {
      result.push(videos.slice(i, i + COLUMNS));
    }
    return result;
  }, [videos]);

  // Estimate row height based on container width
  const estimateRowHeight = () => {
    if (!parentRef.current) return 300;
    const containerWidth = parentRef.current.clientWidth;
    const cardWidth = (containerWidth - GAP * (COLUMNS - 1)) / COLUMNS;
    return cardWidth * CARD_ASPECT_RATIO + GAP;
  };

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowHeight,
    overscan: 2,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-lg overflow-hidden bg-card animate-pulse">
            <div className="aspect-video bg-card-border" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-card-border rounded w-3/4" />
              <div className="h-3 bg-card-border rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted">
        <svg
          className="w-16 h-16 mb-4 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <h3 className="text-lg font-medium mb-2">No videos found</h3>
        <p className="text-sm">Select a folder to scan for videos</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="absolute inset-0 overflow-auto"
    >
      <div
        className="relative w-full"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowVideos = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              className="absolute top-0 left-0 w-full px-4"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
                }}
              >
                {rowVideos.map((video) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    onSelect={onSelectVideo}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
                {/* Fill empty slots in last row */}
                {rowVideos.length < COLUMNS &&
                  Array.from({ length: COLUMNS - rowVideos.length }).map((_, i) => (
                    <div key={`empty-${i}`} />
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
