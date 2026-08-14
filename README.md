# バレエ観劇アプリ(仮)— フェーズ1

公演情報・キャスト・観劇記録 + LINE通知。仕様は `../画面遷移・データモデル仕様書_1.md`(v1.7)と `../schema_1.sql` を正とする。

## 現在の実装状況(実装ステップ1: 読み取り縦切り)

- ✅ S1 ホーム(今後の公演一覧)
- ✅ S2 公演一覧
- ✅ S3 公演詳細(演目・販売窓口・日別キャスト。is_published=false は非表示。キャスト名→S4遷移)
- ✅ S4 ダンサー一覧(バレエ団グルーピング+横断検索+ダンサー/団体フォロー+友だち追加バナー)
- ✅ S9 LINEログイン(OAuth2 + bot_prompt=aggressive。認証ガード: 操作をstateに保持し自動再実行)
- ✅ S10 計測リダイレクト(/go/[id]?src=web|line|share)
- ✅ 観劇ログ(S6 マイページ / S7 記録・編集)
- ✅ 管理画面(A2-0〜A2-4: 一覧・公演・公演回・キャスト・CSV取込)
- ✅ 通知バッチ(/api/cron/notify: キュー消化→LINE Pushダイジェスト。Vercel Cron JST 9:00/18:00)
- ✅ 友だち状態webhook(/api/line/webhook: follow/unfollowで is_line_friend を自動更新)

webhook設定: LINE Developers → Messaging APIチャネル → Messaging API設定 →
Webhook URL に `{本番URL}/api/line/webhook` を設定し「Webhookの利用」をON。

認証の設計: LINEログイン成功時に auth.users を admin API で作成し(email は `{lineUserId}@line.local` の合成値)、
セッションは自前の署名Cookie(SESSION_SECRET)。書き込みは全てサーバー(service role)経由で、RLSは直接アクセスへの防御層。
LINE未設定の間、フォロー操作は「準備中」の案内にフォールバックする。

## セットアップ(あなたの作業)

### 0. Node.js の導入(未導入のため必須)

https://nodejs.org から LTS(20以上)をインストール。`node -v` で確認。

### 1. Supabase プロジェクト作成

1. https://supabase.com でプロジェクト作成(リージョン: Tokyo 推奨)
2. ダッシュボードの **SQL Editor** に `supabase/migrations/20260719000001_init.sql` の中身を貼り付けて実行
3. 続けて `supabase/seed.sql` を実行(サンプルデータ。任意)
4. **Settings > API** から以下を控える:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY`(**絶対にクライアントに出さない**)

### 2. アプリ起動

```bash
cd ballet-app
cp .env.local.example .env.local   # 1.で控えた値を記入
npm install
npm run dev                        # http://localhost:3000
```

シード投入済みなら、ホームに『ジゼル』が表示され、詳細で販売窓口2件+日別キャスト(2回分入力済み・2回未発表)が見えれば成功。

### 3. LINE Developers の設定(フェーズ2の認証・通知で使用。先に作っておくと良い)

1. https://developers.line.biz でプロバイダー作成
2. **LINE Login チャネル**を作成
   - コールバックURL: `http://localhost:3000/auth/callback`(本番URLは後で追加)
   - チャネルID/シークレット → `.env.local` の `LINE_LOGIN_CHANNEL_*`
   - ※ログイン時の友だち追加オプション(bot_prompt)を使うため、下のMessaging APIチャネルと**同一プロバイダー**にすること
3. **Messaging API チャネル**を作成(公式アカウントが同時に作られる)
   - チャネルアクセストークン(長期)を発行 → `LINE_CHANNEL_ACCESS_TOKEN`
   - Webhook URL は通知実装時に設定(friend状態の追跡に使用)
4. LINE Login チャネルの「リンクされたボット」に 3. の公式アカウントを設定

### 4. Vercel デプロイ

1. GitHub にリポジトリを作成し、このディレクトリを push(`git add -A && git commit && git push`)
2. https://vercel.com で「Add New > Project」→ そのリポジトリを Import(設定はデフォルトのままでOK)
3. **Environment Variables** に `.env.local` と同じ値を登録(全キー。`NEXT_PUBLIC_SITE_URL` だけは本番URL `https://xxxx.vercel.app` に変える)
4. Deploy 後、LINE Login チャネルのコールバックURLに `https://xxxx.vercel.app/auth/callback` を**追加**(localhostも残してよい)

## ディレクトリ

```
app/                    # Next.js App Router(SSR)
  page.tsx              # S1 ホーム
  performances/         # S2 一覧 / S3 詳細
  dancers/              # S4 一覧
  go/[id]/route.ts      # S10 計測リダイレクト
lib/supabase.ts         # Supabaseクライアント
supabase/
  migrations/           # スキーマ(schema_1.sql と同一)
  seed.sql              # 動作確認用データ
```

## 設計メモ

- 公開ページは anon キー + RLS(公開read)で読む。書き込みは service role のみ
- 管理者判定は環境変数 `ADMIN_USER_IDS`(仕様書§3)
- 通知は全種別バッチ(9:00/18:00)。即時送信はしない(仕様書§6)
