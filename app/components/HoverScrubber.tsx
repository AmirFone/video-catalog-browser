'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface HoverScrubberProps {
  videoId: string;
  thumbnailUrl: string;
  spriteUrl: string | null;
  duration: number;
  hasSprite: boolean;
  hasProxy: boolean;
}

export default function HoverScrubber({
  videoId,
  thumbnailUrl,
  duration,
  hasProxy,
}: HoverScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoReady, setVideoReady] = useState(false);

  // Video URL for scrubbing (use proxy if available)
  const videoUrl = hasProxy
    ? `/api/videos/${videoId}/stream?type=proxy`
    : `/api/videos/${videoId}/stream?type=original`;

  // Seek video when scrub position changes
  useEffect(() => {
    if (videoRef.current && videoReady && isHovering) {
      const seekTime = scrubPosition * duration;
      videoRef.current.currentTime = seekTime;
    }
  }, [scrubPosition, duration, videoReady, isHovering]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = Math.max(0, Math.min(1, x / rect.width));

    setScrubPosition(position);
    setCurrentTime(position * duration);
  }, [duration]);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setScrubPosition(0);
    setVideoReady(false);
  }, []);

  const handleVideoLoaded = useCallback(() => {
    setVideoReady(true);
  }, []);

  // Format time display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Thumbnail layer (visible when not hovering or video not ready) */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-150"
        style={{
          backgroundImage: `url(${thumbnailUrl})`,
          opacity: isHovering && videoReady ? 0 : 1,
        }}
      />

      {/* Video scrub layer (visible on hover) */}
      {isHovering && (
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: videoReady ? 1 : 0 }}
          muted
          playsInline
          preload="auto"
          onLoadedData={handleVideoLoaded}
        />
      )}

      {/* Scrub progress bar */}
      {isHovering && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
          <div
            className="h-full bg-accent transition-none"
            style={{ width: `${scrubPosition * 100}%` }}
          />
        </div>
      )}

      {/* Time indicator on hover */}
      {isHovering && (
        <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-xs font-mono">
          {formatTime(currentTime)}
        </div>
      )}

      {/* Loading indicator */}
      {isHovering && !videoReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
