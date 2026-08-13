import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase-admin';

// フォローのトグル。RLS上は本人のみ書き込み可だが、本アプリの書き込みは
// すべてサーバー経由(セッション検証 + service role)で行う
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const { type, id } = body ?? {};
  if (!id || (type !== 'dancer' && type !== 'company')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const table = type === 'dancer' ? 'follows' : 'company_follows';
  const col = type === 'dancer' ? 'dancer_id' : 'company_id';

  const { data: existing } = await sb.from(table).select(col).eq('user_id', session.uid).eq(col, id).maybeSingle();
  if (existing) {
    await sb.from(table).delete().eq('user_id', session.uid).eq(col, id);
    return NextResponse.json({ following: false });
  }
  const { error } = await sb.from(table).insert({ user_id: session.uid, [col]: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ following: true });
}
