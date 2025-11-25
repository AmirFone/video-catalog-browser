'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import HoverScrubber from './HoverScrubber';
import { VideoWithSelection } from '@/app/lib/types';
import { formatDuration, formatFileSize } from '@/app/lib/utils';

type CopyOption = 'filename' | 'path';

interface VideoCardProps {
  video: VideoWithSelection;
  onSelect: (video: VideoWithSelection) => void;
  onToggleFavorite: (videoId: string, isFavorite: boolean) => void;
}

export default function VideoCard({ video, onSelect, onToggleFavorite }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copySuccess, setCopySuccess] = useState<CopyOption | null>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  // Close copy menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
      }
    };
    if (showCopyMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCopyMenu]);

  const handleClick = useCallback(() => {
    onSelect(video);
  }, [video, onSelect]);

  const handleFavoriteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite(video.id, !video.selection?.isFavorite);
  }, [video.id, video.selection?.isFavorite, onToggleFavorite]);

  const handleCopyClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowCopyMenu(!showCopyMenu);
  }, [showCopyMenu]);

  const handleCopy = useCallback(async (option: CopyOption, e: React.MouseEvent) => {
    e.stopPropagation();
    const textToCopy = option === 'filename' ? video.fileName : video.filePath;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(option);
      setTimeout(() => setCopySuccess(null), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
    setShowCopyMenu(false);
  }, [video.fileName, video.filePath]);

  const thumbnailUrl = video.thumbnailPath
    ? `/api/videos/${video.id}/thumbnail`
    : '/placeholder-video.svg';

  const spriteUrl = video.hasSprite
    ? `/api/videos/${video.id}/sprite`
    : null;

  return (
    <div
      className={`
        group relative rounded-lg overflow-hidden bg-card border transition-all duration-200 cursor-pointer
        ${isHovered ? 'border-accent ring-1 ring-accent' : 'border-card-border'}
        hover:scale-[1.02] hover:shadow-xl
      `}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Video thumbnail with hover scrub */}
      <div className="relative aspect-video bg-black">
        <HoverScrubber
          videoId={video.id}
          thumbnailUrl={thumbnailUrl}
          spriteUrl={spriteUrl}
          duration={video.duration}
          hasSprite={video.hasSprite}
          hasProxy={video.hasProxy}
        />

        {/* Top buttons row */}
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
          {/* Copy button with dropdown */}
          <div ref={copyMenuRef} className="relative">
            <button
              onClick={handleCopyClick}
              className={`
                w-8 h-8 rounded-full flex items-center justify-center
                transition-all duration-200
                ${copySuccess ? 'bg-success text-white' : 'bg-black/50 text-white/70 hover:bg-black/70 hover:text-white'}
              `}
              title="Copy"
            >
              {copySuccess ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>

            {/* Dropdown menu */}
            {showCopyMenu && (
              <div className="absolute top-full right-0 mt-1 bg-card border border-card-border rounded-lg shadow-xl overflow-hidden min-w-[140px]">
                <button
                  onClick={(e) => handleCopy('filename', e)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-accent/20 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Filename
                </button>
                <button
                  onClick={(e) => handleCopy('path', e)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-accent/20 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Full Path
                </button>
              </div>
            )}
          </div>

          {/* Favorite button */}
          <button
            onClick={handleFavoriteClick}
            className={`
              w-8 h-8 rounded-full flex items-center justify-center
              transition-all duration-200
              ${video.selection?.isFavorite
                ? 'bg-yellow-500 text-black'
                : 'bg-black/50 text-white/70 hover:bg-black/70 hover:text-white'
              }
            `}
          >
            <svg
              className="w-4 h-4"
              fill={video.selection?.isFavorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
          </button>
        </div>

        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-mono">
          {formatDuration(video.duration)}
        </div>

        {/* Proxy status badge */}
        <div className="absolute bottom-2 left-2">
          {video.hasProxy ? (
            <span className="bg-success/20 text-success px-2 py-1 rounded text-xs">
              Proxy Ready
            </span>
          ) : (
            <span className="bg-muted/20 text-muted px-2 py-1 rounded text-xs">
              No Proxy
            </span>
          )}
        </div>
      </div>

      {/* Video info */}
      <div className="p-3 bg-gradient-to-t from-card to-card/80">
        <h3 className="font-medium text-sm truncate mb-1" title={video.fileName}>
          {video.fileName}
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{formatFileSize(video.fileSize)}</span>
          <span>•</span>
          <span>{new Date(video.createdAt).toLocaleDateString()}</span>
        </div>

        {/* Notes preview if exists */}
        {video.selection?.notes && (
          <p className="mt-2 text-xs text-muted/80 truncate" title={video.selection.notes}>
            📝 {video.selection.notes}
          </p>
        )}
      </div>
    </div>
  );
}
