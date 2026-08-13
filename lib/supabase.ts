import { createClient } from '@supabase/supabase-js';

// 公開ページ(SSR)の読み取り用クライアント。anonキーはRLSで公開readのみ許可されている。
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
