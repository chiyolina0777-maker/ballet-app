import Link from 'next/link';
import { getAdminSession } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSession();
  if (!admin) {
    return (
      <div className="notice">
        管理者権限がありません。LINEでログインの上、あなたのユーザーIDが環境変数 ADMIN_USER_IDS に登録されている必要があります。
        <div style={{ marginTop: 8 }}>
          <a href="/auth/line?redirect_to=/admin/performances">LINEでログイン</a>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="admin-bar">
        <strong>管理</strong>
        <Link href="/admin/performances">公演一覧</Link>
        <Link href="/admin/performances/new">+ 新規公演</Link>
        <Link href="/admin/import">CSV取込</Link>
        <Link href="/">← 公開サイト</Link>
      </div>
      {children}
    </div>
  );
}
