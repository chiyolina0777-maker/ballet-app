import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { authorizeUrl, lineConfigured } from '@/lib/line';

// S9: LINEログイン開始。操作内容(redirect_to / action / dancer_id / company_id)を
// state に保持して認証後に自動再実行する(仕様書§4 認証ガードの原則)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const redirectTo = sp.get('redirect_to') || '/';
  const back = new URL(redirectTo, req.url);

  if (!lineConfigured()) {
    back.searchParams.set('error', 'line_unconfigured');
    return NextResponse.redirect(back);
  }

  const state = Buffer.from(
    JSON.stringify({
      r: redirectTo,
      action: sp.get('action') || undefined,
      dancer_id: sp.get('dancer_id') || undefined,
      company_id: sp.get('company_id') || undefined,
      n: crypto.randomBytes(8).toString('hex'),
    })
  ).toString('base64url');

  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set('line_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}
