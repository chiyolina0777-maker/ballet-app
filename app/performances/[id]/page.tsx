import { supabaseServer } from '@/lib/supabase';

export const revalidate = 60;

const WD = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDT(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default async function PerformanceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseServer();
  if (!sb) {
    return <p className="notice">Supabase が未設定です。README の手順で .env.local を設定してください。</p>;
  }

  const { data, error } = await sb
    .from('performances')
    .select(
      'id,title,starts_on,ends_on,status,ticket_url,source_url,companies(name),venues(name),' +
        'performance_works(sort_order,works(title)),' +
        'ticket_sales(id,label,sale_starts_at),' +
        'shows(id,starts_at,casts(role_name,status,is_published,dancers(id,name)))'
    )
    .eq('id', id)
    .single();
  const p: any = data;

  if (error || !p) return <p className="notice">公演が見つかりません。</p>;

  const works = (p.performance_works ?? [])
    .slice()
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((w: any) => w.works?.title)
    .filter(Boolean);
  const sales = (p.ticket_sales ?? [])
    .slice()
    .sort((a: any, b: any) => a.sale_starts_at.localeCompare(b.sale_starts_at));
  const shows = (p.shows ?? [])
    .slice()
    .sort((a: any, b: any) => a.starts_at.localeCompare(b.starts_at));
  const now = new Date().toISOString();

  return (
    <>
      <div className="card">
        <h3>{p.title}</h3>
        <div className="meta">
          {(p as any).companies?.name ?? '—'}
          {works.length > 0 && <> / 演目: {works.join(' / ')}</>}
          <br />
          {(p as any).venues?.name ?? '—'} / {p.starts_on} 〜 {p.ends_on}
        </div>
      </div>

      <div className="section-title">チケット販売</div>
      <div className="card">
        {sales.length === 0 && <div className="meta">販売情報は未登録です。</div>}
        {sales.map((s: any) => (
          <div key={s.id} className="meta">
            {s.label || '一般発売'}: {fmtDT(s.sale_starts_at)}
            {s.sale_starts_at <= now ? <span className="badge ok">発売中</span> : <span className="badge warn">発売前</span>}
          </div>
        ))}
        {p.ticket_url && (
          <p style={{ marginTop: 8 }}>
            <a href={`/go/${p.id}?src=web`}>チケットを購入</a>
          </p>
        )}
      </div>

      <div className="section-title">日別キャスト</div>
      {shows.map((sh: any) => {
        const casts = (sh.casts ?? []).filter((c: any) => c.is_published !== false);
        return (
          <div key={sh.id} className="show-row">
            <div className="dt">{fmtDT(sh.starts_at)}</div>
            {casts.length === 0 ? (
              <div className="cast" style={{ color: 'var(--muted)' }}>キャスト未発表</div>
            ) : (
              <div className="cast">
                {casts.map((c: any, i: number) => (
                  <span key={i}>
                    <span className="role">{c.role_name}:</span>{' '}
                    {c.dancers?.id ? <a href={`/dancers?focus=${c.dancers.id}`}>{c.dancers.name}</a> : c.dancers?.name ?? '—'}
                    {c.status === 'changed' && <span className="badge warn">変更</span>}
                    {c.status === 'cancelled' && <span className="badge warn">降板</span>}
                    {'　'}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="src-note">
        {p.source_url && (
          <>
            出典: <a href={p.source_url}>公式発表</a> ―{' '}
          </>
        )}
        公式発表に基づく。変更の可能性あり。
      </p>
    </>
  );
}
