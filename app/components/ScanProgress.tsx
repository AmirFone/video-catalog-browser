'use client';

import { useEffect, useRef, useCallback } from 'react';

interface ScanProgressProps {
  status: 'counting' | 'scanning' | 'complete' | 'error' | 'idle';
  phase: 'count' | 'metadata' | 'done';
  totalVideos: number;
  videosProcessed: number;
  videosSkipped: number;
  currentFile: string;
  message: string;
  onComplete?: () => void;
}

export default function ScanProgress({
  status,
  phase,
  totalVideos,
  videosProcessed,
  videosSkipped,
  currentFile,
  message,
  onComplete,
}: ScanProgressProps) {
  const hasPlayedSound = useRef(false);

  // Play completion sound using Web Audio API
  const playCompletionSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      // Create a pleasant two-tone completion sound
      const playTone = (frequency: number, startTime: number, duration: number) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Envelope for smooth sound
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      // Two ascending tones for completion
      playTone(523.25, audioContext.currentTime, 0.15); // C5
      playTone(659.25, audioContext.currentTime + 0.15, 0.2); // E5
    } catch (error) {
      console.error('Failed to play completion sound:', error);
    }
  }, []);

  // Play sound on completion
  useEffect(() => {
    if (status === 'complete' && !hasPlayedSound.current) {
      hasPlayedSound.current = true;
      playCompletionSound();
      onComplete?.();
    }

    // Reset sound flag when new scan starts
    if (status === 'counting' || status === 'scanning') {
      hasPlayedSound.current = false;
    }
  }, [status, playCompletionSound, onComplete]);

  // Calculate progress percentage
  const progressPercent = totalVideos > 0
    ? Math.round(((videosProcessed + videosSkipped) / totalVideos) * 100)
    : 0;

  // Get filename from path for display
  const fileName = currentFile ? currentFile.split('/').pop() || currentFile : '';

  // Render based on status
  if (status === 'idle') return null;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-2xl mx-auto p-8">
      {/* Spinner or checkmark */}
      <div className="mb-6">
        {status === 'complete' ? (
          <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : status === 'error' ? (
          <div className="w-16 h-16 bg-error/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        ) : (
          <div className="w-16 h-16 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
        )}
      </div>

      {/* Main status message */}
      <h3 className="text-lg font-medium mb-2 text-center">{message}</h3>

      {/* Progress bar (only during scanning) */}
      {(status === 'scanning' || status === 'counting') && totalVideos > 0 && (
        <div className="w-full mb-4">
          {/* Progress bar container */}
          <div className="w-full h-4 bg-card-border rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-accent to-accent-hover transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Progress text */}
          <div className="flex justify-between text-sm text-muted">
            <span>
              {videosProcessed + videosSkipped} / {totalVideos} videos
            </span>
            <span>{progressPercent}%</span>
          </div>
        </div>
      )}

      {/* Counting phase indicator */}
      {status === 'counting' && (
        <div className="text-center mb-4">
          <p className="text-2xl font-bold text-accent mb-1">
            {totalVideos.toLocaleString()} videos found
          </p>
          <p className="text-sm text-muted">Counting files...</p>
        </div>
      )}

      {/* Detailed stats during scan */}
      {status === 'scanning' && (
        <div className="flex gap-6 mb-4 text-center">
          <div>
            <p className="text-2xl font-bold text-accent">{videosProcessed.toLocaleString()}</p>
            <p className="text-xs text-muted uppercase tracking-wider">Processed</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-success">{videosSkipped.toLocaleString()}</p>
            <p className="text-xs text-muted uppercase tracking-wider">Cached</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{totalVideos.toLocaleString()}</p>
            <p className="text-xs text-muted uppercase tracking-wider">Total</p>
          </div>
        </div>
      )}

      {/* Completion stats */}
      {status === 'complete' && (
        <div className="flex gap-6 mb-4 text-center">
          <div>
            <p className="text-2xl font-bold text-accent">{videosProcessed.toLocaleString()}</p>
            <p className="text-xs text-muted uppercase tracking-wider">New</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-success">{videosSkipped.toLocaleString()}</p>
            <p className="text-xs text-muted uppercase tracking-wider">Cached</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{totalVideos.toLocaleString()}</p>
            <p className="text-xs text-muted uppercase tracking-wider">Total</p>
          </div>
        </div>
      )}

      {/* Current file being processed */}
      {(status === 'scanning' || status === 'counting') && fileName && (
        <p className="text-sm text-muted truncate max-w-full" title={currentFile}>
          {fileName}
        </p>
      )}
    </div>
  );
}
