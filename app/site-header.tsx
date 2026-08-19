'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 管理画面(/admin)では管理専用メニューのみを、公開ページと別配色で表示する
export default function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const isAdmin = pathname.startsWith('/admin');

  if (isAdmin) {
    return (
      <header className="site-head admin">
        <h1>🛠 管理画面 — バレエ観劇アプリ(仮)</h1>
        <nav>
          <Link href="/admin/performances">公演一覧</Link>
          <Link href="/admin/performances/new">+ 新規公演</Link>
          <Link href="/admin/dancers">ダンサー</Link>
          <Link href="/admin/import">CSV取込</Link>
          <Link href="/">← 公開サイト</Link>
        </nav>
      </header>
    );
  }

  return (
    <header className="site-head">
      <h1>バレエ観劇アプリ(仮)</h1>
      <nav>
        <Link href="/">ホーム</Link>
        <Link href="/performances">公演</Link>
        <Link href="/dancers">ダンサー</Link>
        <Link href="/me">マイページ</Link>
      </nav>
    </header>
  );
}
