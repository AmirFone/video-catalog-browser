'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { VideoWithSelection } from '@/app/lib/types';
import { formatDuration, formatFileSize } from '@/app/lib/utils';

interface VideoModalProps {
  video: VideoWithSelection;
  onClose: () => void;
  onToggleFavorite: (videoId: string, isFavorite: boolean) => void;
  onUpdateNotes: (videoId: string, notes: string) => void;
}

export default function VideoModal({
  video,
  onClose,
  onToggleFavorite,
  onUpdateNotes,
}: VideoModalProps) {
  const [notes, setNotes] = useState(video.selection?.notes || '');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleSaveNotes = useCallback(() => {
    onUpdateNotes(video.id, notes);
    setIsEditingNotes(false);
  }, [video.id, notes, onUpdateNotes]);

  const handleFavoriteClick = useCallback(() => {
    onToggleFavorite(video.id, !video.selection?.isFavorite);
  }, [video.id, video.selection?.isFavorite, onToggleFavorite]);

  const videoUrl = video.hasProxy
    ? `/api/videos/${video.id}/stream?type=proxy`
    : `/api/videos/${video.id}/stream?type=original`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[90vh] bg-card rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Video player */}
        <div className="relative bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            className="w-full max-h-[60vh] object-contain"
          />

          {/* No proxy warning */}
          {!video.hasProxy && (
            <div className="absolute top-4 left-4 bg-warning/20 text-warning px-3 py-1.5 rounded-lg text-sm">
              ⚠️ Playing original file - may buffer with large 4K files
            </div>
          )}
        </div>

        {/* Video info panel */}
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold mb-1">{video.fileName}</h2>
              <div className="flex items-center gap-3 text-sm text-muted">
                <span>{formatDuration(video.duration)}</span>
                <span>•</span>
                <span>{formatFileSize(video.fileSize)}</span>
                <span>•</span>
                <span>{video.width}×{video.height}</span>
                <span>•</span>
                <span>{new Date(video.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Favorite button */}
            <button
              onClick={handleFavoriteClick}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
                ${video.selection?.isFavorite
                  ? 'bg-yellow-500/20 text-yellow-500'
                  : 'bg-card-border hover:bg-muted/20 text-muted hover:text-foreground'
                }
              `}
            >
              <svg
                className="w-5 h-5"
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
              <span>{video.selection?.isFavorite ? 'Favorited' : 'Add to Favorites'}</span>
            </button>
          </div>

          {/* File path */}
          <div className="mb-4">
            <label className="text-xs text-muted uppercase tracking-wider">File Path</label>
            <p className="text-sm font-mono bg-background px-3 py-2 rounded mt-1 break-all">
              {video.filePath}
            </p>
          </div>

          {/* Notes section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted uppercase tracking-wider">Notes</label>
              {!isEditingNotes && (
                <button
                  onClick={() => setIsEditingNotes(true)}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  {notes ? 'Edit' : 'Add notes'}
                </button>
              )}
            </div>

            {isEditingNotes ? (
              <div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this clip..."
                  className="
                    w-full h-24 px-3 py-2 bg-background border border-card-border rounded-lg
                    text-sm text-foreground placeholder:text-muted resize-none
                    focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
                  "
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => {
                      setNotes(video.selection?.notes || '');
                      setIsEditingNotes(false);
                    }}
                    className="px-3 py-1.5 text-sm text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveNotes}
                    className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted bg-background px-3 py-2 rounded min-h-[2.5rem]">
                {notes || 'No notes added'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
