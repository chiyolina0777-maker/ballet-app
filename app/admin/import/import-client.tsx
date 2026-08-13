'use client';

import { useMemo, useState } from 'react';

// A2-4 キャストCSV取込。列: 日付, 開演時刻, 役名, ダンサー名
// 公演回は選択した公演内の日時完全一致でマッチ。名寄せの確定は必ず人間が行う(仕様書§3)
// 取込はすべて下書き(is_published=false)・通知なし

type Show = { id: string; starts_at: string };
type Perf = { id: string; title: string; shows: Show[] };
type Dancer = { id: string; name: string; kana: string };

function lev(a: string, b: string) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

const showKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Row = {
  line: number;
  date: string;
  time: string;
  role: string;
  dancerName: string;
  showId: string | null;
  state: 'ok' | 'confirm' | 'error';
  dancerId: string | null;      // ok時 or 候補選択後
  candidate: Dancer | null;     // 名寄せ候補
  resolution: 'candidate' | 'new' | 'skip';
};

export default function ImportClient({ performances, dancers }: { performances: Perf[]; dancers: Dancer[] }) {
  const [perfId, setPerfId] = useState(performances[0]?.id ?? '');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const perf = useMemo(() => performances.find((p) => p.id === perfId), [performances, perfId]);
  const showMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of perf?.shows ?? []) m.set(showKey(s.starts_at), s.id);
    return m;
  }, [perf]);

  function onFile(f: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      let t = new TextDecoder('utf-8').decode(buf);
      if (t.includes('�')) {
        try { t = new TextDecoder('shift_jis').decode(buf); } catch {}
      }
      setText(t.replace(/^﻿/, ''));
    };
    reader.readAsArrayBuffer(f);
  }

  function validate() {
    setMsg('');
    if (!perf) { setMsg('対象公演を選択してください'); return; }
    if (!perf.shows.length) { setMsg('この公演には公演回が未登録です(先にA2-2で登録)'); return; }
    let lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length && /日付|date/i.test(lines[0])) lines = lines.slice(1);
    if (!lines.length) { setMsg('CSVが空です'); return; }

    const out: Row[] = lines.map((ln, i) => {
      const [date, time, role, name] = ln.split(',').map((s) => (s ?? '').trim());
      const key = `${date?.replace(/^0/, '')} ${time}`;
      const showId = showMap.get(key) ?? null;
      const base = { line: i + 1, date, time, role, dancerName: name };
      if (!showId || !role || !name) {
        return { ...base, showId, state: 'error' as const, dancerId: null, candidate: null, resolution: 'skip' as const };
      }
      const exact = dancers.find((d) => d.name === name);
      if (exact) return { ...base, showId, state: 'ok' as const, dancerId: exact.id, candidate: null, resolution: 'candidate' as const };
      const scored = dancers
        .map((d) => ({ d, dist: Math.min(lev(d.name, name), d.kana ? lev(d.kana, name) : 9) }))
        .sort((a, b) => a.dist - b.dist)[0];
      const candidate = scored && scored.dist <= 1 ? scored.d : null;
      return {
        ...base, showId, state: 'confirm' as const, dancerId: candidate?.id ?? null,
        candidate, resolution: candidate ? ('candidate' as const) : ('new' as const),
      };
    });
    setRows(out);
  }

  const importable = (rows ?? []).filter((r) => r.state !== 'error' && r.resolution !== 'skip');

  async function commit() {
    if (!importable.length) return;
    setBusy(true);
    setMsg('');
    const payload = importable.map((r) => ({
      show_id: r.showId,
      role_name: r.role,
      dancer_id: r.resolution === 'candidate' ? r.dancerId : null,
      new_dancer_name: r.resolution === 'new' ? r.dancerName : null,
    }));
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: payload }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? '取込に失敗しました'); return; }
    setMsg(`${j.inserted}行を下書きとして取り込みました(新規ダンサー${j.newDancers}名・重複スキップ${j.skipped}行)。通知は送信されません。公開はA2-3から。`);
    setRows(null);
    setText('');
  }

  return (
    <div className="admin-form">
      <div className="section-title">CSV取込(キャスト)</div>
      {msg && <p className="notice">{msg}</p>}

      <label>対象公演</label>
      <select value={perfId} onChange={(e) => { setPerfId(e.target.value); setRows(null); }}>
        {performances.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>

      <label>CSVファイル(UTF-8 / Shift_JIS 自動判定)または直接貼り付け</label>
      <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      <textarea
        rows={6}
        style={{ width: '100%', font: 'inherit', fontSize: 13, border: '1px solid var(--line)', borderRadius: 6, padding: 8, marginTop: 6 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'日付,開演時刻,役名,ダンサー名\n10/11,14:00,ジゼル,米沢唯'}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={validate}>検証プレビュー</button>
      </div>

      {rows && (
        <>
          <label>検証結果: OK {rows.filter((r) => r.state === 'ok').length} / 要確認 {rows.filter((r) => r.state === 'confirm').length} / エラー {rows.filter((r) => r.state === 'error').length}</label>
          <table className="admin-table">
            <thead><tr><th>行</th><th>公演回</th><th>役名</th><th>ダンサー</th><th>判定</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.line}</td>
                  <td>{r.date} {r.time}</td>
                  <td>{r.role}</td>
                  <td>{r.dancerName}</td>
                  <td style={{ fontSize: 12 }}>
                    {r.state === 'ok' && <span style={{ color: 'var(--ok)' }}>✓ OK</span>}
                    {r.state === 'error' && <span style={{ color: '#B03030' }}>エラー: {!r.showId ? '該当する公演回がありません' : '役名/ダンサー名が空'}</span>}
                    {r.state === 'confirm' && (
                      <select
                        value={r.resolution}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, resolution: e.target.value as any } : x)))}
                      >
                        {r.candidate && <option value="candidate">{r.candidate.name}(既存)に対応づける</option>}
                        <option value="new">新規ダンサーとして登録</option>
                        <option value="skip">この行をスキップ</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={commit} disabled={busy || !importable.length}>
              {busy ? '取込中...' : `${importable.length}行を下書きとして取り込む`}
            </button>
          </div>
        </>
      )}
      <p className="hint">
        列: 日付(M/D), 開演時刻(HH:MM), 役名, ダンサー名。公演回は対象公演内の日時完全一致。
        既存キャストと重複する行はスキップ。取込はすべて下書き(公演ページ非表示・通知なし)で、公開と通知はA2-3から行う。
      </p>
    </div>
  );
}
