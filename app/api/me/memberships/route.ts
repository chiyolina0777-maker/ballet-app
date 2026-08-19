import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase-admin';

// 加入している会員組織のトグル(v1.3追補§6.3)。
// 任意入力。未設定(0件)のユーザーには会員先行通知も送る(漏れるより過剰なほうが害が小さい)
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const { org_id } = body ?? {};
  if (!org_id) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const { data: existing } = await sb
    .from('user_memberships')
    .select('membership_org_id')
    .eq('user_id', session.uid)
    .eq('membership_org_id', org_id)
    .maybeSingle();
  if (existing) {
    await sb.from('user_memberships').delete().eq('user_id', session.uid).eq('membership_org_id', org_id);
    return NextResponse.json({ member: false });
  }
  const { error } = await sb.from('user_memberships').insert({ user_id: session.uid, membership_org_id: org_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ member: true });
}
