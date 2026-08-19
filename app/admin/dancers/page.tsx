import { supabaseAdmin } from '@/lib/supabase-admin';
import DancersAdminClient from './dancers-admin-client';

export const dynamic = 'force-dynamic';

export default async function AdminDancers() {
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const [{ data: dancers }, { data: companies }] = await Promise.all([
    sb.from('dancers').select('id,name,name_kana,company_id,rank,profile_url,is_guest,affiliation_text').order('name'),
    sb.from('companies').select('id,name').order('name'),
  ]);

  return (
    <>
      <div className="section-title">ダンサー管理({(dancers ?? []).length}名)</div>
      <DancersAdminClient dancers={dancers ?? []} companies={companies ?? []} />
    </>
  );
}
