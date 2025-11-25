import { NextResponse } from 'next/server';
import { getProxyQueueStatus, isDatabaseInitialized } from '@/app/lib/db';

// GET: Get proxy generation queue status
export async function GET() {
  try {
    // Check if database is initialized
    if (!isDatabaseInitialized()) {
      return NextResponse.json({
        success: true,
        isProcessing: false,
        currentJob: null,
        queue: [],
        completed: 0,
        total: 0,
      });
    }

    const status = getProxyQueueStatus();

    return NextResponse.json({
      success: true,
      isProcessing: status.currentJob !== null,
      currentJob: status.currentJob,
      queue: status.queue,
      completed: status.completed,
      total: status.total,
    });
  } catch (error) {
    console.error('Error getting proxy status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get proxy status' },
      { status: 500 }
    );
  }
}
