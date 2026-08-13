import { NextRequest, NextResponse } from 'next/server';
import { adminFromRequest } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

// A2-2: 公演回の一括追加(通知は発生しない)
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const { performance_id, starts_at_list } = await req.json().catch(() => ({}));
  if (!performance_id || !Array.isArray(starts_at_list) || starts_at_list.length === 0) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const rows = starts_at_list.map((at: string) => ({ performance_id, starts_at: at }));
  const { data, error } = await sb.from('shows').insert(rows).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ created: data?.length ?? 0 });
}

// 公演回の削除(観劇ログが紐づく回は不可 = 仕様書§3)
export async function DELETE(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const { show_id } = await req.json().catch(() => ({}));
  if (!show_id) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const { data: logs } = await sb.from('theater_logs').select('id').eq('show_id', show_id).limit(1);
  if (logs && logs.length) {
    return NextResponse.json({ error: '観劇ログが紐づいているため削除できません' }, { status: 409 });
  }
  const { error } = await sb.from('shows').delete().eq('id', show_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
