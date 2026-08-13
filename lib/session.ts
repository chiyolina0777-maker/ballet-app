import { cookies } from 'next/headers';
import crypto from 'crypto';

export const SESSION_COOKIE = 'session';

function secret() {
  return process.env.SESSION_SECRET || 'dev-secret-change-me';
}

// 署名付きセッション(HMAC-SHA256)。Supabase Authのセッションは使わず、
// 書き込みはすべてサーバー側(service role)経由で行う設計(README参照)
export function signSession(uid: string, days = 30) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + days * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token?: string): { uid: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.uid !== 'string' || data.exp < Date.now()) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}

export async function getSession() {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
