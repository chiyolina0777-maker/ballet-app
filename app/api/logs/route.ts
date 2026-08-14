import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase-admin';

// S7: 観劇ログの作成/更新。過去の公演回のみ記録可能(仕様書§3)
// is_public は常に false(フェーズ1では公開機能なし)
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const { show_id, seat, memo } = await req.json().catch(() => ({}));
  if (!show_id) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const { data: show } = await sb.from('shows').select('id,starts_at').eq('id', show_id).single();
  if (!show) return NextResponse.json({ error: 'show not found' }, { status: 404 });
  if (new Date(show.starts_at) >= new Date()) {
    return NextResponse.json({ error: '過去の公演回のみ記録できます' }, { status: 400 });
  }

  const { error } = await sb.from('theater_logs').upsert(
    {
      user_id: session.uid,
      show_id,
      seat: seat?.trim() || null,
      memo: memo?.trim() || null,
      is_public: false,
    },
    { onConflict: 'user_id,show_id' }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const { show_id } = await req.json().catch(() => ({}));
  if (!show_id) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { error } = await sb.from('theater_logs').delete().eq('user_id', session.uid).eq('show_id', show_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
