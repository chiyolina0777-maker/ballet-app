import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';

export const revalidate = 60;

export default async function Performances() {
  const sb = supabaseServer();
  if (!sb) {
    return <p className="notice">Supabase が未設定です。README の手順で .env.local を設定してください。</p>;
  }
  const { data, error } = await sb
    .from('performances')
    .select('id,title,starts_on,ends_on,status,companies(name),venues(name)')
    .order('starts_on', { ascending: false });

  if (error) return <p className="notice">読み込みエラー: {error.message}</p>;

  return (
    <>
      <div className="section-title">公演一覧</div>
      {(data ?? []).map((p: any) => (
        <Link key={p.id} href={`/performances/${p.id}`} className="card">
          <h3>{p.title}</h3>
          <div className="meta">
            {p.companies?.name ?? '—'} / {p.venues?.name ?? '—'} / {p.starts_on} 〜 {p.ends_on}
          </div>
        </Link>
      ))}
    </>
  );
}
