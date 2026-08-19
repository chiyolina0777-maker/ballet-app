import './globals.css';
import SiteHeader from './site-header';

export const metadata = {
  title: 'バレエ観劇アプリ(仮)',
  description: 'バレエ公演のキャスト情報と観劇記録',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
