import { NextRequest, NextResponse } from 'next/server';
import { adminFromRequest } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

// ダンサーの登録内容の修正(新規作成は /api/admin/masters を継続使用)
// 削除はキャスト・フォローがFKで紐づくため提供しない
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { id, name, name_kana, company_id, rank, profile_url, is_guest, affiliation_text } = body;

  if (!id || !name?.trim()) {
    return NextResponse.json({ error: '名前は必須です' }, { status: 400 });
  }

  const { error } = await sb
    .from('dancers')
    .update({
      name: name.trim(),
      name_kana: name_kana?.trim() || null,
      company_id: company_id || null,
      rank: rank?.trim() || null,
      profile_url: profile_url?.trim() || null,
      is_guest: !!is_guest,
      affiliation_text: affiliation_text?.trim() || null,
    })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
