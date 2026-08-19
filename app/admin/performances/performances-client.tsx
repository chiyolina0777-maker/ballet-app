'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

const STATUS_LABEL: Record<string, string> = {
  announced: '発表済み',
  on_sale: '発売中',
  finished: '終演',
  cancelled: '中止',
};

export default function PerfListClient({ rows }: { rows: any[] }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const fmtMD = (s: string) => {
    if (!s) return '—';
    const p = s.split('-');
    return `${parseInt(p[1])}/${parseInt(p[2])}`;
  };

  const filtered = useMemo(() => {
    const query = q.trim();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (!query) return true;
      const period = `${fmtMD(r.starts_on)} 〜 ${fmtMD(r.ends_on)}`;
      return r.title.includes(query) || r.company.includes(query) || period.includes(query);
    });
  }, [rows, q, status]);

  return (
    <>
      <div className="admin-filter">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="公演名・バレエ団・期間で検索" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">すべてのステータス</option>
          <option value="announced">発表済み</option>
          <option value="on_sale">発売中</option>
          <option value="finished">終演</option>
          <option value="cancelled">中止</option>
        </select>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>公演名</th><th>バレエ団</th><th>期間</th><th>状態</th><th>回</th><th>販売</th><th>キャスト</th><th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)' }}>
              {rows.length ? '条件に一致する公演がありません' : '公演が未登録です'}
            </td></tr>
          )}
          {filtered.map((r) => (
            <tr key={r.id}>
              <td>{r.title}</td>
              <td>{r.company}</td>
              <td>{fmtMD(r.starts_on)} 〜 {fmtMD(r.ends_on)}</td>
              <td>{STATUS_LABEL[r.status] ?? r.status}</td>
              <td>{r.showCount || '—'}</td>
              <td>{r.salesCount ? `${r.salesCount}件` : '—'}</td>
              <td style={{ fontSize: 12 }}>{r.castText}</td>
              <td className="acts">
                <Link className="btnlink mini sub" href={`/admin/performances/${r.id}/edit`}>編集</Link>{' '}
                <Link className="btnlink mini sub" href={`/admin/performances/${r.id}/shows`}>公演回</Link>{' '}
                <Link className="btnlink mini sub" href={`/admin/performances/${r.id}/casts`}>キャスト</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
