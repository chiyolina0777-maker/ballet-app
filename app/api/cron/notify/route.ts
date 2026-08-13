import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runNotifyBatch } from '@/lib/notify-batch';

export const maxDuration = 60;

// 通知バッチの入口。Vercel Cron(JST 9:00/18:00)が Authorization: Bearer CRON_SECRET 付きで呼ぶ
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const stats = await runNotifyBatch(sb);
  return NextResponse.json(stats);
}
