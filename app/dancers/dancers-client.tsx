'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Dancer = {
  id: string;
  name: string;
  kana: string;
  rank: string;
  companyId: string | null;
  companyName: string;
};

export default function DancersClient(props: {
  dancers: Dancer[];
  loggedIn: boolean;
  initialFollows: string[];
  initialCompanyFollows: string[];
  isFriend: boolean;
  friendUrl: string;
}) {
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [follows, setFollows] = useState(new Set(props.initialFollows));
  const [companyFollows, setCompanyFollows] = useState(new Set(props.initialCompanyFollows));
  const [banner, setBanner] = useState(!props.isFriend && props.loggedIn && props.initialFollows.length > 0);

  const errorParam = sp.get('error');
  const focus = sp.get('focus');

  // S3からの遷移(?focus=dancer_id): 該当行へスクロール+ハイライト
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`row-${focus}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('hl');
    }
  }, [focus]);

  // 検索: 1ボックスで名前・かな・団体名を横断(仕様書§3 S4)
  const groups = useMemo(() => {
    const query = q.trim();
    const map = new Map<string, { companyId: string | null; members: Dancer[] }>();
    for (const d of props.dancers) {
      const compHit = query && d.companyName.includes(query);
      if (query && !compHit && !d.name.includes(query) && !d.kana.includes(query)) continue;
      if (!map.has(d.companyName)) map.set(d.companyName, { companyId: d.companyId, members: [] });
      map.get(d.companyName)!.members.push(d);
    }
    return [...map.entries()];
  }, [props.dancers, q]);

  function loginRedirect(params: Record<string, string>) {
    const p = new URLSearchParams({ redirect_to: '/dancers', ...params });
    window.location.href = `/auth/line?${p.toString()}`;
  }

  async function toggle(type: 'dancer' | 'company', id: string) {
    if (!props.loggedIn) {
      if (type === 'dancer') loginRedirect({ action: 'follow', dancer_id: id });
      else loginRedirect({ action: 'follow_company', company_id: id });
      return;
    }
    const res = await fetch('/api/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id }),
    });
    if (!res.ok) return;
    const { following } = await res.json();
    const update = (prev: Set<string>) => {
      const next = new Set(prev);
      if (following) next.add(id);
      else next.delete(id);
      return next;
    };
    if (type === 'dancer') setFollows(update);
    else setCompanyFollows(update);
    if (following && !props.isFriend) setBanner(true);
  }

  return (
    <>
      {errorParam === 'line_unconfigured' && (
        <p className="notice">LINEログインは準備中です(LINEチャネル設定待ち)。閲覧は引き続き可能です。</p>
      )}
      {errorParam === 'login_failed' && <p className="notice">ログインに失敗しました。もう一度お試しください。</p>}

      {banner && (
        <div className="friend-banner">
          <strong>通知を受け取るには友だち追加が必要です</strong>
          <div style={{ fontSize: 12 }}>
            フォローは完了しています。キャスト発表・発売開始の通知を受け取るには公式アカウントを友だち追加してください。
          </div>
          {props.friendUrl ? (
            <a className="fb-btn" href={props.friendUrl} target="_blank" rel="noreferrer">
              LINEで友だち追加
            </a>
          ) : (
            <div style={{ fontSize: 11, marginTop: 4 }}>(友だち追加リンクは設定待ち)</div>
          )}
          <button className="fb-close" onClick={() => setBanner(false)}>
            閉じる
          </button>
        </div>
      )}

      <div className="searchbar">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ダンサー名・かな・バレエ団で検索"
        />
      </div>

      {groups.length === 0 && <p className="notice">該当するダンサーが見つかりません。</p>}
      {groups.map(([companyName, g]) => (
        <section key={companyName}>
          <div className="section-title company-head">
            <span>
              {companyName}({g.members.length}名)
            </span>
            {g.companyId && (
              <button
                className={`fbtn cfbtn${companyFollows.has(g.companyId) ? ' on' : ''}`}
                onClick={() => toggle('company', g.companyId!)}
              >
                {companyFollows.has(g.companyId) ? '✓ フォロー中' : '団体をフォロー'}
              </button>
            )}
          </div>
          {g.members.map((d) => (
            <div key={d.id} id={`row-${d.id}`} className="drow">
              <div className="dname">
                <div className="nm">{d.name}</div>
                <div className="kn">{d.kana}</div>
              </div>
              {d.rank && <span className="rank">{d.rank}</span>}
              <button className={`fbtn${follows.has(d.id) ? ' on' : ''}`} onClick={() => toggle('dancer', d.id)}>
                {follows.has(d.id) ? '✓ フォロー中' : 'フォロー'}
              </button>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
