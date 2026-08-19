import { supabaseAdmin } from '@/lib/supabase-admin';
import { fmtJstDT } from '@/lib/jst';
import PerfListClient from './performances-client';

export const dynamic = 'force-dynamic';

export default async function AdminPerformances() {
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー(service role未設定)</p>;

  const [{ data, error }, { data: leaked }, { data: pending }] = await Promise.all([
    sb
      .from('performances')
      .select('id,title,starts_on,ends_on,status,companies(name),shows(id,casts(id,is_published)),sale_stages(id)')
      .order('starts_on', { ascending: false }),
    // 常に0件であること(v1.3追補§2.4)。1件でも出たら即調査
    sb.from('qa_leaked_member_only_casts').select('id'),
    // 解禁待ち(member_only)の作業キュー
    sb.from('pending_cast_releases').select('id,show_id,publish_not_before,source_type'),
  ]);
  if (error) return <p className="notice">読み込みエラー: {error.message}</p>;

  // 解禁待ちの表示用に show → 公演名を引く
  const pendingShowIds = [...new Set((pending ?? []).map((p: any) => p.show_id))];
  let showInfo = new Map<string, { starts_at: string; title: string }>();
  if (pendingShowIds.length) {
    const { data: showRows } = await sb.from('shows').select('id,starts_at,performances(title)').in('id', pendingShowIds);
    showInfo = new Map((showRows ?? []).map((s: any) => [s.id, { starts_at: s.starts_at, title: s.performances?.title ?? '—' }]));
  }
  const pendingByShow = new Map<string, { count: number; publish_not_before: string | null }>();
  for (const p of pending ?? []) {
    const e = pendingByShow.get(p.show_id) ?? { count: 0, publish_not_before: null };
    e.count++;
    if (p.publish_not_before) e.publish_not_before = p.publish_not_before;
    pendingByShow.set(p.show_id, e);
  }

  const rows = (data ?? []).map((p: any) => {
    const shows = p.shows ?? [];
    const published = shows.filter((s: any) => (s.casts ?? []).some((c: any) => c.is_published)).length;
    const drafts = shows.filter((s: any) => (s.casts ?? []).length > 0 && !(s.casts ?? []).some((c: any) => c.is_published)).length;
    return {
      id: p.id,
      title: p.title,
      company: p.companies?.name ?? '—',
      starts_on: p.starts_on,
      ends_on: p.ends_on,
      status: p.status,
      showCount: shows.length,
      salesCount: (p.sale_stages ?? []).length,
      castText: published ? `${published}/${shows.length}回 公開` : drafts ? '下書きのみ' : '未入力',
    };
  });

  const leakedCount = (leaked ?? []).length;

  return (
    <>
      {/* 会員限定情報の漏洩監視(v1.3追補§2.4)。常に0件であること */}
      {leakedCount > 0 ? (
        <p className="notice" style={{ background: '#fdecea', border: '2px solid #d32f2f' }}>
          🚨 <strong>会員限定キャストの漏洩検知: {leakedCount}件</strong> ― tbd/member_only なのに is_published=true
          の行があります。<strong>通知送信を停止して</strong>即座に調査してください(qa_leaked_member_only_casts)。
        </p>
      ) : (
        <p className="hint">🛡 会員限定情報の漏洩監視: 0件(正常)</p>
      )}

      {pendingByShow.size > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="meta"><strong>解禁待ちのキャスト(会員限定発表済み・公開不可)</strong></div>
          {[...pendingByShow.entries()].map(([showId, e]) => {
            const info = showInfo.get(showId);
            return (
              <div key={showId} className="meta">
                {info?.title ?? '—'} {info ? fmtJstDT(info.starts_at) : ''} ― {e.count}件
                {e.publish_not_before ? `(解禁: ${fmtJstDT(e.publish_not_before)})` : '(解禁日時未定。公開を目視確認後に手動で変更)'}
              </div>
            );
          })}
        </div>
      )}

      <PerfListClient rows={rows} />
    </>
  );
}
