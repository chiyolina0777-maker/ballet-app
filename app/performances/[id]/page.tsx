import { supabaseServer } from '@/lib/supabase';
import { fmtJstDT, fmtJstD, isJstAllDay } from '@/lib/jst';

export const revalidate = 60;

const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`);
const fmtAsOf = (s: string) => {
  const [y, m, d] = s.split('-').map((x) => parseInt(x));
  return `${y}年${m}月${d}日現在`;
};
const fmtDateStr = (s: string | null) => {
  if (!s) return '';
  const p = s.split('-');
  return `${parseInt(p[1])}/${parseInt(p[2])}`;
};

// 締切の表示。時刻不明(23:59)は日付のみ+公式案内(追補§4.4)
function deadline(iso: string) {
  return isJstAllDay(iso) ? `${fmtJstD(iso)}まで` : `${fmtJstDT(iso)}まで`;
}

export default async function PerformanceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseServer();
  if (!sb) {
    return <p className="notice">Supabase が未設定です。README の手順で .env.local を設定してください。</p>;
  }

  // anonキー+RLS: 会員限定の発売段階(is_public_info=false)・未公開キャストはDB側で除外される
  const { data, error } = await sb
    .from('performances')
    .select(
      'id,title,starts_on,ends_on,status,ticket_url,source_url,counts_toward_seed_right,seed_right_label,companies(name),venues(name),' +
        'performance_works(sort_order,works(title)),' +
        'performance_venues(id,city_label,starts_on,ends_on,presenter,ticket_url,sort_order,venues(name),' +
        'seat_types(id,name,price,member_price,is_discount,eligibility,channel_note,note,sort_order,membership_orgs(name,short_name))),' +
        'sale_stages(id,stage_type,label,opens_at,closes_at,sale_type,result_announce_at,payment_closes_at,channel_note,performance_venue_id,sort_order,membership_orgs(name,short_name,join_url)),' +
        'shows(id,starts_at,performance_venue_id,casts(role_name,status,is_published,as_of,dancers(id,name)))'
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
  const pvs = (p.performance_venues ?? []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order);
  const multiVenue = pvs.length > 1;
  const pvLabel = (pvId: string | null) => {
    if (!pvId) return '';
    const pv = pvs.find((x: any) => x.id === pvId);
    return pv ? pv.city_label || pv.venues?.name || '' : '';
  };
  // 発売段階は日時昇順が基本(追補§4.2。stage_typeの番号順=時系列は成立しない)
  const stages = (p.sale_stages ?? [])
    .slice()
    .sort((a: any, b: any) => String(a.opens_at ?? '9999').localeCompare(String(b.opens_at ?? '9999')) || a.sort_order - b.sort_order);
  const shows = (p.shows ?? [])
    .slice()
    .sort((a: any, b: any) => a.starts_at.localeCompare(b.starts_at));
  const now = new Date().toISOString();

  // キャスト基準日(追補§2.5): 公開キャストの as_of の最新値を脚注に
  const asOfDates = shows
    .flatMap((sh: any) => (sh.casts ?? []).filter((c: any) => c.is_published).map((c: any) => c.as_of))
    .filter(Boolean)
    .sort();
  const asOf = asOfDates.length ? asOfDates[asOfDates.length - 1] : null;

  return (
    <>
      <div className="card">
        <h3>{p.title}</h3>
        <div className="meta">
          {(p as any).companies?.name ?? '—'}
          {works.length > 0 && <> / 演目: {works.join(' / ')}</>}
          <br />
          {pvs.length > 0
            ? pvs.map((pv: any) => `${pv.city_label ? pv.city_label + ' ' : ''}${pv.venues?.name ?? ''}`).join(' / ')
            : (p as any).venues?.name ?? '—'}{' '}
          / {p.starts_on} 〜 {p.ends_on}
        </div>
        {p.counts_toward_seed_right && (
          <div className="meta" style={{ marginTop: 6 }}>
            ※{p.seed_right_label || '次シーズンのシード権対象公演です'}
          </div>
        )}
      </div>

      {multiVenue && (
        <>
          <div className="section-title">会場・日程</div>
          {pvs.map((pv: any) => (
            <div key={pv.id} className="card">
              <div className="meta">
                <strong>{pv.city_label ? `${pv.city_label} ` : ''}{pv.venues?.name ?? '—'}</strong>
                {(pv.starts_on || pv.ends_on) && <> / {fmtDateStr(pv.starts_on)} 〜 {fmtDateStr(pv.ends_on)}</>}
                {pv.presenter && <> / 主催: {pv.presenter}</>}
                {pv.ticket_url && (
                  <>
                    {' '}
                    / <a href={pv.ticket_url} target="_blank" rel="noopener noreferrer">チケット</a>
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="section-title">チケット販売</div>
      <div className="card">
        {stages.length === 0 && <div className="meta">販売情報は未登録です。</div>}
        {stages.map((s: any) => {
          const org = s.membership_orgs;
          const onSale = s.opens_at && s.opens_at <= now && (!s.closes_at || s.closes_at > now);
          const ended = s.closes_at && s.closes_at <= now;
          const venuePrefix = multiVenue && s.performance_venue_id ? `[${pvLabel(s.performance_venue_id)}] ` : '';
          return (
            <div key={s.id} className="meta" style={{ marginBottom: 8 }}>
              <strong>{venuePrefix}{s.label || '一般発売'}</strong>
              {s.sale_type === 'lottery' && <span className="badge">抽選</span>}
              {onSale && <span className="badge ok">{s.sale_type === 'lottery' ? '受付中' : '発売中'}</span>}
              {ended && <span className="badge">終了</span>}
              {!onSale && !ended && s.opens_at && s.opens_at > now && <span className="badge warn">{s.sale_type === 'lottery' ? '受付前' : '発売前'}</span>}
              <br />
              {s.sale_type === 'lottery' ? (
                <>
                  申込: {s.opens_at ? `${fmtJstDT(s.opens_at)}〜` : ''}{s.closes_at ? deadline(s.closes_at) : ''}
                  {s.result_announce_at && <><br />当落発表: {fmtJstDT(s.result_announce_at)}</>}
                  {s.payment_closes_at && <><br />入金締切: {deadline(s.payment_closes_at)}</>}
                </>
              ) : (
                <>
                  {s.opens_at ? `${fmtJstDT(s.opens_at)}〜` : ''}
                  {s.closes_at ? ` ${deadline(s.closes_at)}` : ''}
                </>
              )}
              {(s.closes_at && isJstAllDay(s.closes_at)) || (s.payment_closes_at && isJstAllDay(s.payment_closes_at)) ? (
                <span style={{ color: 'var(--muted)' }}>(締切時刻は公式サイトをご確認ください)</span>
              ) : null}
              {s.channel_note && <><br /><span style={{ color: 'var(--muted)' }}>{s.channel_note}</span></>}
              {org && (
                <>
                  <br />
                  <span style={{ color: 'var(--muted)' }}>
                    {org.name}の会員先行です
                    {org.join_url && (
                      <>
                        (<a href={org.join_url} target="_blank" rel="noopener noreferrer">入会はこちら</a>)
                      </>
                    )}
                  </span>
                </>
              )}
            </div>
          );
        })}
        {p.ticket_url && (
          <p style={{ marginTop: 8 }}>
            <a href={`/go/${p.id}?src=web`}>チケットを購入</a>
          </p>
        )}
      </div>

      {pvs.some((pv: any) => (pv.seat_types ?? []).length > 0) && (
        <>
          <div className="section-title">料金(席種)</div>
          {pvs.map((pv: any) => {
            const seats = (pv.seat_types ?? []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order);
            if (!seats.length) return null;
            const hasMember = seats.some((st: any) => st.member_price != null);
            return (
              <div key={pv.id} className="card" style={{ overflowX: 'auto' }}>
                {multiVenue && <div className="meta"><strong>{pv.city_label ? `${pv.city_label} ` : ''}{pv.venues?.name ?? ''}</strong></div>}
                <table className="admin-table" style={{ marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th>席種</th>
                      <th>料金</th>
                      {hasMember && <th>会員価格</th>}
                      <th>備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seats.map((st: any) => (
                      <tr key={st.id}>
                        <td>
                          {st.name}
                          {st.is_discount && <span className="badge ok">割引</span>}
                        </td>
                        <td>{yen(st.price)}</td>
                        {hasMember && (
                          <td>
                            {st.member_price != null ? (
                              <>
                                {yen(st.member_price)}
                                {st.membership_orgs && <span style={{ color: 'var(--muted)', fontSize: 12 }}>({st.membership_orgs.short_name || st.membership_orgs.name})</span>}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {[st.eligibility, st.channel_note, st.note].filter(Boolean).join(' / ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}

      <div className="section-title">日別キャスト</div>
      {shows.map((sh: any) => {
        // 公開済み(is_published)のみ表示。member_only は存在も示唆しない(追補§8.1)
        const casts = (sh.casts ?? []).filter((c: any) => c.is_published);
        const venuePrefix = multiVenue && sh.performance_venue_id ? `[${pvLabel(sh.performance_venue_id)}] ` : '';
        return (
          <div key={sh.id} className="show-row">
            <div className="dt">{venuePrefix}{fmtJstDT(sh.starts_at)}</div>
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
            {sh.starts_at < now && (
              <div style={{ marginTop: 6 }}>
                <a href={`/me/logs/${sh.id}`} style={{ fontSize: 12 }}>観劇を記録</a>
              </div>
            )}
          </div>
        );
      })}

      <p className="src-note">
        {asOf && <>キャスト情報: {fmtAsOf(asOf)} ― </>}
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
