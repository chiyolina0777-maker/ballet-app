// 日時の入出力はJSTに統一する(サーバーはUTCで動くため明示指定が必須)

// timestamptz → datetime-local入力値("YYYY-MM-DDTHH:mm"、JST)
export const isoToJstInput = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16).replace(' ', 'T') : '';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

// "M/D(曜) HH:mm" 表記(JST)
export function fmtJstDT(iso: string) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('month')}/${get('day')}(${get('weekday')}) ${get('hour')}:${get('minute')}`;
}

// "M/D(曜)" 表記(JST)
export function fmtJstD(iso: string) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('month')}/${get('day')}(${get('weekday')})`;
}

// 終日扱い(23:59)か。締切時刻が不明な場合の運用(追補§4.4)
export const isJstAllDay = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }) === '23:59';
export { WD };
