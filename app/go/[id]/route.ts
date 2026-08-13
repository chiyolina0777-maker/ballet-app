import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// S10 計測リダイレクト: click_events に記録して ticket_url へ302
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const src = req.nextUrl.searchParams.get('src') ?? 'web';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return NextResponse.redirect(new URL('/', req.url));

  const pub = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: perf } = await pub.from('performances').select('id,ticket_url').eq('id', id).single();

  // ticket_url 未設定なら S3 に戻す(仕様書 S10)
  if (!perf?.ticket_url) return NextResponse.redirect(new URL(`/performances/${id}`, req.url));

  // 計測(click_events はRLSでservice roleのみ書き込み可)
  if (serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const allowed = ['line', 'web', 'share'];
    await admin.from('click_events').insert({
      performance_id: id,
      source: allowed.includes(src) ? src : 'web',
    });
  }

  return NextResponse.redirect(perf.ticket_url, 302);
}
