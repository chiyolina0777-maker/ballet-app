'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Master = { id: string; name: string };

export default function PerformanceForm(props: {
  companies: Master[];
  works: Master[];
  venues: Master[];
  initial?: any; // {id,title,company_id,venue_id,starts_on,ends_on,status,ticket_url,source_url,works:[id],sales:[{label,at}]}
}) {
  const router = useRouter();
  const init = props.initial ?? {};
  const [companies, setCompanies] = useState(props.companies);
  const [works, setWorks] = useState(props.works);
  const [venues, setVenues] = useState(props.venues);

  const [title, setTitle] = useState(init.title ?? '');
  const [companyId, setCompanyId] = useState(init.company_id ?? props.companies[0]?.id ?? '');
  const [venueId, setVenueId] = useState(init.venue_id ?? '');
  const [selWorks, setSelWorks] = useState<string[]>(init.works ?? []);
  const [startsOn, setStartsOn] = useState(init.starts_on ?? '');
  const [endsOn, setEndsOn] = useState(init.ends_on ?? '');
  const [status, setStatus] = useState(init.status ?? 'announced');
  const [ticketUrl, setTicketUrl] = useState(init.ticket_url ?? '');
  const [sourceUrl, setSourceUrl] = useState(init.source_url ?? '');
  const [sales, setSales] = useState<{ label: string; at: string }[]>(
    init.sales?.length ? init.sales : [{ label: '一般発売', at: '' }]
  );
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function addMaster(kind: 'company' | 'work' | 'venue', setter: (f: (p: Master[]) => Master[]) => void, after?: (id: string) => void) {
    const name = window.prompt(`新しい${kind === 'company' ? '団体' : kind === 'work' ? '演目' : '劇場'}名を入力`);
    if (!name?.trim()) return;
    const res = await fetch('/api/admin/masters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, name: name.trim() }),
    });
    if (!res.ok) { setMsg('マスタ追加に失敗しました'); return; }
    const { id } = await res.json();
    setter((p) => [...p, { id, name: name.trim() }]);
    after?.(id);
  }

  async function save() {
    setSaving(true);
    setMsg('');
    const res = await fetch('/api/admin/performances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: init.id,
        title, company_id: companyId, venue_id: venueId || null,
        starts_on: startsOn || null, ends_on: endsOn || null,
        status, ticket_url: ticketUrl, source_url: sourceUrl,
        works: selWorks, sales,
      }),
    });
    setSaving(false);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? '保存に失敗しました'); return; }
    router.push(init.id ? '/admin/performances' : `/admin/performances/${j.id}/shows`);
  }

  const workName = (id: string) => works.find((w) => w.id === id)?.name ?? '';

  return (
    <div className="admin-form">
      {msg && <p className="notice">{msg}</p>}
      <label>公演名 *</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="『ジゼル』全2幕" />

      <label>バレエ団・主催 *</label>
      <div className="inline-row">
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" className="linklike" onClick={() => addMaster('company', setCompanies, setCompanyId)}>+ 追加</button>
      </div>

      <label>演目(複数可・上演順)</label>
      <div>
        {selWorks.map((id) => (
          <span key={id} className="wtag">
            {workName(id)}
            <button type="button" className="linklike" onClick={() => setSelWorks(selWorks.filter((x) => x !== id))}>×</button>
          </span>
        ))}
      </div>
      <div className="inline-row">
        <select value="" onChange={(e) => { if (e.target.value) setSelWorks([...selWorks, e.target.value]); }}>
          <option value="">＋ 演目を追加...</option>
          {works.filter((w) => !selWorks.includes(w.id)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button type="button" className="linklike" onClick={() => addMaster('work', setWorks, (id) => setSelWorks((p) => [...p, id]))}>+ 新規演目</button>
      </div>

      <label>劇場</label>
      <div className="inline-row">
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">(未定)</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button type="button" className="linklike" onClick={() => addMaster('venue', setVenues, setVenueId)}>+ 追加</button>
      </div>

      <div className="inline-row">
        <div style={{ flex: 1 }}>
          <label>開催期間(開始)</label>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label>開催期間(終了)</label>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>

      <label>チケット販売日時(複数可・発売通知のトリガー)</label>
      {sales.map((s, i) => (
        <div key={i} className="inline-row">
          <input style={{ flex: 1 }} value={s.label} placeholder="種別(例: 会員先行)" onChange={(e) => setSales(sales.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
          <input style={{ flex: 1 }} type="datetime-local" value={s.at} onChange={(e) => setSales(sales.map((x, j) => j === i ? { ...x, at: e.target.value } : x))} />
          <button type="button" className="linklike" onClick={() => setSales(sales.filter((_, j) => j !== i))}>削除</button>
        </div>
      ))}
      <button type="button" className="linklike" onClick={() => setSales([...sales, { label: '', at: '' }])}>+ 販売日時を追加</button>

      <label>チケットURL(/go/ の飛び先)</label>
      <input value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} placeholder="https://..." />

      <label>出典URL *</label>
      <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://(公式発表ページ)" />

      <label>ステータス</label>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="announced">発表済み</option>
        <option value="on_sale">発売中</option>
        <option value="finished">終演</option>
        <option value="cancelled">中止</option>
      </select>

      <div style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中...' : init.id ? '保存する' : '保存して公演回の登録へ'}
        </button>
      </div>
      <p className="hint">公演の作成・編集では通知は発生しません。</p>
    </div>
  );
}
