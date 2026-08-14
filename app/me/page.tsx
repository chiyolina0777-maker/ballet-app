import Link from 'next/link';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
};

// S6 マイページ: 観劇ログ一覧+集計(今年の観劇回数・最多観劇ダンサーTop3)
export default async function Me() {
  const session = await getSession();
  if (!session) {
    return (
      <p className="notice">
        観劇ログの利用にはログインが必要です。{' '}
        <a href="/auth/line?redirect_to=/me">LINEでログイン</a>
      </p>
    );
  }
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const { data } = await sb
    .from('theater_logs')
    .select('show_id,seat,memo,shows(id,starts_at,performances(id,title),casts(status,is_published,dancers(id,name)))')
    .eq('user_id', session.uid);

  const logs = (data ?? [])
    .map((l: any) => ({ ...l, show: l.shows }))
    .filter((l: any) => l.show)
    .sort((a: any, b: any) => String(b.show.starts_at).localeCompare(String(a.show.starts_at)));

  // 集計
  const thisYear = new Date().getFullYear();
  const yearCount = logs.filter((l: any) => new Date(l.show.starts_at).getFullYear() === thisYear).length;
  const dancerCount = new Map<string, number>();
  for (const l of logs) {
    for (const c of l.show.casts ?? []) {
      if (!c.is_published || c.status === 'cancelled' || !c.dancers?.name) continue;
      dancerCount.set(c.dancers.name, (dancerCount.get(c.dancers.name) ?? 0) + 1);
    }
  }
  const top3 = [...dancerCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <>
      <div className="section-title">マイページ</div>
      <div className="stats">
        <div className="stat"><b>{yearCount}</b><span>今年の観劇</span></div>
        <div className="stat"><b>{logs.length}</b><span>累計</span></div>
        <div className="stat">
          {top3.length ? (
            <span style={{ fontSize: 12 }}>
              {top3.map(([name, n], i) => <span key={name}>{i + 1}. {name}({n})<br /></span>)}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>最多観劇ダンサーは記録後に表示</span>
          )}
        </div>
      </div>

      <div className="section-title">観劇ログ</div>
      {logs.length === 0 && (
        <p className="notice">
          まだ記録がありません。観劇した公演の詳細ページ(終演した回)から「観劇を記録」できます。
        </p>
      )}
      {logs.map((l: any) => (
        <Link key={l.show_id} href={`/me/logs/${l.show_id}`} className="card">
          <h3>{l.show.performances?.title}</h3>
          <div className="meta">
            {fmt(l.show.starts_at)}
            {l.seat ? ` / 座席: ${l.seat}` : ''}
            {l.memo ? <><br />{String(l.memo).slice(0, 60)}{String(l.memo).length > 60 ? '…' : ''}</> : ''}
          </div>
        </Link>
      ))}
      <p className="hint" style={{ marginTop: 12 }}>
        <a href="/auth/logout">ログアウト</a>
      </p>
    </>
  );
}
