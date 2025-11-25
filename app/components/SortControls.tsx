'use client';

import { useState } from 'react';
import { SortOption } from '@/app/lib/types';

interface SortControlsProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
  videoCount: number;
  onClearCache?: () => void;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'date-desc', label: 'Newest First' },
  { value: 'date-asc', label: 'Oldest First' },
  { value: 'duration-desc', label: 'Longest First' },
  { value: 'duration-asc', label: 'Shortest First' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
];

export default function SortControls({ value, onChange, videoCount, onClearCache }: SortControlsProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' });
      if (res.ok) {
        setShowConfirm(false);
        onClearCache?.();
      }
    } catch (error) {
      console.error('Failed to clear cache:', error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-card-border">
      <div className="text-sm text-muted">
        {videoCount} video{videoCount !== 1 ? 's' : ''}
      </div>

      <div className="flex items-center gap-4">
        {/* Clear Cache Button */}
        <div className="relative">
          <button
            onClick={() => setShowConfirm(true)}
            className="
              px-3 py-1.5 text-sm rounded-lg transition-colors
              bg-card border border-card-border text-muted
              hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50
              flex items-center gap-2
            "
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear Cache
          </button>

          {/* Confirmation Dialog */}
          {showConfirm && (
            <div className="absolute right-0 top-full mt-2 bg-card border border-card-border rounded-lg shadow-xl p-4 z-50 min-w-[250px]">
              <p className="text-sm text-foreground mb-3">
                Delete all cached data? This will remove proxies, thumbnails, and the database.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-3 py-1.5 text-sm rounded-lg bg-card border border-card-border text-muted hover:text-foreground"
                  disabled={isClearing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearCache}
                  disabled={isClearing}
                  className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {isClearing ? 'Clearing...' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>

        <label className="text-sm text-muted">Sort by:</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as SortOption)}
          className="
            px-3 py-1.5 bg-card border border-card-border rounded-lg
            text-sm text-foreground
            focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
            cursor-pointer
          "
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
