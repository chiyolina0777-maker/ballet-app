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

const PUB_STATUSES = ['tbd', 'member_only', 'announced', 'final'];
const SOURCE_TYPES = ['public_page', 'member_site', 'member_email', 'press', 'manual', 'other'];

// A2-3: キャスト保存(v1.3: 公開状態は publication_status で管理。is_published はDBトリガーが導出)
// announced/final かつ解禁日時が到来していれば公開+通知キュー登録。送信は9:00/18:00のバッチ(§6)
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { show_id, performance_id, source_url, publication_status, publish_not_before, source_type, as_of, casts } = body;

  if (!show_id || !source_url?.trim()) {
    return NextResponse.json({ error: '出典URLは必須です' }, { status: 400 });
  }
  if (!PUB_STATUSES.includes(publication_status)) {
    return NextResponse.json({ error: '公開状態が不正です' }, { status: 400 });
  }
  if (!SOURCE_TYPES.includes(source_type)) {
    return NextResponse.json({ error: '出所(source_type)は必須です' }, { status: 400 });
  }
  const rows = (casts ?? []).filter((c: any) => c.dancer_id && c.role_name?.trim());
  if (!rows.length) return NextResponse.json({ error: '役名+ダンサーの組を1件以上入力してください' }, { status: 400 });

  // 既存公開状態を確認(発表済みへの変更なら kind=cast_changed)
  const { data: prev } = await sb.from('casts').select('id,is_published').eq('show_id', show_id);
  const wasPublished = (prev ?? []).some((c: any) => c.is_published);

  const pnb = publish_not_before || null;
  // is_published はDBトリガー(sync_cast_is_published)の導出と同じ式で判定し、キュー登録の要否に使う
  const effectivePublished =
    (publication_status === 'announced' || publication_status === 'final') &&
    (!pnb || new Date(pnb) <= new Date());
  const scheduled =
    (publication_status === 'announced' || publication_status === 'final') && !!pnb && new Date(pnb) > new Date();

  // 置換保存(プロトタイプ同様。履歴運用は将来 status 更新方式に寄せる)
  await sb.from('casts').delete().eq('show_id', show_id);
  const insertRows = rows.map((c: any) => ({
    show_id,
    dancer_id: c.dancer_id,
    role_name: c.role_name.trim(),
    status: ['scheduled', 'changed', 'cancelled'].includes(c.status) ? c.status : 'scheduled',
    source_url: source_url.trim(),
    publication_status,
    publish_not_before: pnb,
    source_type,
    as_of: as_of || null,
  }));
  const { error } = await sb.from('casts').insert(insertRows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let queued = false;
  let queueError: string | undefined;
  if (effectivePublished) {
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

  return NextResponse.json({ ok: true, published: effectivePublished, scheduled, queued, queueError });
}
