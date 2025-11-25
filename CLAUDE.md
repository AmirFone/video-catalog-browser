# Video Catalog Browser - Claude Context

## Project Overview

A Next.js application for browsing large video collections on external drives. Scans directories for .mov/.mp4 files, generates 720p proxies for smooth scrubbing, and displays videos in a 4-column grid with hover-to-scrub thumbnails using sprite sheets.

## Tech Stack

- **Next.js 14.2.15** with App Router
- **React 18.3.1** + TypeScript
- **Tailwind CSS 4** for styling
- **SQLite** (better-sqlite3) for metadata storage
- **FFmpeg** for video processing (must be installed: `brew install ffmpeg`)

## Project Structure

```
app/
├── api/
│   ├── scan/route.ts           # POST: start scan, GET: scan status
│   ├── videos/
│   │   ├── route.ts            # GET: list videos with sorting
│   │   └── [id]/
│   │       ├── route.ts        # GET: single video details
│   │       ├── stream/route.ts # GET: stream video with range support
│   │       ├── thumbnail/route.ts
│   │       └── sprite/route.ts
│   ├── proxy/
│   │   ├── route.ts            # GET: proxy queue status
│   │   └── generate/route.ts   # POST: add to proxy queue
│   └── selections/route.ts     # GET/POST: favorites and notes
├── components/
│   ├── DropZone.tsx            # Directory path input
│   ├── VideoGrid.tsx           # Virtualized 4-column grid
│   ├── VideoCard.tsx           # Individual video thumbnail
│   ├── HoverScrubber.tsx       # Sprite-based hover scrubbing
│   ├── SortControls.tsx        # Sort dropdown
│   ├── ProxyProgress.tsx       # Proxy generation progress bar
│   ├── ScanProgress.tsx        # Enhanced scan progress with bar/sound
│   └── VideoModal.tsx          # Full video playback modal
├── hooks/                      # (planned for future refactoring)
├── lib/
│   ├── types.ts                # TypeScript interfaces
│   ├── db.ts                   # SQLite connection and queries
│   ├── ffmpeg.ts               # FFmpeg wrapper (server-side only)
│   ├── scanner.ts              # Directory scanning logic
│   └── utils.ts                # Client-safe utilities (formatDuration, formatFileSize)
├── globals.css                 # Dark theme CSS variables
├── layout.tsx                  # Root layout with Inter font
└── page.tsx                    # Main application page
```

Note: Database (`catalog.db`) is stored on the source drive in `.vcb-data/` folder.

## Key Implementation Details

### Centralized Data Storage
All data is stored in a single `.vcb-data/` folder at the root of the scanned directory (on source drive):
```
/Volumes/ExternalDrive/Videos/
├── .vcb-data/
│   ├── catalog.db          # SQLite database (portable with drive)
│   └── proxies/
│       ├── {hash}_proxy.mp4    # 720p proxy video
│       ├── {hash}_sprite.jpg   # Hover scrub sprite sheet
│       └── {hash}_thumb.jpg    # Grid thumbnail
├── Folder1/
│   └── Clip001.mov
└── Folder2/
    └── Clip002.mov
```

Benefits:
- **Portable**: Database travels with the external drive
- **No re-scanning**: Previously indexed videos are cached
- **Multi-drive support**: Each drive has its own database

### Skip Reprocessing (Incremental Scanning)
Videos are fingerprinted using file hash (first 64KB + size + mtime) to detect changes:
- **Already indexed videos** are skipped during re-scans
- **Modified files** are re-processed automatically
- **New files** are indexed and thumbnailed
- Shows separate counts for "Processed" vs "Cached" videos

### Enhanced Loading Screen
The scan progress UI includes:
- **Progress bar** showing total/processed/remaining videos
- **Phase indicators**: "Counting" → "Scanning" → "Complete"
- **Rolling status messages** that cycle every 3 seconds
- **Completion sound** (Web Audio API two-tone beep)
- **Stats display**: New, Cached, Total video counts

### Parallel Processing
Scanning uses bounded concurrency for performance:
- **4 concurrent ffprobe processes** for metadata extraction (p-limit)
- **Parallel FFmpeg per video**: thumbnail, sprite, proxy run simultaneously
- **Batch database inserts** using transactions

### Hover Scrubbing
Uses sprite sheets (not video seeking) for instant response:
- Sprite sheets contain 100 thumbnail frames in a 10x10 grid
- Generated via FFmpeg: `fps=1,scale=192:-1,tile=10x10`
- Mouse position maps to frame index, CSS background-position shows correct frame

### Database Schema
SQLite tables: `videos`, `selections`, `proxy_queue`, `scans`, `settings`

**Videos table** includes fingerprint columns for skip-reprocessing:
- `file_hash` - MD5 hash of first 64KB + size + mtime
- `file_mtime` - Last modification time
- `scanned_at` - When this video was last scanned

See `app/lib/db.ts` for full schema.

### Important: Client vs Server Code
- `app/lib/ffmpeg.ts` - Server-side only (uses child_process)
- `app/lib/utils.ts` - Client-safe utilities (formatDuration, formatFileSize)
- Components must import from `utils.ts`, not `ffmpeg.ts`

## Running the App

```bash
cd /Users/amirhossain/video-catalog-browser/video-catalog-browser
npm run dev
# Open http://localhost:3000
```

## Common Tasks

### Adding a new API endpoint
1. Create route file in `app/api/`
2. Import from `@/app/lib/db` for database operations
3. Use `NextRequest`/`NextResponse` from `next/server`

### Adding a new component
1. Create in `app/components/`
2. Add `'use client'` directive at top
3. Import utilities from `@/app/lib/utils` (not ffmpeg)

### Modifying the database schema
1. Update schema in `app/lib/db.ts` `initializeSchema()` function
2. Delete `data/catalog.db` to recreate (or add migration)

## Known Issues / Future Work

1. **Node.js version**: Works on Node 18, but Next.js 14+ prefers Node 20+
2. **Drag & drop**: Browser security prevents getting full path from dropped folders - users must paste path manually
3. **Large libraries**: Virtual scrolling implemented but may need optimization for 10,000+ videos
4. **Proxy generation**: Runs sequentially - could be parallelized for faster processing
5. **Export feature**: Selection export to JSON/text list not yet implemented

## FFmpeg Commands Used

**Thumbnail:**
```bash
ffmpeg -ss {time} -i input.mov -vframes 1 -vf "scale=384:-1" -q:v 5 output.jpg
```

**Sprite sheet:**
```bash
ffmpeg -i input.mov -vf "fps=1,scale=192:-1,tile=10x10" -frames:v 1 -q:v 5 sprite.jpg
```

**720p proxy:**
```bash
ffmpeg -i input.mov -vf "scale=-2:720" -c:v libx264 -crf 23 -preset fast -tune fastdecode -g 30 -c:a aac -b:a 128k -movflags +faststart output_proxy.mp4
```

## Design Decisions

- **Dark theme only**: Optimized for video editing workflow
- **SQLite over external DB**: Local-first, no server dependencies
- **Sprite sheets over video seeking**: Instant response, no buffering
- **720p proxies**: Good balance of quality and file size for scrubbing
- **4-column grid**: Optimal for viewing video thumbnails at a glance
