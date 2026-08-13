import { supabaseServer } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';
import DancersClient from './dancers-client';

export const dynamic = 'force-dynamic';

const RANK_ORDER = ['プリンシパル', 'ファースト・ソリスト', 'ソリスト', 'ファースト・アーティスト', 'アーティスト', ''];

export default async function Dancers() {
  const sb = supabaseServer();
  if (!sb) {
    return <p className="notice">Supabase が未設定です。README の手順で .env.local を設定してください。</p>;
  }
  const { data, error } = await sb.from('dancers').select('id,name,name_kana,rank,companies(id,name)');
  if (error) return <p className="notice">読み込みエラー: {error.message}</p>;

  const dancers = (data ?? [])
    .map((d: any) => ({
      id: d.id,
      name: d.name,
      kana: d.name_kana ?? '',
      rank: d.rank ?? '',
      companyId: d.companies?.id ?? null,
      companyName: d.companies?.name ?? 'その他',
    }))
    .sort((a, b) => {
      const r = RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
      if (r !== 0) return r;
      return a.kana.localeCompare(b.kana, 'ja');
    });

  // ログイン中ならフォロー状態と友だち状態を取得(service role。書き込み同様サーバー側のみ)
  const session = await getSession();
  let follows: string[] = [];
  let companyFollows: string[] = [];
  let isFriend = false;
  if (session) {
    const admin = supabaseAdmin();
    if (admin) {
      const [f, cf, p] = await Promise.all([
        admin.from('follows').select('dancer_id').eq('user_id', session.uid),
        admin.from('company_follows').select('company_id').eq('user_id', session.uid),
        admin.from('profiles').select('is_line_friend').eq('id', session.uid).maybeSingle(),
      ]);
      follows = (f.data ?? []).map((x: any) => x.dancer_id);
      companyFollows = (cf.data ?? []).map((x: any) => x.company_id);
      isFriend = !!p.data?.is_line_friend;
    }
  }

  return (
    <DancersClient
      dancers={dancers}
      loggedIn={!!session}
      initialFollows={follows}
      initialCompanyFollows={companyFollows}
      isFriend={isFriend}
      friendUrl={process.env.LINE_FRIEND_URL || ''}
    />
  );
}
