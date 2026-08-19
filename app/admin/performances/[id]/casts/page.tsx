import { supabaseAdmin } from '@/lib/supabase-admin';
import CastsClient from './casts-client';

export const dynamic = 'force-dynamic';

export default async function AdminCasts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();
  if (!sb) return <p className="notice">サーバー設定エラー</p>;

  const { data: perf } = await sb.from('performances').select('id,title,source_url').eq('id', id).single();
  if (!perf) return <p className="notice">公演が見つかりません</p>;

  const [{ data: shows }, { data: dancers }] = await Promise.all([
    sb.from('shows').select('id,starts_at,casts(dancer_id,role_name,status,is_published,source_url,publication_status,publish_not_before,source_type,as_of)').eq('performance_id', id).order('starts_at'),
    sb.from('dancers').select('id,name,name_kana,companies(name)').order('name'),
  ]);
  if (!shows?.length) {
    return (
      <p className="notice">
        公演回が未登録です。先に公演回の登録を行ってください。
        <span style={{ display: 'block', marginTop: 10 }}>
          <a className="btnlink" href={`/admin/performances/${id}/shows`}>公演回の登録へ</a>
        </span>
      </p>
    );
  }

  return (
    <CastsClient
      performance={perf}
      shows={shows}
      dancers={(dancers ?? []).map((d: any) => ({ id: d.id, name: d.name, kana: d.name_kana ?? '', company: d.companies?.name ?? '' }))}
    />
  );
}
