'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogForm(props: { showId: string; initialSeat: string; initialMemo: string; exists: boolean }) {
  const router = useRouter();
  const [seat, setSeat] = useState(props.initialSeat);
  const [memo, setMemo] = useState(props.initialMemo);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg('');
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_id: props.showId, seat, memo }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? '保存に失敗しました');
      return;
    }
    router.push('/me');
  }

  async function remove() {
    if (!window.confirm('この観劇ログを削除しますか?')) return;
    setBusy(true);
    const res = await fetch('/api/logs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_id: props.showId }),
    });
    setBusy(false);
    if (res.ok) router.push('/me');
    else setMsg('削除に失敗しました');
  }

  return (
    <div className="admin-form">
      {msg && <p className="notice">{msg}</p>}
      <label>座席(任意)</label>
      <input value={seat} onChange={(e) => setSeat(e.target.value)} placeholder="例: 1階 12列 24番" />
      <label>感想メモ(任意)</label>
      <textarea
        rows={5}
        style={{ width: '100%', font: 'inherit', border: '1px solid var(--line)', borderRadius: 6, padding: 8 }}
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="よかった場面、カーテンコールの様子など"
      />
      <div className="inline-row" style={{ marginTop: 12 }}>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? '保存中...' : '保存する'}</button>
        {props.exists && <button className="linklike" onClick={remove} disabled={busy}>削除</button>}
      </div>
      <p className="hint">記録は非公開です(あなただけが見られます)。</p>
    </div>
  );
}
