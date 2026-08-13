// LINE Login (OAuth2) + Messaging API 関連

export function lineConfigured() {
  return !!(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET);
}

export function authorizeUrl(state: string) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    state,
    scope: 'profile openid',
    // 同意画面に公式アカウントの友だち追加を併記(仕様書§4)
    bot_prompt: 'aggressive',
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ access_token: string }> {
  const res = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
      client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return res.json();
}

export async function lineProfile(accessToken: string): Promise<{ userId: string; displayName: string }> {
  const res = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return res.json();
}

// LINE Push(通知バッチ用)。失敗しても例外にせず false を返す
export async function pushText(to: string, text: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 友だち状態(§4)。ボット未リンク等で取れない場合は false 扱い
export async function friendshipStatus(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/friendship/v1/status', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const j = await res.json();
    return !!j.friendFlag;
  } catch {
    return false;
  }
}
