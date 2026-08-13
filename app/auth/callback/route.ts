import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, lineProfile, friendshipStatus } from '@/lib/line';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { signSession, SESSION_COOKIE } from '@/lib/session';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  const saved = req.cookies.get('line_state')?.value;

  let ctx: any = { r: '/' };
  try {
    ctx = JSON.parse(Buffer.from(String(state), 'base64url').toString());
  } catch {}
  const back = new URL(ctx.r || '/', req.url);

  const fail = () => {
    back.searchParams.set('error', 'login_failed');
    return NextResponse.redirect(back);
  };

  if (!code || !state || state !== saved) return fail();
  const sb = supabaseAdmin();
  if (!sb) return fail();

  try {
    const tok = await exchangeCode(code);
    const prof = await lineProfile(tok.access_token);
    const isFriend = await friendshipStatus(tok.access_token);

    // LINE userId → プロフィール(なければ auth.users + profiles を作成)
    const { data: existing } = await sb.from('profiles').select('id').eq('line_user_id', prof.userId).maybeSingle();
    let uid: string | undefined = existing?.id;
    if (!uid) {
      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email: `${prof.userId.toLowerCase()}@line.local`,
        email_confirm: true,
        user_metadata: { line_display_name: prof.displayName },
      });
      if (cErr || !created?.user) throw cErr ?? new Error('createUser failed');
      uid = created.user.id;
      await sb.from('profiles').insert({
        id: uid,
        display_name: prof.displayName,
        line_user_id: prof.userId,
        is_line_friend: isFriend,
      });
    } else {
      await sb.from('profiles').update({ display_name: prof.displayName, is_line_friend: isFriend }).eq('id', uid);
    }

    // 保留中の操作を自動再実行(§4)
    if (ctx.action === 'follow' && ctx.dancer_id) {
      await sb.from('follows').upsert({ user_id: uid, dancer_id: ctx.dancer_id });
      back.searchParams.set('focus', ctx.dancer_id);
    }
    if (ctx.action === 'follow_company' && ctx.company_id) {
      await sb.from('company_follows').upsert({ user_id: uid, company_id: ctx.company_id });
    }

    const res = NextResponse.redirect(back);
    res.cookies.set(SESSION_COOKIE, signSession(uid!), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 86400,
      path: '/',
    });
    res.cookies.set('line_state', '', { maxAge: 0, path: '/' });
    return res;
  } catch {
    return fail();
  }
}
