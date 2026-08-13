import type { NextRequest } from 'next/server';
import { getSession, verifySession, SESSION_COOKIE } from './session';

// 管理者判定は環境変数 ADMIN_USER_IDS(カンマ区切りUUID)。仕様書§3の決定事項
export function isAdminUid(uid: string) {
  return (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(uid);
}

export async function getAdminSession() {
  const s = await getSession();
  if (!s || !isAdminUid(s.uid)) return null;
  return s;
}

export function adminFromRequest(req: NextRequest) {
  const s = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s || !isAdminUid(s.uid)) return null;
  return s;
}
