'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Row = { dancer_id: string; role_name: string; status: string };
type Pub = { publication_status: string; publish_not_before: string; source_type: string; as_of: string };

// v1.3(追補§2): 公開状態。tbd/member_only は一切出力されない。is_published はDBが自動導出
const PUB_LABEL: Record<string, string> = {
  tbd: '未発表(下書き)',
  member_only: '会員限定発表(公開不可)',
  announced: '一般公開',
  final: '当日確定',
};
const SOURCE_LABEL: Record<string, string> = {
  public_page: '公開ページ',
  member_site: '会員サイト',
  member_email: '会員メール',
  press: 'プレス',
  manual: '手入力',
  other: 'その他',
};

export default function CastsClient({ performance, shows, dancers }: { performance: any; shows: any[]; dancers: any[] }) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [rowsByShow, setRowsByShow] = useState<Record<string, Row[]>>(() => {
    const m: Record<string, Row[]> = {};
    for (const s of shows) {
      m[s.id] = (s.casts ?? []).map((c: any) => ({ dancer_id: c.dancer_id, role_name: c.role_name, status: c.status }));
      if (!m[s.id].length) m[s.id] = [{ dancer_id: '', role_name: '', status: 'scheduled' }];
    }
    return m;
  });
  const [pubByShow, setPubByShow] = useState<Record<string, Pub>>(() => {
    const m: Record<string, Pub> = {};
    for (const s of shows) {
      const c = (s.casts ?? [])[0];
      m[s.id] = {
        publication_status: c?.publication_status ?? 'tbd',
        publish_not_before: c?.publish_not_before ? String(c.publish_not_before).slice(0, 16) : '',
        source_type: c?.source_type ?? 'public_page',
        as_of: c?.as_of ?? '',
      };
    }
    return m;
  });
  const [sourceUrl, setSourceUrl] = useState(shows[0]?.casts?.[0]?.source_url ?? '');
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const show = shows[active];
  const rows = rowsByShow[show.id] ?? [];
  const setRows = (r: Row[]) => setRowsByShow({ ...rowsByShow, [show.id]: r });
  const pub = pubByShow[show.id];
  const setPub = (p: Partial<Pub>) => setPubByShow({ ...pubByShow, [show.id]: { ...pub, ...p } });

  const willPublishNow =
    (pub.publication_status === 'announced' || pub.publication_status === 'final') &&
    (!pub.publish_not_before || new Date(pub.publish_not_before) <= new Date());
  const willSchedule =
    (pub.publication_status === 'announced' || pub.publication_status === 'final') &&
    !!pub.publish_not_before && new Date(pub.publish_not_before) > new Date();

  const activeDancerIds = useMemo(
    () => [...new Set(rows.filter((r) => r.dancer_id && r.status !== 'cancelled').map((r) => r.dancer_id))],
    [rows]
  );

  useEffect(() => {
    if (!activeDancerIds.length) { setFollowerCount(0); return; }
    fetch(`/api/admin/casts?dancer_ids=${activeDancerIds.join(',')}`)
      .then((r) => r.json())
      .then((j) => setFollowerCount(j.count ?? 0))
      .catch(() => setFollowerCount(null));
  }, [activeDancerIds.join(',')]);

  function copyPrev() {
    if (active === 0) { setMsg('前の回がありません'); return; }
    const prev = rowsByShow[shows[active - 1].id] ?? [];
    if (!prev.some((r) => r.dancer_id || r.role_name)) { setMsg('前の回にキャストがありません'); return; }
    setRows(prev.map((r) => ({ ...r })));
    setMsg('前の回のキャストを複製しました');
  }

  async function addDancer(rowIdx: number) {
    const name = window.prompt('新規ダンサー名を入力');
    if (!name?.trim()) return;
    const kana = window.prompt('かな(検索用・省略可)') ?? '';
    const res = await fetch('/api/admin/masters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'dancer', name: name.trim(), kana: kana.trim() }),
    });
    if (!res.ok) { setMsg('ダンサー追加に失敗しました'); return; }
    const { id } = await res.json();
    dancers.push({ id, name: name.trim(), kana, company: '' });
    setRows(rows.map((r, i) => (i === rowIdx ? { ...r, dancer_id: id } : r)));
  }

  async function save() {
    setMsg('');
    if (willPublishNow) {
      const n = followerCount ?? 0;
      const ok = window.confirm(
        `【二段確認】この内容で一般公開し、通知キューに登録します。\n対象: フォロワー ${n}人(重複除外済み)\n送信は次回バッチ(9:00/18:00)。登録後の取り消しはできません。`
      );
      if (!ok) return;
    }
    setSaving(true);
    const res = await fetch('/api/admin/casts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        show_id: show.id,
        performance_id: performance.id,
        source_url: sourceUrl,
        publication_status: pub.publication_status,
        publish_not_before: pub.publish_not_before || null,
        source_type: pub.source_type,
        as_of: pub.as_of || null,
        casts: rows,
      }),
    });
    setSaving(false);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? '保存に失敗しました'); return; }
    if (j.published) setMsg(j.queued ? '公開し、通知キューに登録しました(次回バッチで送信)' : `公開しました。${j.queueError ?? ''}`);
    else if (j.scheduled) setMsg('保存しました。解禁日時の経過後、バッチが自動で公開・通知します');
    else if (pub.publication_status === 'member_only') setMsg('会員限定情報として保存しました(画面・通知には一切出ません)');
    else setMsg('未発表(下書き)として保存しました(通知なし・公演ページ非表示)');
    router.refresh();
  }

  return (
    <div className="admin-form">
      <div className="section-title">キャスト入力: {performance.title}</div>
      {msg && <p className="notice">{msg}</p>}

      <div className="tabs">
        {shows.map((s, i) => {
          const casts = s.casts ?? [];
          const published = casts.some((c: any) => c.is_published);
          const memberOnly = !published && casts.some((c: any) => c.publication_status === 'member_only');
          const hasDraft = casts.length > 0 && !published && !memberOnly;
          return (
            <button key={s.id} className={`tab${i === active ? ' on' : ''}`} onClick={() => { setActive(i); setMsg(''); }}>
              {fmt(s.starts_at)}
              {published ? ' ✓公開' : memberOnly ? ' 🔒会員限定' : hasDraft ? ' 下書' : ''}
            </button>
          );
        })}
      </div>

      <button className="linklike" onClick={copyPrev}>前の回からコピー</button>

      <table className="admin-table">
        <thead><tr><th>役名</th><th>ダンサー</th><th>状態</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input value={r.role_name} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, role_name: e.target.value } : x))} placeholder="ジゼル" /></td>
              <td>
                <select value={r.dancer_id} onChange={(e) => {
                  if (e.target.value === '__new__') { addDancer(i); return; }
                  setRows(rows.map((x, j) => j === i ? { ...x, dancer_id: e.target.value } : x));
                }}>
                  <option value="">(選択)</option>
                  {dancers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.company ? `(${d.company})` : ''}</option>)}
                  <option value="__new__">+ 新規ダンサーを追加...</option>
                </select>
              </td>
              <td>
                <select value={r.status} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, status: e.target.value } : x))}>
                  <option value="scheduled">出演予定</option>
                  <option value="changed">変更</option>
                  <option value="cancelled">降板</option>
                </select>
              </td>
              <td><button className="linklike" onClick={() => setRows(rows.filter((_, j) => j !== i))}>削除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="linklike" onClick={() => setRows([...rows, { dancer_id: '', role_name: '', status: 'scheduled' }])}>+ 役を追加</button>

      <label>公開状態 *(追補§2)</label>
      <select value={pub.publication_status} onChange={(e) => setPub({ publication_status: e.target.value })}>
        {Object.entries(PUB_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {pub.publication_status === 'member_only' && (
        <p className="notice" style={{ background: '#fdecea', border: '1px solid #e57373' }}>
          ⚠️ <strong>会員限定情報</strong>:この内容は画面・通知・検索のいかなる出力面にも公開されません。
          一般公開を<strong>目視で確認</strong>してから「一般公開」に変更してください(会員限定情報の非公開原則)。
        </p>
      )}

      {(pub.publication_status === 'announced' || pub.publication_status === 'final') && (
        <>
          <label>解禁日時(任意。指定すると、その時刻経過後のバッチで自動公開・通知)</label>
          <input type="datetime-local" value={pub.publish_not_before} onChange={(e) => setPub({ publish_not_before: e.target.value })} />
        </>
      )}

      <div className="inline-row">
        <div style={{ flex: 1 }}>
          <label>出所 *(このキャスト情報をどこで得たか)</label>
          <select value={pub.source_type} onChange={(e) => setPub({ source_type: e.target.value })}>
            {Object.entries(SOURCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>基準日(「○月○日現在」の日付。任意)</label>
          <input type="date" value={pub.as_of} onChange={(e) => setPub({ as_of: e.target.value })} />
        </div>
      </div>

      <label>出典URL *(空では保存不可)</label>
      <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://(公式のキャスト発表ページ)" />

      {willPublishNow && (
        <p className="notice" style={{ marginTop: 12 }}>
          🔔 保存すると一般公開され、フォロワー <strong>{followerCount ?? '…'}人</strong>(重複除外済み)への配信がキューに登録されます。送信は9:00/18:00のバッチ。
        </p>
      )}
      {willSchedule && (
        <p className="notice" style={{ marginTop: 12 }}>
          ⏱ 解禁日時までは非公開のまま保存されます。時刻経過後のバッチ(9:00/18:00)で自動公開され、フォロワーに通知されます。
        </p>
      )}

      <div className="inline-row" style={{ marginTop: 8 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中...' : willPublishNow ? '保存して公開(通知キュー登録)' : '保存する'}
        </button>
      </div>
    </div>
  );
}
