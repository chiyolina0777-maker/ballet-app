import { supabaseAdmin } from '@/lib/supabase-admin';
import PerfListClient from './performances-client';

export const dynamic = 'force-dynamic';

export default async function AdminPerformances() {
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー(service role未設定)</p>;

  const { data, error } = await sb
    .from('performances')
    .select('id,title,starts_on,ends_on,status,companies(name),shows(id,casts(id,is_published)),ticket_sales(id)')
    .order('starts_on', { ascending: false });
  if (error) return <p className="notice">読み込みエラー: {error.message}</p>;

  const rows = (data ?? []).map((p: any) => {
    const shows = p.shows ?? [];
    const published = shows.filter((s: any) => (s.casts ?? []).some((c: any) => c.is_published)).length;
    const drafts = shows.filter((s: any) => (s.casts ?? []).length > 0 && !(s.casts ?? []).some((c: any) => c.is_published)).length;
    return {
      id: p.id,
      title: p.title,
      company: p.companies?.name ?? '—',
      starts_on: p.starts_on,
      ends_on: p.ends_on,
      status: p.status,
      showCount: shows.length,
      salesCount: (p.ticket_sales ?? []).length,
      castText: published ? `${published}/${shows.length}回 公開` : drafts ? '下書きのみ' : '未入力',
    };
  });

  return <PerfListClient rows={rows} />;
}
