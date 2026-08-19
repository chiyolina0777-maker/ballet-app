import { getAdminSession } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// メニューは SiteHeader(/admin では管理専用表示)に集約。ここでは権限ガードのみ
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSession();
  if (!admin) {
    return (
      <div className="notice">
        管理者権限がありません。LINEでログインの上、あなたのユーザーIDが環境変数 ADMIN_USER_IDS に登録されている必要があります。
        <div style={{ marginTop: 10 }}>
          <a className="btnlink" href="/auth/line?redirect_to=/admin/performances">LINEでログイン</a>
        </div>
      </div>
    );
  }
  return <div>{children}</div>;
}
