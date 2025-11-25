'use client';

import { useState, useCallback, useRef } from 'react';

interface DropZoneProps {
  onDirectorySelected: (path: string) => void;
  currentPath: string | null;
  isScanning: boolean;
}

export default function DropZone({ onDirectorySelected, currentPath, isScanning }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [manualPath, setManualPath] = useState(currentPath || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Try to get the path from dropped items
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const item = items[0];

      // Try webkitGetAsEntry for directory support
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        // Unfortunately, we can't get the full path from webkitGetAsEntry
        // The user needs to enter it manually for security reasons
        alert('Due to browser security, please paste the folder path in the input field.\n\nYou can get the path by right-clicking the folder in Finder and holding Option to "Copy as Pathname"');
        inputRef.current?.focus();
        return;
      }

      // For files, try to extract directory path
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        // File objects in the browser don't expose the full path for security
        // Direct the user to paste the path
        alert('Due to browser security, please paste the folder path in the input field.\n\nYou can get the path by right-clicking the folder in Finder and holding Option to "Copy as Pathname"');
        inputRef.current?.focus();
      }
    }
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (manualPath.trim() && !isScanning) {
      onDirectorySelected(manualPath.trim());
    }
  }, [manualPath, isScanning, onDirectorySelected]);

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-8 transition-all duration-200
          ${isDragging
            ? 'border-accent bg-accent/10 scale-[1.02]'
            : 'border-card-border hover:border-muted'
          }
          ${isScanning ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <div className="text-center">
          <div className="mb-4">
            <svg
              className={`mx-auto w-12 h-12 transition-colors ${isDragging ? 'text-accent' : 'text-muted'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </div>

          <h3 className="text-lg font-medium mb-2">
            {isDragging ? 'Drop folder here' : 'Select Video Folder'}
          </h3>

          <p className="text-sm text-muted mb-6">
            Enter the path to your video folder (e.g., /Volumes/Drive/Videos)
          </p>

          <form onSubmit={handleSubmit} className="max-w-xl mx-auto">
            <div className="flex gap-3">
              <input
                ref={inputRef}
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="/Volumes/ExternalDrive/Videos"
                disabled={isScanning}
                className="
                  flex-1 px-4 py-3 bg-background border border-card-border rounded-lg
                  text-foreground placeholder:text-muted
                  focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
                  disabled:opacity-50
                "
              />
              <button
                type="submit"
                disabled={!manualPath.trim() || isScanning}
                className="
                  px-6 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg
                  transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                {isScanning ? 'Scanning...' : 'Scan'}
              </button>
            </div>
          </form>

          {currentPath && (
            <div className="mt-4 text-sm text-muted">
              Current: <span className="text-foreground font-mono">{currentPath}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 text-xs text-muted text-center">
        Tip: In Finder, right-click folder → Hold Option → &quot;Copy as Pathname&quot;
      </div>
    </div>
  );
}
