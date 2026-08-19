'use client';

import { useState } from 'react';

type Org = { id: string; name: string; company: string; is_paid: boolean; join_url: string | null };

// 加入している会員組織のチェックリスト(v1.3追補§6.3)。団体別に一覧表示
export default function MembershipsClient({ orgs, initial }: { orgs: Org[]; initial: string[] }) {
  const [joined, setJoined] = useState(new Set(initial));
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(orgId: string) {
    setBusy(orgId);
    try {
      const res = await fetch('/api/me/memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!res.ok) return;
      const j = await res.json();
      const next = new Set(joined);
      if (j.member) next.add(orgId);
      else next.delete(orgId);
      setJoined(next);
    } finally {
      setBusy(null);
    }
  }

  const byCompany = new Map<string, Org[]>();
  for (const o of orgs) {
    const arr = byCompany.get(o.company) ?? [];
    arr.push(o);
    byCompany.set(o.company, arr);
  }

  return (
    <div className="card">
      <p className="meta" style={{ marginBottom: 8 }}>
        加入している会員組織にチェックすると、会員先行の通知があなたに合わせて絞り込まれます(任意。未設定の場合はすべての先行通知が届きます)。
      </p>
      {[...byCompany.entries()].map(([company, list]) => (
        <div key={company} style={{ marginBottom: 8 }}>
          <div className="meta"><strong>{company || 'その他'}</strong></div>
          {list.map((o) => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontWeight: 'normal' }}>
              <input
                type="checkbox"
                checked={joined.has(o.id)}
                disabled={busy === o.id}
                onChange={() => toggle(o.id)}
                style={{ width: 'auto' }}
              />
              <span>
                {o.name}
                {!o.is_paid && <span className="badge">無料</span>}
              </span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
