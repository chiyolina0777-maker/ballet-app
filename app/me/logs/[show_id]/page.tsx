import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase-admin';
import LogForm from './log-form';

export const dynamic = 'force-dynamic';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// S7 観劇ログ記録・編集: 起点は必ず公演回。日付・演目・劇場・キャストはDBから自動表示、
// 入力は座席・メモのみ(仕様書§3)
export default async function LogEditor({ params }: { params: Promise<{ show_id: string }> }) {
  const { show_id } = await params;
  const session = await getSession();
  if (!session) {
    return (
      <p className="notice">
        観劇の記録にはログインが必要です。
        <span style={{ display: 'block', marginTop: 10 }}>
          <a className="btnlink" href={`/auth/line?redirect_to=/me/logs/${show_id}`}>LINEでログイン</a>
        </span>
      </p>
    );
  }
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const { data: show } = await sb
    .from('shows')
    .select(
      'id,starts_at,performances(id,title,venues(name),performance_works(sort_order,works(title))),casts(role_name,status,is_published,dancers(name))'
    )
    .eq('id', show_id)
    .single();
  if (!show) return <p className="notice">公演回が見つかりません。</p>;

  const perf: any = (show as any).performances;
  if (new Date((show as any).starts_at) >= new Date()) {
    return (
      <p className="notice">
        この回はまだ終演していないため記録できません。
        <span style={{ display: 'block', marginTop: 10 }}>
          <a className="btnlink sub" href={`/performances/${perf?.id}`}>公演ページへ戻る</a>
        </span>
      </p>
    );
  }

  const { data: existing } = await sb
    .from('theater_logs')
    .select('seat,memo')
    .eq('user_id', session.uid)
    .eq('show_id', show_id)
    .maybeSingle();

  const works = (perf?.performance_works ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((w: any) => w.works?.title)
    .filter(Boolean);
  const casts = ((show as any).casts ?? []).filter((c: any) => c.is_published && c.status !== 'cancelled');

  return (
    <>
      <div className="section-title">{existing ? '観劇ログを編集' : '観劇を記録'}</div>
      <div className="card">
        <h3>{perf?.title}</h3>
        <div className="meta">
          {fmt((show as any).starts_at)}
          {works.length > 0 && <> / 演目: {works.join(' / ')}</>}
          {perf?.venues?.name && <> / {perf.venues.name}</>}
          {casts.length > 0 && (
            <>
              <br />
              {casts.map((c: any, i: number) => (
                <span key={i}>{c.role_name}: {c.dancers?.name}　</span>
              ))}
            </>
          )}
        </div>
      </div>
      <LogForm showId={show_id} initialSeat={existing?.seat ?? ''} initialMemo={existing?.memo ?? ''} exists={!!existing} />
    </>
  );
}
