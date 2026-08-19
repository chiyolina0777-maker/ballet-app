'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
// 2026年の祝日(本番は祝日ライブラリ/マスタへ)
const HOLIDAYS = new Set(['1/1','1/12','2/11','2/23','3/20','4/29','5/3','5/4','5/5','5/6','7/20','8/11','9/21','9/22','9/23','10/12','11/3','11/23']);
const isHoliday = (d: Date) => d.getFullYear() === 2026 && HOLIDAYS.has(`${d.getMonth() + 1}/${d.getDate()}`);

const fmt = (d: Date) =>
  `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}${isHoliday(d) ? '・祝' : ''}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

type DayTimes = { mat: string; eve: string }; // 昼(マチネ)/夜(ソワレ)。空欄=その枠は公演なし

export default function ShowsClient({ performance, existing }: { performance: any; existing: any[] }) {
  const router = useRouter();
  const [period, setPeriod] = useState('');
  const [wdTimes, setWdTimes] = useState<Record<string, DayTimes>>({
    '1': { mat: '', eve: '19:00' },
    '2': { mat: '', eve: '19:00' },
    '3': { mat: '', eve: '19:00' },
    '4': { mat: '', eve: '19:00' },
    '5': { mat: '', eve: '19:00' },
    '6': { mat: '', eve: '18:00' },
    '0': { mat: '14:00', eve: '' },
    hol: { mat: '', eve: '' },
  });
  const [draft, setDraft] = useState<Date[]>([]);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const normTime = (t: string) => {
    const m = (t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    return m ? [parseInt(m[1]), parseInt(m[2])] : null;
  };

  function generate() {
    setMsg('');
    const pm = period.match(/(\d{1,2})\/(\d{1,2}).*?(\d{1,2})\/(\d{1,2})/);
    if (!pm) { setMsg('期間を「M/D 〜 M/D」形式で入力してください'); return; }
    const year = parseInt((performance.starts_on || '2026').slice(0, 4)) || 2026;
    const d0 = new Date(year, +pm[1] - 1, +pm[2]);
    const d1 = new Date(year, +pm[3] - 1, +pm[4]);
    const out: Date[] = [];
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
      const hol = isHoliday(d);
      const holTimes = wdTimes.hol;
      const useHol = hol && (normTime(holTimes.mat) || normTime(holTimes.eve));
      const times = useHol ? holTimes : wdTimes[String(d.getDay())];
      // 昼夜2回公演: 両方に時刻が入っていれば同日2回生成する
      for (const t of [normTime(times.mat), normTime(times.eve)]) {
        if (!t) continue;
        out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), t[0], t[1]));
      }
    }
    if (!out.length) setMsg('この期間・時刻設定では公演回が生成されませんでした');
    setDraft(out);
  }

  async function save() {
    if (!draft.length) return;
    setSaving(true);
    const res = await fetch('/api/admin/shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ performance_id: performance.id, starts_at_list: draft.map((d) => d.toISOString()) }),
    });
    setSaving(false);
    const j = await res.json();
    if (!res.ok) { setMsg(j.error ?? '保存に失敗しました'); return; }
    router.push(`/admin/performances/${performance.id}/casts`);
  }

  async function remove(showId: string) {
    if (!window.confirm('この公演回を削除しますか?(キャストも消えます)')) return;
    const res = await fetch('/api/admin/shows', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_id: showId }),
    });
    if (!res.ok) { const j = await res.json(); setMsg(j.error ?? '削除に失敗'); return; }
    router.refresh();
  }

  const cells: [string, string][] = [['1','月'],['2','火'],['3','水'],['4','木'],['5','金'],['6','土'],['0','日'],['hol','祝']];

  return (
    <div className="admin-form">
      <div className="section-title">公演回を登録: {performance.title}</div>
      {msg && <p className="notice">{msg}</p>}

      {existing.length > 0 && (
        <>
          <label>登録済みの公演回({existing.length}回)</label>
          {existing.map((s) => (
            <div key={s.id} className="inline-row" style={{ justifyContent: 'space-between' }}>
              <span>{fmt(new Date(s.starts_at))}</span>
              <button className="linklike" onClick={() => remove(s.id)}>削除</button>
            </div>
          ))}
        </>
      )}

      <label>期間(M/D 〜 M/D)</label>
      <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="10/11 〜 10/14" />

      <label>曜日別の開演時刻(昼・夜の両方に入れると同日2回公演。空欄=その枠は公演なし。「祝」は曜日設定より優先)</label>
      <div className="wd-grid">
        {cells.map(([k, name]) => (
          <div key={k} className="wd-cell">
            <div className="wd-name">{name}</div>
            <input
              value={wdTimes[k].mat}
              onChange={(e) => setWdTimes({ ...wdTimes, [k]: { ...wdTimes[k], mat: e.target.value } })}
              placeholder="昼"
              title="昼公演(マチネ)の開演時刻"
            />
            <input
              style={{ marginTop: 4 }}
              value={wdTimes[k].eve}
              onChange={(e) => setWdTimes({ ...wdTimes, [k]: { ...wdTimes[k], eve: e.target.value } })}
              placeholder="夜"
              title="夜公演(ソワレ)の開演時刻"
            />
          </div>
        ))}
      </div>
      <p className="hint">上段=昼公演(マチネ)、下段=夜公演(ソワレ)。例: 土曜が13:00と18:00の2回なら両方に入力。</p>
      <button className="linklike" onClick={generate}>この条件で一括生成(下書き)</button>

      {draft.length > 0 && (
        <>
          <label>生成プレビュー({draft.length}回)</label>
          {draft.map((d, i) => (
            <div key={i} className="inline-row" style={{ justifyContent: 'space-between' }}>
              <span>{fmt(d)}</span>
              <button className="linklike" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>除外</button>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? '保存中...' : `${draft.length}回を保存してキャスト入力へ`}
            </button>
          </div>
        </>
      )}
      <p className="hint">公演回の登録では通知は発生しません。観劇ログが紐づく回は削除できません。</p>
    </div>
  );
}
