'use client';

import { useState, useEffect, useCallback } from 'react';
import DropZone from './components/DropZone';
import VideoGrid from './components/VideoGrid';
import SortControls from './components/SortControls';
import ProxyProgress from './components/ProxyProgress';
import VideoModal from './components/VideoModal';
import ScanProgress from './components/ScanProgress';
import { VideoWithSelection, SortOption } from './lib/types';

type ViewMode = 'all' | 'favorites';

// Extended scan progress state
interface ScanState {
  status: 'idle' | 'counting' | 'scanning' | 'complete' | 'error';
  phase: 'count' | 'metadata' | 'done';
  totalVideos: number;
  videosProcessed: number;
  videosSkipped: number;
  currentFile: string;
  message: string;
}

export default function Home() {
  // State
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoWithSelection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scanState, setScanState] = useState<ScanState>({
    status: 'idle',
    phase: 'done',
    totalVideos: 0,
    videosProcessed: 0,
    videosSkipped: 0,
    currentFile: '',
    message: '',
  });
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [selectedVideo, setSelectedVideo] = useState<VideoWithSelection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isScanning = scanState.status === 'scanning' || scanState.status === 'counting';

  // Fetch videos from API
  const fetchVideos = useCallback(async () => {
    if (!currentPath) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        directory: currentPath,
        sort: sortBy,
        favorites: viewMode === 'favorites' ? 'true' : 'false',
      });

      const res = await fetch(`/api/videos?${params}`);
      const data = await res.json();

      if (data.success) {
        setVideos(data.videos);
      } else {
        setError(data.error || 'Failed to fetch videos');
      }
    } catch (err) {
      setError('Failed to fetch videos');
      console.error('Error fetching videos:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, sortBy, viewMode]);

  // Poll scan status
  useEffect(() => {
    if (!isScanning && scanState.status !== 'complete') return;

    // If complete, fetch videos once and exit
    if (scanState.status === 'complete') {
      fetchVideos();
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/scan');
        const data = await res.json();

        if (data.success) {
          setScanState({
            status: data.status,
            phase: data.phase || 'done',
            totalVideos: data.totalVideos || 0,
            videosProcessed: data.videosProcessed || 0,
            videosSkipped: data.videosSkipped || 0,
            currentFile: data.currentFile || '',
            message: data.message || '',
          });

          if (data.status === 'complete') {
            // Update path if we got it from the scan
            if (data.rootPath && !currentPath) {
              setCurrentPath(data.rootPath);
            }
          } else if (data.status === 'error') {
            setError(data.message || 'Scan failed');
          }
        }
      } catch (err) {
        console.error('Error polling scan status:', err);
      }
    }, 500); // Poll every 500ms for smoother progress updates

    return () => clearInterval(interval);
  }, [isScanning, scanState.status, fetchVideos, currentPath]);

  // Fetch videos when path or sort changes
  useEffect(() => {
    if (currentPath && !isScanning && scanState.status !== 'complete') {
      fetchVideos();
    }
  }, [currentPath, sortBy, viewMode, isScanning, scanState.status, fetchVideos]);

  // Check for last directory on mount
  useEffect(() => {
    const checkLastDirectory = async () => {
      try {
        const res = await fetch('/api/scan');
        const data = await res.json();
        if (data.success && data.lastDirectory) {
          setCurrentPath(data.lastDirectory);
        }
      } catch (err) {
        console.error('Error checking last directory:', err);
      }
    };

    checkLastDirectory();
  }, []);

  // Handle directory selection
  const handleDirectorySelected = useCallback(async (path: string) => {
    setError(null);
    setCurrentPath(path);

    // Reset scan state
    setScanState({
      status: 'counting',
      phase: 'count',
      totalVideos: 0,
      videosProcessed: 0,
      videosSkipped: 0,
      currentFile: '',
      message: 'Starting scan...',
    });

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to start scan');
        setScanState(prev => ({ ...prev, status: 'error', message: data.error }));
      }
    } catch (err) {
      setError('Failed to start scan');
      setScanState(prev => ({ ...prev, status: 'error', message: 'Failed to start scan' }));
      console.error('Error starting scan:', err);
    }
  }, []);

  // Handle scan complete
  const handleScanComplete = useCallback(() => {
    // Scan complete sound is played by ScanProgress component
    // Reset to idle after a brief delay
    setTimeout(() => {
      setScanState(prev => ({ ...prev, status: 'idle' }));
    }, 2000);
  }, []);

  // Handle video selection for modal
  const handleSelectVideo = useCallback((video: VideoWithSelection) => {
    setSelectedVideo(video);
  }, []);

  // Handle favorite toggle
  const handleToggleFavorite = useCallback(async (videoId: string, isFavorite: boolean) => {
    try {
      const res = await fetch('/api/selections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, isFavorite }),
      });

      const data = await res.json();

      if (data.success) {
        // Update local state
        setVideos((prev) =>
          prev.map((v) =>
            v.id === videoId
              ? { ...v, selection: { ...v.selection, ...data.selection } }
              : v
          )
        );

        // Update selected video if open
        if (selectedVideo?.id === videoId) {
          setSelectedVideo((prev) =>
            prev ? { ...prev, selection: { ...prev.selection, ...data.selection } } : null
          );
        }
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  }, [selectedVideo?.id]);

  // Handle notes update
  const handleUpdateNotes = useCallback(async (videoId: string, notes: string) => {
    try {
      const video = videos.find((v) => v.id === videoId);
      const res = await fetch('/api/selections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          isFavorite: video?.selection?.isFavorite || false,
          notes,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // Update local state
        setVideos((prev) =>
          prev.map((v) =>
            v.id === videoId
              ? { ...v, selection: { ...v.selection, ...data.selection } }
              : v
          )
        );

        // Update selected video if open
        if (selectedVideo?.id === videoId) {
          setSelectedVideo((prev) =>
            prev ? { ...prev, selection: { ...prev.selection, ...data.selection } } : null
          );
        }
      }
    } catch (err) {
      console.error('Error updating notes:', err);
    }
  }, [videos, selectedVideo?.id]);

  // Handle generate all proxies
  const handleGenerateAllProxies = useCallback(async () => {
    try {
      await fetch('/api/proxy/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch (err) {
      console.error('Error generating proxies:', err);
    }
  }, []);

  // Count videos without proxies
  const videosWithoutProxy = videos.filter((v) => !v.hasProxy).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-card-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-screen-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Video Catalog Browser</h1>
              <p className="text-sm text-muted">Quick preview of your entire video catalog</p>
            </div>

            {currentPath && !isScanning && videos.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewMode('all')}
                  className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                    viewMode === 'all'
                      ? 'bg-accent text-white'
                      : 'bg-card-border text-muted hover:text-foreground'
                  }`}
                >
                  All Videos
                </button>
                <button
                  onClick={() => setViewMode('favorites')}
                  className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                    viewMode === 'favorites'
                      ? 'bg-accent text-white'
                      : 'bg-card-border text-muted hover:text-foreground'
                  }`}
                >
                  Favorites
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col">
        {/* Directory selector (always visible when no videos) */}
        {(!currentPath || videos.length === 0) && !isScanning && scanState.status !== 'complete' && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-2xl">
              <DropZone
                onDirectorySelected={handleDirectorySelected}
                currentPath={currentPath}
                isScanning={isScanning}
              />
            </div>
          </div>
        )}

        {/* Enhanced scanning progress */}
        {(isScanning || scanState.status === 'complete') && (
          <div className="flex-1 flex items-center justify-center">
            <ScanProgress
              status={scanState.status}
              phase={scanState.phase}
              totalVideos={scanState.totalVideos}
              videosProcessed={scanState.videosProcessed}
              videosSkipped={scanState.videosSkipped}
              currentFile={scanState.currentFile}
              message={scanState.message}
              onComplete={handleScanComplete}
            />
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mx-4 mt-4 p-4 bg-error/10 border border-error/20 rounded-lg text-error">
            {error}
          </div>
        )}

        {/* Video grid */}
        {currentPath && videos.length > 0 && !isScanning && scanState.status !== 'complete' && (
          <div className="flex-1 flex flex-col">
            {/* Sort controls & folder selector */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    setCurrentPath(null);
                    setVideos([]);
                  }}
                  className="text-sm text-muted hover:text-foreground flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Change folder
                </button>
                <span className="text-sm text-muted truncate max-w-md" title={currentPath}>
                  {currentPath}
                </span>
              </div>
              <SortControls
                value={sortBy}
                onChange={setSortBy}
                videoCount={videos.length}
                onClearCache={() => {
                  setCurrentPath(null);
                  setVideos([]);
                }}
              />
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-hidden relative">
              <VideoGrid
                videos={videos}
                isLoading={isLoading}
                onSelectVideo={handleSelectVideo}
                onToggleFavorite={handleToggleFavorite}
              />
            </div>
          </div>
        )}
      </main>

      {/* Proxy progress bar */}
      <ProxyProgress
        onGenerateAll={handleGenerateAllProxies}
        videosWithoutProxy={videosWithoutProxy}
      />

      {/* Video modal */}
      {selectedVideo && (
        <VideoModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          onToggleFavorite={handleToggleFavorite}
          onUpdateNotes={handleUpdateNotes}
        />
      )}
    </div>
  );
}
