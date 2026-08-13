import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';

export const revalidate = 60;

const STATUS: Record<string, { label: string; cls: string }> = {
  announced: { label: '発表済み', cls: 'warn' },
  on_sale: { label: '発売中', cls: 'ok' },
  finished: { label: '終演', cls: '' },
  cancelled: { label: '中止', cls: 'warn' },
};

export default async function Home() {
  const sb = supabaseServer();
  if (!sb) {
    return <p className="notice">Supabase が未設定です。README の手順で .env.local を設定してください。</p>;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('performances')
    .select('id,title,starts_on,ends_on,status,companies(name),venues(name)')
    .gte('starts_on', today)
    .order('starts_on');

  if (error) return <p className="notice">読み込みエラー: {error.message}</p>;

  return (
    <>
      <div className="notice" style={{ marginBottom: 12 }}>
        推しをフォローすると、キャスト発表・発売開始がLINEに届きます(S4 ダンサー一覧から)。
      </div>
      <div className="section-title">今後の公演</div>
      {(data ?? []).length === 0 && <p className="notice">今後の公演はまだ登録されていません。</p>}
      {(data ?? []).map((p: any) => {
        const st = STATUS[p.status] ?? { label: p.status, cls: '' };
        return (
          <Link key={p.id} href={`/performances/${p.id}`} className="card">
            <h3>
              {p.title}
              {st.cls ? <span className={`badge ${st.cls}`}>{st.label}</span> : null}
            </h3>
            <div className="meta">
              {p.companies?.name ?? '—'} / {p.venues?.name ?? '—'} / {p.starts_on} 〜 {p.ends_on}
            </div>
          </Link>
        );
      })}
    </>
  );
}
