import { NextRequest, NextResponse } from 'next/server';
import { adminFromRequest } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

const STAGE_TYPES = ['s1_fastest', 's2_member', 's3_free', 's4_general', 's5_discount'];
const SOURCE_TYPES = ['public_page', 'member_site', 'member_email', 'press', 'manual', 'other'];

// datetime-local("YYYY-MM-DDTHH:mm")はJST入力として保存する
const jst = (v: any) => {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00+09:00` : s;
};

// A2-1: 公演の作成/更新(v1.3: 演目 performance_works・会場 performance_venues・発売段階 sale_stages を同時に反映)
// 公演の作成・編集では通知は発生しない(仕様書§3)。ticket_sales は非推奨となり書き込まない
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const {
    id, title, company_id, starts_on, ends_on, status, ticket_url, source_url, works,
    counts_toward_seed_right, seed_right_label, venues, stages,
  } = body;

  if (!title?.trim() || !company_id || !source_url?.trim()) {
    return NextResponse.json({ error: '公演名・バレエ団・出典URLは必須です' }, { status: 400 });
  }
  const venueRows = (venues ?? []).filter((v: any) => v.venue_id);
  const stageRows = (stages ?? []).filter((s: any) => s.stage_type || s.label?.trim() || s.opens_at);
  for (const s of stageRows) {
    if (!STAGE_TYPES.includes(s.stage_type)) return NextResponse.json({ error: '発売段階の種別が不正です' }, { status: 400 });
    if (!SOURCE_TYPES.includes(s.source_type)) return NextResponse.json({ error: '発売段階の出所は必須です' }, { status: 400 });
    if (!s.opens_at && !s.closes_at) return NextResponse.json({ error: '発売段階に開始または締切の日時を入力してください' }, { status: 400 });
    if (s.sale_type === 'lottery' && !s.closes_at) {
      return NextResponse.json({ error: '抽選の段階には申込締切(closes_at)が必須です' }, { status: 400 });
    }
  }

  const fields = {
    title: title.trim(),
    company_id,
    venue_id: venueRows[0]?.venue_id || null, // 互換のため残置(v1.4で削除)。正は performance_venues
    starts_on: starts_on || null,
    ends_on: ends_on || null,
    status: status || 'announced',
    ticket_url: ticket_url?.trim() || null,
    source_url: source_url.trim(),
    counts_toward_seed_right: !!counts_toward_seed_right,
    seed_right_label: seed_right_label?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  let perfId = id as string | undefined;
  if (perfId) {
    const { error } = await sb.from('performances').update(fields).eq('id', perfId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await sb.from('performances').insert(fields).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    perfId = data.id;
  }

  // 演目(多対多・上演順)を置換
  await sb.from('performance_works').delete().eq('performance_id', perfId);
  const workRows = (works ?? []).map((wid: string, i: number) => ({ performance_id: perfId, work_id: wid, sort_order: i }));
  if (workRows.length) {
    const { error } = await sb.from('performance_works').insert(workRows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 会場(performance_venues)。shows/seat_types/sale_stages から参照されるためid単位で更新し、
  // 消えた行は参照を外してから削除する
  const { data: prevVenues } = await sb.from('performance_venues').select('id').eq('performance_id', perfId);
  const keepVenueIds = new Set<string>();
  const venueIdByIndex: (string | null)[] = [];
  for (let i = 0; i < venueRows.length; i++) {
    const v = venueRows[i];
    const row = {
      performance_id: perfId,
      venue_id: v.venue_id,
      city_label: v.city_label?.trim() || null,
      starts_on: v.starts_on || null,
      ends_on: v.ends_on || null,
      presenter: v.presenter?.trim() || null,
      ticket_url: v.ticket_url?.trim() || null,
      sort_order: i,
    };
    if (v.id) {
      const { error } = await sb.from('performance_venues').update(row).eq('id', v.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      keepVenueIds.add(v.id);
      venueIdByIndex.push(v.id);
    } else {
      const { data, error } = await sb.from('performance_venues').insert(row).select('id').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      keepVenueIds.add(data.id);
      venueIdByIndex.push(data.id);
    }
  }
  const removedVenueIds = (prevVenues ?? []).map((v: any) => v.id).filter((vid: string) => !keepVenueIds.has(vid));
  if (removedVenueIds.length) {
    await sb.from('shows').update({ performance_venue_id: null }).in('performance_venue_id', removedVenueIds);
    await sb.from('sale_stages').update({ performance_venue_id: null }).in('performance_venue_id', removedVenueIds);
    const { error } = await sb.from('performance_venues').delete().in('id', removedVenueIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 発売段階(sale_stages)。通知履歴(notifications)がFKで紐づくためid単位で更新し、消えた行のみ削除
  const { data: prevStages } = await sb.from('sale_stages').select('id').eq('performance_id', perfId);
  const keepStageIds = new Set<string>();
  for (let i = 0; i < stageRows.length; i++) {
    const s = stageRows[i];
    const notify_category = s.stage_type === 's4_general' ? 'general' : s.stage_type === 's5_discount' ? 'discount' : 'presale';
    const venueIdx = typeof s.venue_index === 'number' ? s.venue_index : -1;
    const row = {
      performance_id: perfId,
      stage_type: s.stage_type,
      notify_category,
      label: s.label?.trim() || null,
      opens_at: jst(s.opens_at),
      closes_at: jst(s.closes_at),
      sale_type: s.sale_type === 'lottery' ? 'lottery' : 'first_come',
      result_announce_at: s.sale_type === 'lottery' ? jst(s.result_announce_at) : null,
      payment_closes_at: s.sale_type === 'lottery' ? jst(s.payment_closes_at) : null,
      performance_venue_id: venueIdx >= 0 ? venueIdByIndex[venueIdx] ?? null : null,
      membership_org_id: s.membership_org_id || null,
      channel_note: s.channel_note?.trim() || null,
      source_type: s.source_type,
      is_public_info: s.is_public_info !== false,
      sort_order: i,
    };
    if (s.id) {
      const { error } = await sb.from('sale_stages').update(row).eq('id', s.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      keepStageIds.add(s.id);
    } else {
      const { data, error } = await sb.from('sale_stages').insert(row).select('id').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      keepStageIds.add(data.id);
    }
  }
  const removedStageIds = (prevStages ?? []).map((s: any) => s.id).filter((sid: string) => !keepStageIds.has(sid));
  if (removedStageIds.length) {
    const { error } = await sb.from('sale_stages').delete().in('id', removedStageIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: perfId });
}
