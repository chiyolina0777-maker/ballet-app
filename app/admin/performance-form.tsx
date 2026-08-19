'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Master = { id: string; name: string };
type Org = { id: string; name: string; short_name: string | null; company_id: string | null };

type VenueRow = {
  id?: string;
  venue_id: string;
  city_label: string;
  starts_on: string;
  ends_on: string;
  presenter: string;
  ticket_url: string;
};

type StageRow = {
  id?: string;
  stage_type: string;
  label: string;
  opens_at: string;
  closes_at: string;
  sale_type: string;
  result_announce_at: string;
  payment_closes_at: string;
  membership_org_id: string;
  venue_index: number; // -1 = 全会場共通
  channel_note: string;
  source_type: string;
  is_public_info: boolean;
};

// v1.3追補§4.1: 5段階モデル。団体テンプレート(companies.sale_stage_names)で使う段階を絞る
const STAGE_TYPE_LABEL: Record<string, string> = {
  s1_fastest: 's1 最速先行(郵送申込等)',
  s2_member: 's2 会員先行',
  s3_free: 's3 無料会員先行',
  s4_general: 's4 一般発売',
  s5_discount: 's5 割引',
};
const SOURCE_LABEL: Record<string, string> = {
  public_page: '公開ページ',
  member_site: '会員サイト',
  member_email: '会員メール',
  press: 'プレス',
  manual: '手入力',
  other: 'その他',
};
const PRESALE = ['s1_fastest', 's2_member', 's3_free'];

const emptyStage = (stage_type = 's4_general', label = '一般発売'): StageRow => ({
  stage_type, label, opens_at: '', closes_at: '', sale_type: 'first_come',
  result_announce_at: '', payment_closes_at: '', membership_org_id: '',
  venue_index: -1, channel_note: '', source_type: 'public_page', is_public_info: true,
});

export default function PerformanceForm(props: {
  companies: (Master & { sale_stage_names?: Record<string, string> | null })[];
  works: Master[];
  venues: Master[];
  membershipOrgs: Org[];
  initial?: any; // {id,title,company_id,starts_on,ends_on,status,ticket_url,source_url,counts_toward_seed_right,seed_right_label,works:[id],venues:VenueRow[],stages:StageRow[]}
}) {
  const router = useRouter();
  const init = props.initial ?? {};
  const [companies, setCompanies] = useState(props.companies);
  const [works, setWorks] = useState(props.works);
  const [venueMaster, setVenueMaster] = useState(props.venues);

  const [title, setTitle] = useState(init.title ?? '');
  const [companyId, setCompanyId] = useState(init.company_id ?? props.companies[0]?.id ?? '');
  const [selWorks, setSelWorks] = useState<string[]>(init.works ?? []);
  const [startsOn, setStartsOn] = useState(init.starts_on ?? '');
  const [endsOn, setEndsOn] = useState(init.ends_on ?? '');
  const [status, setStatus] = useState(init.status ?? 'announced');
  const [ticketUrl, setTicketUrl] = useState(init.ticket_url ?? '');
  const [sourceUrl, setSourceUrl] = useState(init.source_url ?? '');
  const [seedRight, setSeedRight] = useState(!!init.counts_toward_seed_right);
  const [seedRightLabel, setSeedRightLabel] = useState(init.seed_right_label ?? '');
  const [pvRows, setPvRows] = useState<VenueRow[]>(init.venues?.length ? init.venues : []);
  const [stageRows, setStageRows] = useState<StageRow[]>(init.stages?.length ? init.stages : [emptyStage()]);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const company = companies.find((c) => c.id === companyId);
  const template: Record<string, string> | null = (company as any)?.sale_stage_names ?? null;
  const stageTypeOptions = template ? Object.keys(STAGE_TYPE_LABEL).filter((k) => k in template) : Object.keys(STAGE_TYPE_LABEL);
  const companyOrgs = props.membershipOrgs.filter((o) => o.company_id === companyId);

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

  const setStage = (i: number, patch: Partial<StageRow>) =>
    setStageRows(stageRows.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setVenueRow = (i: number, patch: Partial<VenueRow>) =>
    setPvRows(pvRows.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  async function save() {
    setSaving(true);
    setMsg('');
    const res = await fetch('/api/admin/performances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: init.id,
        title, company_id: companyId,
        starts_on: startsOn || null, ends_on: endsOn || null,
        status, ticket_url: ticketUrl, source_url: sourceUrl,
        counts_toward_seed_right: seedRight, seed_right_label: seedRightLabel,
        works: selWorks,
        venues: pvRows,
        stages: stageRows.filter((s) => s.opens_at || s.closes_at || s.label.trim()),
      }),
    });
    setSaving(false);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? '保存に失敗しました'); return; }
    router.push(init.id ? '/admin/performances' : `/admin/performances/${j.id}/shows`);
  }

  const workName = (id: string) => works.find((w) => w.id === id)?.name ?? '';
  const venueName = (id: string) => venueMaster.find((v) => v.id === id)?.name ?? '';

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
        <button type="button" className="linklike" onClick={() => addMaster('company', setCompanies as any, setCompanyId)}>+ 追加</button>
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

      <label>会場(ツアー公演は都市ごとに追加。v1.3追補§3)</label>
      {pvRows.map((v, i) => (
        <div key={i} style={{ border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div className="inline-row">
            <select style={{ flex: 2 }} value={v.venue_id} onChange={(e) => setVenueRow(i, { venue_id: e.target.value })}>
              <option value="">(劇場を選択)</option>
              {venueMaster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button type="button" className="linklike" onClick={() => addMaster('venue', setVenueMaster, (id) => setVenueRow(i, { venue_id: id }))}>+ 劇場追加</button>
            <input style={{ flex: 1 }} value={v.city_label} placeholder="都市表記(例: [東京])" onChange={(e) => setVenueRow(i, { city_label: e.target.value })} />
            <button type="button" className="linklike" onClick={() => setPvRows(pvRows.filter((_, j) => j !== i))}>削除</button>
          </div>
          <div className="inline-row" style={{ marginTop: 6 }}>
            <input type="date" style={{ flex: 1 }} value={v.starts_on} onChange={(e) => setVenueRow(i, { starts_on: e.target.value })} />
            <span>〜</span>
            <input type="date" style={{ flex: 1 }} value={v.ends_on} onChange={(e) => setVenueRow(i, { ends_on: e.target.value })} />
            <input style={{ flex: 1 }} value={v.presenter} placeholder="主催(例: TBS)" onChange={(e) => setVenueRow(i, { presenter: e.target.value })} />
            <input style={{ flex: 2 }} value={v.ticket_url} placeholder="この会場のチケットURL" onChange={(e) => setVenueRow(i, { ticket_url: e.target.value })} />
          </div>
        </div>
      ))}
      <button type="button" className="linklike" onClick={() => setPvRows([...pvRows, { venue_id: '', city_label: '', starts_on: '', ends_on: '', presenter: '', ticket_url: '' }])}>+ 会場を追加</button>

      <label style={{ marginTop: 12 }}>発売段階(発売通知のトリガー。v1.3追補§4)</label>
      {template && <p className="hint">この団体で定義済みの段階のみ選択できます(会社マスタのテンプレート)。</p>}
      {stageRows.map((s, i) => (
        <div key={i} style={{ border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div className="inline-row">
            <select style={{ flex: 1 }} value={s.stage_type} onChange={(e) => {
              const t = e.target.value;
              const tplLabel = template?.[t];
              const prevTpl = template?.[s.stage_type];
              setStage(i, { stage_type: t, label: !s.label || s.label === prevTpl ? (tplLabel ?? s.label) : s.label });
            }}>
              {stageTypeOptions.map((k) => <option key={k} value={k}>{STAGE_TYPE_LABEL[k]}</option>)}
            </select>
            <input style={{ flex: 2 }} value={s.label} placeholder="表示名(例: アトレ会員先行)" onChange={(e) => setStage(i, { label: e.target.value })} />
            <select value={s.sale_type} onChange={(e) => setStage(i, { sale_type: e.target.value })}>
              <option value="first_come">先着</option>
              <option value="lottery">抽選</option>
            </select>
            <button type="button" className="linklike" onClick={() => setStageRows(stageRows.filter((_, j) => j !== i))}>削除</button>
          </div>
          <div className="inline-row" style={{ marginTop: 6 }}>
            <div style={{ flex: 1 }}>
              <label>{s.sale_type === 'lottery' ? '申込開始' : '発売開始'}</label>
              <input type="datetime-local" value={s.opens_at} onChange={(e) => setStage(i, { opens_at: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label>{s.sale_type === 'lottery' ? '申込締切 *' : '販売終了(任意)'}</label>
              <input type="datetime-local" value={s.closes_at} onChange={(e) => setStage(i, { closes_at: e.target.value })} />
            </div>
          </div>
          <p className="hint">締切の時刻が公表されていない場合は 23:59 を入れる(画面・通知では時刻を伏せて表示)。</p>
          {s.sale_type === 'lottery' && (
            <div className="inline-row" style={{ marginTop: 6 }}>
              <div style={{ flex: 1 }}>
                <label>当落発表</label>
                <input type="datetime-local" value={s.result_announce_at} onChange={(e) => setStage(i, { result_announce_at: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>入金締切</label>
                <input type="datetime-local" value={s.payment_closes_at} onChange={(e) => setStage(i, { payment_closes_at: e.target.value })} />
              </div>
            </div>
          )}
          <div className="inline-row" style={{ marginTop: 6 }}>
            {PRESALE.includes(s.stage_type) && (
              <select style={{ flex: 1 }} value={s.membership_org_id} onChange={(e) => setStage(i, { membership_org_id: e.target.value })}>
                <option value="">(会員組織: 指定なし=全員に通知)</option>
                {companyOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            {pvRows.length > 1 && (
              <select style={{ flex: 1 }} value={s.venue_index} onChange={(e) => setStage(i, { venue_index: parseInt(e.target.value) })}>
                <option value={-1}>全会場共通</option>
                {pvRows.map((v, vi) => <option key={vi} value={vi}>{v.city_label || venueName(v.venue_id) || `会場${vi + 1}`}</option>)}
              </select>
            )}
            <select style={{ flex: 1 }} value={s.source_type} onChange={(e) => setStage(i, { source_type: e.target.value })}>
              {Object.entries(SOURCE_LABEL).map(([v, l]) => <option key={v} value={v}>出所: {l}</option>)}
            </select>
          </div>
          <input style={{ marginTop: 6 }} value={s.channel_note} placeholder="購入窓口の注記(例: TBSチケット・チケットぴあWEBのみ受付)" onChange={(e) => setStage(i, { channel_note: e.target.value })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 'normal' }}>
            <input type="checkbox" checked={s.is_public_info} onChange={(e) => setStage(i, { is_public_info: e.target.checked })} style={{ width: 'auto' }} />
            一般公開情報(公式に告知されている)。オフにすると画面・通知に一切出しません
          </label>
          {(s.source_type === 'member_site' || s.source_type === 'member_email') && s.is_public_info && (
            <p className="notice" style={{ background: '#fff8e1', border: '1px solid #ffb300', marginTop: 6 }}>
              ⚠️ 会員サイト・会員メール由来の情報です。公開してよいのは「先行の存在と期間」のみ。申込URL・シリアルコード等は絶対に載せないでください(会員限定情報の非公開原則)。
            </p>
          )}
        </div>
      ))}
      <button type="button" className="linklike" onClick={() => {
        const firstType = stageTypeOptions[0] ?? 's4_general';
        setStageRows([...stageRows, emptyStage(firstType, template?.[firstType] ?? '')]);
      }}>+ 発売段階を追加</button>

      <label style={{ marginTop: 12 }}>チケットURL(/go/ の飛び先。会場別URLは会場欄に)</label>
      <input value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} placeholder="https://..." />

      <label>出典URL *</label>
      <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://(公式発表ページ)" />

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
        <input type="checkbox" checked={seedRight} onChange={(e) => setSeedRight(e.target.checked)} style={{ width: 'auto' }} />
        シード権対象公演(新国立。通知と公演詳細に1行表示。追補§7.4)
      </label>
      {seedRight && (
        <input value={seedRightLabel} onChange={(e) => setSeedRightLabel(e.target.value)} placeholder="表示文言(空欄なら「次シーズンのシード権対象公演です」)" />
      )}

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
      <p className="hint">公演の作成・編集では通知は発生しません。席種(料金表)は現時点ではSupabase Studioから登録します。</p>
    </div>
  );
}
