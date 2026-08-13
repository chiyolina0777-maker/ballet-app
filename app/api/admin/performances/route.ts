import { NextRequest, NextResponse } from 'next/server';
import { adminFromRequest } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

// A2-1: 公演の作成/更新(演目 performance_works と販売 ticket_sales を同時に置換)
// 公演の作成・編集では通知は発生しない(仕様書§3)
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { id, title, company_id, venue_id, starts_on, ends_on, status, ticket_url, source_url, works, sales } = body;

  if (!title?.trim() || !company_id || !source_url?.trim()) {
    return NextResponse.json({ error: '公演名・バレエ団・出典URLは必須です' }, { status: 400 });
  }
  const badSale = (sales ?? []).some((s: any) => s.label?.trim() && !s.at);
  if (badSale) return NextResponse.json({ error: '販売日時が空の行があります(種別のみ)' }, { status: 400 });

  const fields = {
    title: title.trim(),
    company_id,
    venue_id: venue_id || null,
    starts_on: starts_on || null,
    ends_on: ends_on || null,
    status: status || 'announced',
    ticket_url: ticket_url?.trim() || null,
    source_url: source_url.trim(),
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

  // 販売窓口を置換(日時のある行のみ・昇順)
  await sb.from('ticket_sales').delete().eq('performance_id', perfId);
  const saleRows = (sales ?? [])
    .filter((s: any) => s.at)
    .map((s: any) => ({ performance_id: perfId, label: s.label?.trim() || '一般発売', sale_starts_at: s.at }));
  if (saleRows.length) {
    const { error } = await sb.from('ticket_sales').insert(saleRows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: perfId });
}
