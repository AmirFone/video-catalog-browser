import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getCurrentRootPath } from '@/app/lib/db';

export async function POST() {
  try {
    const rootPath = getCurrentRootPath();
    if (!rootPath) {
      return NextResponse.json({ error: 'No root path set' }, { status: 400 });
    }

    const vcbDataPath = path.join(rootPath, '.vcb-data');
    await fs.rm(vcbDataPath, { recursive: true, force: true });

    return NextResponse.json({ success: true, message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('Failed to clear cache:', error);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
}
