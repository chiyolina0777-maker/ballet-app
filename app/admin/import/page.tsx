import { supabaseAdmin } from '@/lib/supabase-admin';
import ImportClient from './import-client';

export const dynamic = 'force-dynamic';

export default async function AdminImport() {
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const [{ data: perfs }, { data: dancers }] = await Promise.all([
    sb.from('performances').select('id,title,starts_on,shows(id,starts_at)').order('starts_on', { ascending: false }),
    sb.from('dancers').select('id,name,name_kana'),
  ]);

  return (
    <ImportClient
      performances={(perfs ?? []).map((p: any) => ({
        id: p.id,
        title: p.title,
        shows: (p.shows ?? []).map((s: any) => ({ id: s.id, starts_at: s.starts_at })),
      }))}
      dancers={(dancers ?? []).map((d: any) => ({ id: d.id, name: d.name, kana: d.name_kana ?? '' }))}
    />
  );
}
