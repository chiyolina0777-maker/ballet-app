'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Row = { dancer_id: string; role_name: string; status: string };

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
  const [sourceUrl, setSourceUrl] = useState(shows[0]?.casts?.[0]?.source_url ?? '');
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const show = shows[active];
  const rows = rowsByShow[show.id] ?? [];
  const setRows = (r: Row[]) => setRowsByShow({ ...rowsByShow, [show.id]: r });

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

  async function save(publish: boolean) {
    setMsg('');
    if (publish) {
      const n = followerCount ?? 0;
      const ok = window.confirm(
        `【二段確認】この内容で公開し、通知キューに登録します。\n対象: フォロワー ${n}人(重複除外済み)\n送信は次回バッチ(9:00/18:00)。登録後の取り消しはできません。`
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
        publish,
        casts: rows,
      }),
    });
    setSaving(false);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? '保存に失敗しました'); return; }
    setMsg(publish ? (j.queued ? '公開し、通知キューに登録しました(次回バッチで送信)' : `公開しました。${j.queueError ?? ''}`) : '下書き保存しました(通知なし・公演ページ非表示)');
    router.refresh();
  }

  return (
    <div className="admin-form">
      <div className="section-title">キャスト入力: {performance.title}</div>
      {msg && <p className="notice">{msg}</p>}

      <div className="tabs">
        {shows.map((s, i) => {
          const published = (s.casts ?? []).some((c: any) => c.is_published);
          const hasDraft = (s.casts ?? []).length > 0 && !published;
          return (
            <button key={s.id} className={`tab${i === active ? ' on' : ''}`} onClick={() => { setActive(i); setMsg(''); }}>
              {fmt(s.starts_at)}
              {published ? ' ✓公開' : hasDraft ? ' 下書' : ''}
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

      <label>出典URL *(空では保存不可)</label>
      <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://(公式のキャスト発表ページ)" />

      <p className="notice" style={{ marginTop: 12 }}>
        🔔 この内容で通知すると、フォロワー <strong>{followerCount ?? '…'}人</strong>(重複除外済み)への配信がキューに登録されます。送信は9:00/18:00のバッチ。
      </p>

      <div className="inline-row" style={{ marginTop: 8 }}>
        <button onClick={() => save(false)} disabled={saving}>下書き保存(通知しない)</button>
        <button className="btn-primary" onClick={() => save(true)} disabled={saving}>保存して通知(キュー登録)</button>
      </div>
    </div>
  );
}
