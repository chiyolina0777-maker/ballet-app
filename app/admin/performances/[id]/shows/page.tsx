import { supabaseAdmin } from '@/lib/supabase-admin';
import ShowsClient from './shows-client';

export const dynamic = 'force-dynamic';

export default async function AdminShows({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const { data: perf } = await sb.from('performances').select('id,title,starts_on').eq('id', id).single();
  if (!perf) return <p className="notice">公演が見つかりません</p>;
  const { data: shows } = await sb.from('shows').select('id,starts_at').eq('performance_id', id).order('starts_at');

  return <ShowsClient performance={perf} existing={shows ?? []} />;
}
