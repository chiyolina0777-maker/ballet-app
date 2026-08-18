# バレエ観劇アプリ(仮)— フェーズ1

バレエファン向けの公演情報・キャスト通知・観劇記録サービス。**フェーズ1は全機能が本番稼働済み。**

- 本番: https://ballet-app-six.vercel.app
- リポジトリ: https://github.com/chiyolina0777-maker/ballet-app (mainへのpushでVercelが自動デプロイ)
- スタック: Next.js 15 (App Router, SSR) + Supabase (DB/RLS) + Vercel (Hosting/Cron) + LINE (Login / Messaging API)

## 正となるドキュメント

- 仕様書: `docs/画面遷移・データモデル仕様書.md`(v1.7)— 画面・遷移・通知ルールの正
- スキーマ: `supabase/migrations/` が正(3本すべて適用済み。`docs/schema_1.sql` は初版のスナップショットで、0002/0003の分は含まない)
- 画面モック: `docs/` 内のHTML3枚(管理画面 / S3公演詳細 / S4ダンサー一覧)。実装済みだが文言・挙動の参照用

## アーキテクチャの要点

- **認証**: LINEログイン(OAuth2)のみ。Supabase Authのセッションは使わず、`auth.users` はadmin APIで作成し(email=`{lineUserId}@line.local`)、セッションは自前の署名Cookie(`lib/session.ts`, SESSION_SECRET)
- **書き込みは全てサーバー経由**(service role)。RLSは直接アクセスへの防御層。クライアントからのDB書き込みはしない
- **管理者判定**: 環境変数 `ADMIN_USER_IDS`(カンマ区切りUUID)。`is_admin`カラムは使わない(仕様書§3)
- **演目**: `performance_works`(多対多・上演順)。ミックスビル対応。キャスト行への演目紐付けはしない(役名の自由記述「ボレロ: メロディ」で運用)
- **チケット販売**: `ticket_sales`(公演1:N。会員先行/一般など複数窓口)

## 通知の設計(壊すと誤配信につながるので注意)

- **全種別バッチ送信**(即時送信はしない)。A2-3の「保存して通知」= `notification_queue` への登録のみ
- バッチ: `/api/cron/notify`(CRON_SECRET保護)を Vercel Cron が **UTC 0:00/9:00 = JST 9:00/18:00** に実行
  - 発売前日の `ticket_sales` を自動キュー投入 → キュー消化 → 宛先計算 → **1ユーザー1通のダイジェスト**でPush
- 宛先: キャスト系=該当ダンサーのフォロワーのみ / 発売=主催バレエ団フォロワー∪出演ダンサーフォロワー(distinct)
- 送信前フィルタ: `is_line_friend=true` かつ `notify_cast/notify_sale=true`
- **二重送信防止**: `notifications` のunique制約(挿入できた行にのみ送信)。テストでキュー行を作ったら必ず掃除すること
- 友だち状態: `/api/line/webhook`(follow/unfollow)で自動更新

## 運用ルール

- キャスト情報は必ず**公式発表に基づき、出典URL必須**。CSV取込・下書き(`is_published=false`)は公演ページに表示されず通知もされない。公開はA2-3の二段確認から
- **秘密鍵・トークンは絶対にチャットに貼らない/貼らせない**(過去に漏洩→全ローテーション済み)。値の確認はユーザー自身の画面で
- スキーマ変更は `supabase/migrations/` にファイルを追加し、ユーザーがSupabase StudioのSQL Editorで実行する(CLI/自動適用なし)
- Supabase無料プランは**1週間無アクセスで自動停止**(本番も止まる)。実運用開始時はPro移行

## 環境変数(名前のみ。値はローカル `.env.local` とVercelに設定済み)

`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` /
`ADMIN_USER_IDS` / `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` /
`LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `LINE_FRIEND_URL` /
`SESSION_SECRET` / `CRON_SECRET` / `NEXT_PUBLIC_SITE_URL`

注: SupabaseのURLは末尾に `/rest/v1` を付けない。クラウドセッションには秘密値がないため、動作確認は本番URLへのcurl(公開ページ)か、ユーザーに依頼する

## 検証の作法(このリポジトリでの通例)

- `npm run build` を通してから動作確認。公開ページは curl でSSR出力を確認(ReactのSSRは `<!-- -->` をテキストに挟むので、文字列一致検証時は除去する)
- 管理APIのテストは SESSION_SECRET で署名したセッションCookie(uid=ADMIN_USER_IDS)を作って叩ける(ローカルのみ)
- テストデータは必ず掃除する。特に `notification_queue` と `notifications`(掃除しないと実際にLINE通知が飛ぶ)。click_events が公演削除をFKで塞ぐことがある(先にログ削除)

## 未完了タスク

- 新国立劇場の公演データ入力(公式サイトがbot遮断=403のため自動取得不可。管理画面から手入力)
- S6の共有用画像生成(年間まとめ)— 仕様にあるが未実装
- 東京バレエ団ダンサー12名の name_kana / rank が空(正確性優先で未入力。Supabase Studioで補完可)
- クローズドβ(知人招待)、Supabase Pro移行判断
