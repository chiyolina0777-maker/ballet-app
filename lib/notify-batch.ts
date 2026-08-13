import type { SupabaseClient } from '@supabase/supabase-js';
import { pushText } from './line';

// 通知バッチ(仕様書§6)。9:00/18:00にCronから実行される。
// 1) 発売前日の ticket_sales を自動キュー投入
// 2) notification_queue を消化して宛先を計算(distinct・通知設定・友だち状態で絞る)
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

export async function runNotifyBatch(sb: SupabaseClient) {
  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  const stats = { enqueuedSales: 0, processed: 0, recipients: 0, sent: 0, sendErrors: 0 };

  // ---- 1) 発売開始の自動キュー(27時間以内に開始する販売窓口 = 前日9:00運用をカバー) ----
  const now = new Date();
  const horizon = new Date(now.getTime() + 27 * 3600 * 1000);
  const { data: sales } = await sb
    .from('ticket_sales')
    .select('id,performance_id')
    .gt('sale_starts_at', now.toISOString())
    .lte('sale_starts_at', horizon.toISOString());
  for (const s of sales ?? []) {
    const { data: exists } = await sb
      .from('notification_queue')
      .select('id')
      .eq('kind', 'sale_start')
      .eq('ticket_sale_id', s.id)
      .limit(1);
    if (exists?.length) continue;
    await sb.from('notification_queue').insert({ kind: 'sale_start', ticket_sale_id: s.id, performance_id: s.performance_id });
    stats.enqueuedSales++;
  }

  // ---- 2) キュー消化 ----
  const { data: queue } = await sb.from('notification_queue').select('*').is('processed_at', null).order('created_at');
  const digests = new Map<string, string[]>(); // line_user_id -> message blocks

  for (const q of queue ?? []) {
    let userIds: string[] = [];
    let block = '';

    if (q.kind === 'sale_start') {
      const { data: sale } = await sb
        .from('ticket_sales')
        .select('id,label,sale_starts_at,performances(id,title,company_id)')
        .eq('id', q.ticket_sale_id)
        .single();
      const perf: any = (sale as any)?.performances;
      if (sale && perf) {
        // 宛先 = 主催バレエ団のフォロワー ∪ 出演ダンサー(公開・降板除く)のフォロワー(§6)
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
        userIds = [...new Set([...(cf ?? []).map((x: any) => x.user_id), ...df.map((x: any) => x.user_id)])];
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
        .select('id,starts_at,performances(id,title),casts(role_name,status,is_published,dancers(name))')
        .eq('id', q.show_id)
        .single();
      if (show) {
        const perf: any = (show as any).performances;
        const casts = ((show as any).casts ?? []).filter((c: any) => c.is_published);
        const castLine = casts.map((c: any) => `${c.role_name}: ${c.dancers?.name ?? ''}`).join(' / ');
        const label = q.kind === 'cast_changed' ? '【キャスト変更】' : '【キャスト発表】';
        block = `${label}${perf?.title}\n${fmtDT((show as any).starts_at)}\n${castLine}\n▶ ${site}/performances/${perf?.id}?src=line`;
      }
    }

    if (userIds.length && block) {
      // 通知設定・友だち状態で絞る(is_line_friend=true のみ = 未追加への無駄Pushを出さない)
      const col = q.kind === 'sale_start' ? 'notify_sale' : 'notify_cast';
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
      }));
      if (rows.length) {
        // 挿入できた行のみ送信対象(unique制約が二重送信を拒否)
        const onConflict = q.kind === 'sale_start' ? 'user_id,kind,ticket_sale_id' : 'user_id,kind,show_id';
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
