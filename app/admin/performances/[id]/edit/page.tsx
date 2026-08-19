import { supabaseAdmin } from '@/lib/supabase-admin';
import { isoToJstInput } from '@/lib/jst';
import PerformanceForm from '../../../performance-form';

export const dynamic = 'force-dynamic';

export default async function EditPerformance({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const [c, w, v, o, p] = await Promise.all([
    sb.from('companies').select('id,name,sale_stage_names').order('name'),
    sb.from('works').select('id,title').order('title'),
    sb.from('venues').select('id,name').order('name'),
    sb.from('membership_orgs').select('id,name,short_name,company_id').order('sort_order'),
    sb.from('performances')
      .select(
        'id,title,company_id,starts_on,ends_on,status,ticket_url,source_url,counts_toward_seed_right,seed_right_label,' +
          'performance_works(work_id,sort_order),' +
          'performance_venues(id,venue_id,city_label,starts_on,ends_on,presenter,ticket_url,sort_order),' +
          'sale_stages(id,stage_type,label,opens_at,closes_at,sale_type,result_announce_at,payment_closes_at,membership_org_id,performance_venue_id,channel_note,source_type,is_public_info,sort_order)'
      )
      .eq('id', id)
      .single(),
  ]);
  const perf: any = p.data;
  if (!perf) return <p className="notice">公演が見つかりません</p>;

  const venues = (perf.performance_venues ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((x: any) => ({
      id: x.id,
      venue_id: x.venue_id ?? '',
      city_label: x.city_label ?? '',
      starts_on: x.starts_on ?? '',
      ends_on: x.ends_on ?? '',
      presenter: x.presenter ?? '',
      ticket_url: x.ticket_url ?? '',
    }));
  const venueIndexById = new Map<string, number>((perf.performance_venues ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((x: any, i: number) => [x.id, i]));

  const initial = {
    ...perf,
    works: (perf.performance_works ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((x: any) => x.work_id),
    venues,
    stages: (perf.sale_stages ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order || String(a.opens_at ?? '').localeCompare(String(b.opens_at ?? '')))
      .map((s: any) => ({
        id: s.id,
        stage_type: s.stage_type ?? 's4_general',
        label: s.label ?? '',
        opens_at: isoToJstInput(s.opens_at),
        closes_at: isoToJstInput(s.closes_at),
        sale_type: s.sale_type ?? 'first_come',
        result_announce_at: isoToJstInput(s.result_announce_at),
        payment_closes_at: isoToJstInput(s.payment_closes_at),
        membership_org_id: s.membership_org_id ?? '',
        venue_index: s.performance_venue_id != null ? (venueIndexById.get(s.performance_venue_id) ?? -1) : -1,
        channel_note: s.channel_note ?? '',
        source_type: s.source_type ?? 'public_page',
        is_public_info: s.is_public_info !== false,
      })),
  };

  return (
    <>
      <div className="section-title">公演を編集: {perf.title}</div>
      <PerformanceForm
        companies={c.data ?? []}
        works={(w.data ?? []).map((x: any) => ({ id: x.id, name: x.title }))}
        venues={v.data ?? []}
        membershipOrgs={(o.data ?? []) as any}
        initial={initial}
      />
    </>
  );
}
