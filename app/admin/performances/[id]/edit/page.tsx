import { supabaseAdmin } from '@/lib/supabase-admin';
import PerformanceForm from '../../../performance-form';

export const dynamic = 'force-dynamic';

export default async function EditPerformance({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const [c, w, v, p] = await Promise.all([
    sb.from('companies').select('id,name').order('name'),
    sb.from('works').select('id,title').order('title'),
    sb.from('venues').select('id,name').order('name'),
    sb.from('performances')
      .select('id,title,company_id,venue_id,starts_on,ends_on,status,ticket_url,source_url,performance_works(work_id,sort_order),ticket_sales(label,sale_starts_at)')
      .eq('id', id)
      .single(),
  ]);
  const perf: any = p.data;
  if (!perf) return <p className="notice">公演が見つかりません</p>;

  const initial = {
    ...perf,
    works: (perf.performance_works ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((x: any) => x.work_id),
    sales: (perf.ticket_sales ?? [])
      .sort((a: any, b: any) => String(a.sale_starts_at).localeCompare(String(b.sale_starts_at)))
      .map((s: any) => ({ label: s.label ?? '', at: String(s.sale_starts_at).slice(0, 16) })),
  };

  return (
    <>
      <div className="section-title">公演を編集: {perf.title}</div>
      <PerformanceForm
        companies={c.data ?? []}
        works={(w.data ?? []).map((x: any) => ({ id: x.id, name: x.title }))}
        venues={v.data ?? []}
        initial={initial}
      />
    </>
  );
}
