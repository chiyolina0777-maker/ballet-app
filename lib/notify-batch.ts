import type { SupabaseClient } from '@supabase/supabase-js';
import { pushText } from './line';

// 通知バッチ(仕様書§6 + v1.3追補§4/§6/§7)。9:00/18:00にCronから実行される。
// 0) publish_not_before 経過キャストの解禁(release_scheduled_casts)+キュー投入
// 1) 27時間以内の発売トリガー(open/close/result/payment_close)を自動キュー投入
// 2) notification_queue を消化して宛先を計算(distinct・通知設定・友だち状態・会員加入で絞る)
// 3) 同一ユーザーへの複数イベントは1通に束ねて LINE Push
// 二重送信防止は notifications の unique 制約(挿入できた行にのみ送る)

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const fmtD = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });

// 締切時刻が不明な場合は終日=23:59で保持されている(追補§4.4)。表示では時刻を伏せる
const isAllDay = (iso: string) => {
  const t = new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
  return t === '23:59';
};
const fmtDeadline = (iso: string) => (isAllDay(iso) ? `${fmtD(iso)}` : `${fmtDT(iso)}`);

// trigger_kind(upcoming_sale_triggers) → 通知kind
const SALE_KINDS: Record<string, string> = {
  open: 'sale_start',
  close: 'sale_close',
  result: 'sale_result',
  payment_close: 'sale_payment_close',
};
const isSaleKind = (k: string) => k === 'sale_start' || k === 'sale_close' || k === 'sale_result' || k === 'sale_payment_close';

export async function runNotifyBatch(sb: SupabaseClient) {
  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  const stats = { released: 0, enqueuedCastReleases: 0, enqueuedSales: 0, processed: 0, recipients: 0, sent: 0, sendErrors: 0 };
  const now = new Date();

  // ---- 0) 解禁時刻の経過を反映(追補§2.3。通知ワーカーと同一周期で呼ぶ) ----
  // 解禁対象を先に取得してから release_scheduled_casts() で公開し、show単位でキュー投入する
  const { data: releasable } = await sb
    .from('casts')
    .select('show_id,dancer_id,status,shows(performance_id)')
    .in('publication_status', ['announced', 'final'])
    .eq('is_published', false)
    .not('publish_not_before', 'is', null)
    .lte('publish_not_before', now.toISOString());

  const { data: releasedCount, error: relErr } = await sb.rpc('release_scheduled_casts');
  if (!relErr) stats.released = releasedCount ?? 0;

  if (!relErr && releasable?.length) {
    const byShow = new Map<string, { performance_id: string | null; dancer_ids: string[] }>();
    for (const c of releasable as any[]) {
      const e = byShow.get(c.show_id) ?? { performance_id: c.shows?.performance_id ?? null, dancer_ids: [] };
      if (c.status !== 'cancelled') e.dancer_ids.push(c.dancer_id);
      byShow.set(c.show_id, e);
    }
    for (const [showId, e] of byShow) {
      const { data: exists } = await sb
        .from('notification_queue')
        .select('id')
        .in('kind', ['cast_announced', 'cast_changed'])
        .eq('show_id', showId)
        .is('processed_at', null)
        .limit(1);
      if (exists?.length) continue; // 未処理キューがあれば重複投入しない
      await sb.from('notification_queue').insert({
        kind: 'cast_announced',
        show_id: showId,
        performance_id: e.performance_id,
        dancer_ids: [...new Set(e.dancer_ids)],
      });
      stats.enqueuedCastReleases++;
    }
  }

  // ---- 1) 発売トリガーの自動キュー(27時間以内 = 前日9:00運用をカバー。追補§4.3の4種) ----
  const horizon = new Date(now.getTime() + 27 * 3600 * 1000);
  const { data: triggers } = await sb
    .from('upcoming_sale_triggers')
    .select('sale_stage_id,performance_id,trigger_kind,trigger_at')
    .gt('trigger_at', now.toISOString())
    .lte('trigger_at', horizon.toISOString());
  for (const t of triggers ?? []) {
    const kind = SALE_KINDS[t.trigger_kind];
    if (!kind) continue;
    const { data: exists } = await sb
      .from('notification_queue')
      .select('id')
      .eq('kind', kind)
      .eq('sale_stage_id', t.sale_stage_id)
      .limit(1);
    if (exists?.length) continue;
    await sb.from('notification_queue').insert({ kind, sale_stage_id: t.sale_stage_id, performance_id: t.performance_id });
    stats.enqueuedSales++;
  }

  // ---- 2) キュー消化 ----
  const { data: queue } = await sb.from('notification_queue').select('*').is('processed_at', null).order('created_at');
  const digests = new Map<string, string[]>(); // line_user_id -> message blocks

  for (const q of queue ?? []) {
    let userIds: string[] = [];
    let block = '';

    if (isSaleKind(q.kind) && q.sale_stage_id) {
      const { data: stage } = await sb
        .from('sale_stages')
        .select(
          'id,stage_type,label,opens_at,closes_at,result_announce_at,payment_closes_at,sale_type,channel_note,membership_org_id,is_public_info,' +
            'performances(id,title,company_id,counts_toward_seed_right,seed_right_label),' +
            'performance_venues(city_label,venues(name)),' +
            'membership_orgs(name,short_name)'
        )
        .eq('id', q.sale_stage_id)
        .single();
      const perf: any = (stage as any)?.performances;
      if (stage && perf && (stage as any).is_public_info !== false) {
        const s: any = stage;
        // 宛先 = 主催バレエ団のフォロワー ∪ 出演ダンサー(公開・降板除く)のフォロワー(§6)
        userIds = await saleRecipients(sb, perf);
        // 会員先行は加入者に絞る(追補§6.2)。加入状況が未設定のユーザーには送る(§6.3)
        if (s.membership_org_id && ['s1_fastest', 's2_member', 's3_free'].includes(s.stage_type)) {
          userIds = await filterByMembership(sb, userIds, s.membership_org_id);
        }
        block = saleBlock(q.kind, s, perf, site);
      }
    } else if (q.kind === 'sale_start' && q.ticket_sale_id) {
      // 旧形式(ticket_sales)の未処理キューへの互換。v1.4で削除
      const { data: sale } = await sb
        .from('ticket_sales')
        .select('id,label,sale_starts_at,performances(id,title,company_id)')
        .eq('id', q.ticket_sale_id)
        .single();
      const perf: any = (sale as any)?.performances;
      if (sale && perf) {
        userIds = await saleRecipients(sb, perf);
        block = `【明日発売】${perf.title}\n${(sale as any).label || '一般発売'}: ${fmtDT((sale as any).sale_starts_at)}〜\n▶ ${site}/go/${perf.id}?src=line`;
      }
    } else {
      // cast_announced / cast_changed: 該当ダンサーのフォロワーのみ(§6)
      const dancerIds: string[] = q.dancer_ids ?? [];
      if (dancerIds.length) {
        const { data } = await sb.from('follows').select('user_id').in('dancer_id', dancerIds);
        userIds = [...new Set((data ?? []).map((x: any) => x.user_id))];
      }
      const { data: show } = await sb
        .from('shows')
        .select('id,starts_at,performances(id,title,counts_toward_seed_right,seed_right_label),casts(role_name,status,is_published,dancers(name))')
        .eq('id', q.show_id)
        .single();
      if (show) {
        const perf: any = (show as any).performances;
        // 通知テンプレートは is_published=true のみを参照する(追補§7.3。status は見ない)
        const casts = ((show as any).casts ?? []).filter((c: any) => c.is_published);
        const castLine = casts.map((c: any) => `${c.role_name}: ${c.dancers?.name ?? ''}`).join(' / ');
        const label = q.kind === 'cast_changed' ? '【キャスト変更】' : '【キャスト発表】';
        block = `${label}${perf?.title}\n${fmtDT((show as any).starts_at)}\n${castLine}`;
        if (perf?.counts_toward_seed_right) block += `\n※${perf.seed_right_label || '次シーズンのシード権対象公演です'}`;
        block += `\n▶ ${site}/performances/${perf?.id}?src=line`;
      }
    }

    if (userIds.length && block) {
      // 通知設定・友だち状態で絞る(is_line_friend=true のみ = 未追加への無駄Pushを出さない)
      const col = isSaleKind(q.kind) ? 'notify_sale' : 'notify_cast';
      const { data: profs } = await sb
        .from('profiles')
        .select('id,line_user_id')
        .in('id', userIds)
        .eq('is_line_friend', true)
        .eq(col, true)
        .not('line_user_id', 'is', null);

      const rows = (profs ?? []).map((p: any) => ({
        user_id: p.id,
        kind: q.kind,
        show_id: q.show_id ?? null,
        performance_id: q.performance_id ?? null,
        ticket_sale_id: q.ticket_sale_id ?? null,
        sale_stage_id: q.sale_stage_id ?? null,
      }));
      if (rows.length) {
        // 挿入できた行のみ送信対象(unique制約が二重送信を拒否)
        const onConflict = q.sale_stage_id
          ? 'user_id,kind,sale_stage_id'
          : q.kind === 'sale_start'
            ? 'user_id,kind,ticket_sale_id'
            : 'user_id,kind,show_id';
        const { data: inserted } = await sb
          .from('notifications')
          .upsert(rows, { onConflict, ignoreDuplicates: true })
          .select('user_id');
        const insertedSet = new Set((inserted ?? []).map((r: any) => r.user_id));
        for (const p of profs ?? []) {
          if (!insertedSet.has(p.id)) continue;
          const arr = digests.get(p.line_user_id) ?? [];
          arr.push(block);
          digests.set(p.line_user_id, arr);
          stats.recipients++;
        }
      }
    }

    await sb.from('notification_queue').update({ processed_at: new Date().toISOString() }).eq('id', q.id);
    stats.processed++;
  }

  // ---- 3) 送信(1ユーザー1通のダイジェスト) ----
  for (const [to, blocks] of digests) {
    const ok = await pushText(to, blocks.join('\n\n').slice(0, 4900));
    if (ok) stats.sent++;
    else stats.sendErrors++;
  }

  return stats;
}

// 発売系の宛先 = 主催バレエ団のフォロワー ∪ 出演ダンサー(公開・降板除く)のフォロワー(§6)
async function saleRecipients(sb: SupabaseClient, perf: any): Promise<string[]> {
  const { data: cf } = await sb.from('company_follows').select('user_id').eq('company_id', perf.company_id);
  const { data: showRows } = await sb.from('shows').select('id,casts(dancer_id,status,is_published)').eq('performance_id', perf.id);
  const dancerIds = [
    ...new Set(
      (showRows ?? []).flatMap((s: any) =>
        (s.casts ?? []).filter((c: any) => c.is_published && c.status !== 'cancelled').map((c: any) => c.dancer_id)
      )
    ),
  ];
  let df: any[] = [];
  if (dancerIds.length) {
    const { data } = await sb.from('follows').select('user_id').in('dancer_id', dancerIds);
    df = data ?? [];
  }
  return [...new Set([...(cf ?? []).map((x: any) => x.user_id), ...df.map((x: any) => x.user_id)])];
}

// 会員先行の絞り込み(追補§6.2/§6.3)。
// 加入状況を1件以上登録済みのユーザーは該当組織の加入者のみ残す。
// 未設定(0件)のユーザーには送る(漏れるより過剰なほうが害が小さい)
async function filterByMembership(sb: SupabaseClient, userIds: string[], orgId: string): Promise<string[]> {
  if (!userIds.length) return userIds;
  const { data } = await sb.from('user_memberships').select('user_id,membership_org_id').in('user_id', userIds);
  const hasAny = new Set((data ?? []).map((r: any) => r.user_id));
  const hasOrg = new Set((data ?? []).filter((r: any) => r.membership_org_id === orgId).map((r: any) => r.user_id));
  return userIds.filter((u) => !hasAny.has(u) || hasOrg.has(u));
}

// 発売系の通知本文。キャストには触れない(追補§7.2)
function saleBlock(kind: string, s: any, perf: any, site: string): string {
  const venue = s.performance_venues ? `${s.performance_venues.city_label ? s.performance_venues.city_label + ' ' : ''}${s.performance_venues.venues?.name ?? ''}`.trim() : '';
  const title = venue ? `${perf.title}(${venue})` : perf.title;
  const label = s.label || '一般発売';
  let head = '';
  let line = '';
  if (kind === 'sale_start') {
    head = s.sale_type === 'lottery' ? '【申込開始】' : '【明日発売】';
    line = s.sale_type === 'lottery' && s.closes_at
      ? `${label}: ${fmtDT(s.opens_at)}〜${fmtDeadline(s.closes_at)}`
      : `${label}: ${fmtDT(s.opens_at)}〜`;
  } else if (kind === 'sale_close') {
    head = s.sale_type === 'lottery' ? '【申込締切】' : '【販売終了間近】';
    line = `${label}: ${fmtDeadline(s.closes_at)}まで`;
    if (isAllDay(s.closes_at)) line += '(正確な時刻は公式サイトをご確認ください)';
  } else if (kind === 'sale_result') {
    head = '【当落発表】';
    line = `${label}: ${fmtDT(s.result_announce_at)}`;
  } else {
    head = '【入金締切】';
    line = `${label}: ${fmtDeadline(s.payment_closes_at)}まで`;
    if (isAllDay(s.payment_closes_at)) line += '(正確な時刻は公式サイトをご確認ください)';
  }
  let block = `${head}${title}\n${line}`;
  if (s.channel_note) block += `\n${s.channel_note}`;
  if (perf.counts_toward_seed_right) block += `\n※${perf.seed_right_label || '次シーズンのシード権対象公演です'}`;
  block += `\n▶ ${site}/go/${perf.id}?src=line`;
  return block;
}
