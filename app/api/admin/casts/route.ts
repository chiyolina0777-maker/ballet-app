import { NextRequest, NextResponse } from 'next/server';
import { adminFromRequest } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

// フォロワー数プレビュー(distinct user)。GET /api/admin/casts?dancer_ids=a,b
export async function GET(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const ids = (req.nextUrl.searchParams.get('dancer_ids') || '').split(',').filter(Boolean);
  if (!ids.length) return NextResponse.json({ count: 0 });
  const { data, error } = await sb.from('follows').select('user_id').in('dancer_id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const distinct = new Set((data ?? []).map((r: any) => r.user_id));
  return NextResponse.json({ count: distinct.size });
}

// A2-3: キャスト保存。publish=false は下書き(通知なし)、true は公開+通知キュー登録
// 送信は9:00/18:00のバッチ(§6)。ここでは送信しない
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { show_id, performance_id, source_url, publish, casts } = body;

  if (!show_id || !source_url?.trim()) {
    return NextResponse.json({ error: '出典URLは必須です' }, { status: 400 });
  }
  const rows = (casts ?? []).filter((c: any) => c.dancer_id && c.role_name?.trim());
  if (!rows.length) return NextResponse.json({ error: '役名+ダンサーの組を1件以上入力してください' }, { status: 400 });

  // 既存公開状態を確認(発表済みへの変更なら kind=cast_changed)
  const { data: prev } = await sb.from('casts').select('id,is_published').eq('show_id', show_id);
  const wasPublished = (prev ?? []).some((c: any) => c.is_published);

  // 置換保存(プロトタイプ同様。履歴運用は将来 status 更新方式に寄せる)
  await sb.from('casts').delete().eq('show_id', show_id);
  const insertRows = rows.map((c: any) => ({
    show_id,
    dancer_id: c.dancer_id,
    role_name: c.role_name.trim(),
    status: ['scheduled', 'changed', 'cancelled'].includes(c.status) ? c.status : 'scheduled',
    source_url: source_url.trim(),
    is_published: !!publish,
  }));
  const { error } = await sb.from('casts').insert(insertRows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let queued = false;
  let queueError: string | undefined;
  if (publish) {
    const dancerIds = [...new Set(insertRows.filter((r) => r.status !== 'cancelled').map((r) => r.dancer_id))];
    const { error: qErr } = await sb.from('notification_queue').insert({
      kind: wasPublished ? 'cast_changed' : 'cast_announced',
      performance_id: performance_id ?? null,
      show_id,
      dancer_ids: dancerIds,
    });
    if (qErr) queueError = `通知キュー登録に失敗: ${qErr.message}(migrations/20260722000002 を実行してください)`;
    else queued = true;
  }

  return NextResponse.json({ ok: true, published: !!publish, queued, queueError });
}
