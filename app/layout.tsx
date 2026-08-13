import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'バレエ観劇アプリ(仮)',
  description: 'バレエ公演のキャスト情報と観劇記録',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="site-head">
          <h1>バレエ観劇アプリ(仮)</h1>
          <nav>
            <Link href="/">ホーム</Link>
            <Link href="/performances">公演</Link>
            <Link href="/dancers">ダンサー</Link>
            <Link href="/">マイページ</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
