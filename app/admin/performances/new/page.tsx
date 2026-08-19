import { supabaseAdmin } from '@/lib/supabase-admin';
import PerformanceForm from '../../performance-form';

export const dynamic = 'force-dynamic';

export default async function NewPerformance() {
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;
  const [c, w, v, o] = await Promise.all([
    sb.from('companies').select('id,name,sale_stage_names').order('name'),
    sb.from('works').select('id,title').order('title'),
    sb.from('venues').select('id,name').order('name'),
    sb.from('membership_orgs').select('id,name,short_name,company_id').order('sort_order'),
  ]);
  return (
    <>
      <div className="section-title">公演を作成</div>
      <PerformanceForm
        companies={c.data ?? []}
        works={(w.data ?? []).map((x: any) => ({ id: x.id, name: x.title }))}
        venues={v.data ?? []}
        membershipOrgs={(o.data ?? []) as any}
      />
    </>
  );
}
