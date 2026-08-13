import { NextRequest, NextResponse } from 'next/server';
import { adminFromRequest } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

// マスタ(団体・演目・劇場・ダンサー)のインライン追加
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const { kind, name, kana, company_id } = await req.json().catch(() => ({}));
  if (!name || !['company', 'work', 'venue', 'dancer'].includes(kind)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  let table = '';
  let row: any = {};
  if (kind === 'company') { table = 'companies'; row = { name }; }
  if (kind === 'venue') { table = 'venues'; row = { name }; }
  if (kind === 'work') { table = 'works'; row = { title: name }; }
  if (kind === 'dancer') { table = 'dancers'; row = { name, name_kana: kana ?? null, company_id: company_id ?? null }; }

  const { data, error } = await sb.from(table).insert(row).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, name });
}
