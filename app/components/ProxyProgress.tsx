'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ProxyStatus } from '@/app/lib/types';

interface ProxyProgressProps {
  onGenerateAll: () => void;
  videosWithoutProxy: number;
}

export default function ProxyProgress({ onGenerateAll, videosWithoutProxy }: ProxyProgressProps) {
  const [status, setStatus] = useState<ProxyStatus>({
    isProcessing: false,
    currentJob: null,
    queue: [],
    completed: 0,
    total: 0,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch proxy status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/proxy');
      const data = await res.json();
      if (data.success) {
        const newStatus: ProxyStatus = {
          isProcessing: data.isProcessing,
          currentJob: data.currentJob,
          queue: data.queue || [],
          completed: data.completed || 0,
          total: data.total || 0,
        };
        setStatus(newStatus);

        // Update isGenerating based on actual status
        const stillGenerating = data.isProcessing || (data.queue?.length > 0);
        setIsGenerating(stillGenerating);

        return stillGenerating;
      }
    } catch (error) {
      console.error('Error fetching proxy status:', error);
    }
    return false;
  }, []);

  // Initial status fetch on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling effect - separate from initial fetch
  useEffect(() => {
    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Start polling if generating
    if (isGenerating) {
      pollIntervalRef.current = setInterval(fetchStatus, 1000); // Poll every second for responsive UI
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isGenerating, fetchStatus]);

  const handleGenerateAll = useCallback(async () => {
    // Set generating state immediately for responsive UI
    setIsGenerating(true);

    // Call the generate function
    onGenerateAll();

    // Start polling immediately after triggering
    setTimeout(fetchStatus, 500);
  }, [onGenerateAll, fetchStatus]);

  // Calculate progress values
  const queueLength = status.queue?.length || 0;
  const totalJobs = status.total || (status.completed + queueLength + (status.currentJob ? 1 : 0));
  const completedJobs = status.completed || 0;
  const percentage = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

  // Don't show if no videos need proxies and not generating
  if (!isGenerating && videosWithoutProxy === 0) {
    return null;
  }

  // Show generate button if videos need proxies and not generating
  if (!isGenerating && videosWithoutProxy > 0) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-card-border p-4 z-50">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-sm">
              <span className="text-warning">{videosWithoutProxy.toLocaleString()}</span> video{videosWithoutProxy !== 1 ? 's' : ''} without proxies
            </p>
            <p className="text-xs text-muted">
              Generate proxies for smooth scrubbing
            </p>
          </div>
          <button
            onClick={handleGenerateAll}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            Generate All Proxies
          </button>
        </div>
      </div>
    );
  }

  // Show progress while generating (always show something when isGenerating is true)
  if (isGenerating) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-card-border p-4 z-50">
        <div className="max-w-screen-xl mx-auto">
          <div className="flex items-center gap-4 mb-2">
            <div className="flex-1">
              <div className="h-2 bg-card-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
            <span className="text-sm text-muted whitespace-nowrap">
              {completedJobs.toLocaleString()} / {totalJobs.toLocaleString()} proxies ({percentage}%)
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            {status.currentJob ? (
              <span>Processing: {status.currentJob.progress}%</span>
            ) : (
              <span>Starting proxy generation...</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
