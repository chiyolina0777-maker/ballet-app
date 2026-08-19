'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Dancer = {
  id: string;
  name: string;
  name_kana: string | null;
  company_id: string | null;
  rank: string | null;
  profile_url: string | null;
  is_guest: boolean;
  affiliation_text: string | null;
};
type Company = { id: string; name: string };

// ダンサーの登録内容修正。名寄せに影響するため名前の変更は慎重に(かな・階級の補完が主用途)
export default function DancersAdminClient({ dancers, companies }: { dancers: Dancer[]; companies: Company[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Dancer | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? '';

  const filtered = useMemo(() => {
    const query = q.trim();
    if (!query) return dancers;
    return dancers.filter(
      (d) => d.name.includes(query) || (d.name_kana ?? '').includes(query) || companyName(d.company_id).includes(query)
    );
  }, [dancers, q]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    setMsg('');
    const res = await fetch('/api/admin/dancers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    });
    setSaving(false);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? '保存に失敗しました'); return; }
    setMsg(`${editing.name} を保存しました`);
    setEditing(null);
    router.refresh();
  }

  const set = (patch: Partial<Dancer>) => setEditing(editing ? { ...editing, ...patch } : null);

  return (
    <>
      {msg && <p className="notice">{msg}</p>}
      <div className="searchbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・かな・バレエ団で検索" />
      </div>

      {editing && (
        <div className="admin-form" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ marginTop: 0 }}>編集: {editing.name}</div>
          <label>名前 *(名寄せに影響するため変更は慎重に)</label>
          <input value={editing.name} onChange={(e) => set({ name: e.target.value })} />
          <label>かな(検索用)</label>
          <input value={editing.name_kana ?? ''} onChange={(e) => set({ name_kana: e.target.value })} placeholder="よねざわゆか" />
          <label>バレエ団</label>
          <select value={editing.company_id ?? ''} onChange={(e) => set({ company_id: e.target.value || null })}>
            <option value="">(所属なし / その他)</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>階級(例: プリンシパル)</label>
          <input value={editing.rank ?? ''} onChange={(e) => set({ rank: e.target.value })} placeholder="プリンシパル" />
          <label>プロフィールURL</label>
          <input value={editing.profile_url ?? ''} onChange={(e) => set({ profile_url: e.target.value })} placeholder="https://(公式プロフィール)" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
            <input type="checkbox" checked={editing.is_guest} onChange={(e) => set({ is_guest: e.target.checked })} style={{ width: 'auto' }} />
            ゲスト出演者(他団体からの客演)
          </label>
          {editing.is_guest && (
            <>
              <label>所属表記(例: パリ・オペラ座バレエ エトワール)</label>
              <input value={editing.affiliation_text ?? ''} onChange={(e) => set({ affiliation_text: e.target.value })} />
            </>
          )}
          <div className="inline-row" style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存する'}</button>
            <button className="linklike" onClick={() => { setEditing(null); setMsg(''); }}>キャンセル</button>
          </div>
        </div>
      )}

      <table className="admin-table">
        <thead>
          <tr><th>名前</th><th>かな</th><th>バレエ団</th><th>階級</th><th></th></tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>該当するダンサーがいません</td></tr>
          )}
          {filtered.map((d) => (
            <tr key={d.id}>
              <td>
                {d.name}
                {d.is_guest && <span className="badge">ゲスト</span>}
              </td>
              <td style={{ color: d.name_kana ? undefined : 'var(--muted)' }}>{d.name_kana || '未入力'}</td>
              <td>{companyName(d.company_id) || d.affiliation_text || '—'}</td>
              <td style={{ color: d.rank ? undefined : 'var(--muted)' }}>{d.rank || '未入力'}</td>
              <td className="acts">
                <button className="linklike" onClick={() => { setEditing({ ...d }); setMsg(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>編集</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">新規ダンサーの追加はキャスト入力画面の「+ 新規ダンサーを追加」から。削除は出演・フォロー記録が紐づくため提供していません。</p>
    </>
  );
}
