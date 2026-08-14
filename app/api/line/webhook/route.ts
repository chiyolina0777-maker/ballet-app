import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';

// LINE Messaging API webhook(仕様書§4: 友だち状態の正はwebhook)
// follow = 友だち追加/ブロック解除 → is_line_friend=true
// unfollow = ブロック → is_line_friend=false
// 署名検証: X-Line-Signature = HMAC-SHA256(body, LINE_CHANNEL_SECRET) の base64
export async function POST(req: NextRequest) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 500 });

  const body = await req.text();
  const sig = req.headers.get('x-line-signature') ?? '';
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(body || '{}');
  } catch {}
  const events: any[] = payload.events ?? [];

  const sb = supabaseAdmin();
  if (sb) {
    for (const ev of events) {
      const lineUserId = ev?.source?.userId;
      if (!lineUserId) continue;
      if (ev.type === 'follow') {
        await sb.from('profiles').update({ is_line_friend: true }).eq('line_user_id', lineUserId);
      } else if (ev.type === 'unfollow') {
        await sb.from('profiles').update({ is_line_friend: false }).eq('line_user_id', lineUserId);
      }
      // それ以外のイベント(message等)はフェーズ1では無視
    }
  }

  // LINEには常に200を返す(検証リクエスト=events空 も含む)
  return NextResponse.json({ ok: true });
}
