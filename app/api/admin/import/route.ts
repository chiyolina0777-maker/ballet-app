import { NextRequest, NextResponse } from 'next/server';
import { adminFromRequest } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

// A2-4: キャストCSV取込の確定。すべて下書き(publication_status=tbd → is_published=false)・通知なし(v1.3追補§10-1)
// 既存キャスト(show_id, dancer_id, role_name 重複)はスキップ
export async function POST(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const { rows } = await req.json().catch(() => ({}));
  if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  // 新規ダンサーを先に作成(同名はバッチ内で1回だけ)
  const newNames = [...new Set(rows.filter((r: any) => !r.dancer_id && r.new_dancer_name).map((r: any) => String(r.new_dancer_name).trim()))];
  const nameToId = new Map<string, string>();
  for (const name of newNames) {
    const { data, error } = await sb.from('dancers').insert({ name }).select('id').single();
    if (error) return NextResponse.json({ error: `ダンサー作成失敗(${name}): ${error.message}` }, { status: 500 });
    nameToId.set(name, data.id);
  }

  const castRows = rows
    .map((r: any) => ({
      show_id: r.show_id,
      dancer_id: r.dancer_id ?? nameToId.get(String(r.new_dancer_name ?? '').trim()),
      role_name: String(r.role_name ?? '').trim(),
      status: 'scheduled',
      publication_status: 'tbd', // is_published はDBトリガーが false に導出
      source_type: 'manual',
    }))
    .filter((r) => r.show_id && r.dancer_id && r.role_name);

  // 重複はスキップ(unique: show_id, dancer_id, role_name)
  const { data: inserted, error } = await sb
    .from('casts')
    .upsert(castRows, { onConflict: 'show_id,dancer_id,role_name', ignoreDuplicates: true })
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    inserted: inserted?.length ?? 0,
    skipped: castRows.length - (inserted?.length ?? 0),
    newDancers: newNames.length,
  });
}
