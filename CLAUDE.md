# バレエ観劇アプリ(仮)— フェーズ1

バレエファン向けの公演情報・キャスト通知・観劇記録サービス。**フェーズ1は全機能が本番稼働済み。**

- 本番: https://ballet-app-six.vercel.app
- リポジトリ: https://github.com/chiyolina0777-maker/ballet-app (mainへのpushでVercelが自動デプロイ)
- スタック: Next.js 15 (App Router, SSR) + Supabase (DB/RLS) + Vercel (Hosting/Cron) + LINE (Login / Messaging API)

## 正となるドキュメント

- 仕様書: `docs/画面遷移・データモデル仕様書.md`(v1.7)+ `docs/画面遷移・データモデル仕様書_v1.3追補.md` — 画面・遷移・通知ルールの正
- スキーマ: `supabase/migrations/` が正(全5本。0001〜0003は適用済み。**0004(v1.3ブリッジ)と0005(JST補正+RLS強化)はユーザーがSQL Editorで適用すること — v1.3アプリコードのデプロイ前に必須**)
- 画面モック: `docs/` 内のHTML3枚(管理画面 / S3公演詳細 / S4ダンサー一覧)。実装済みだが文言・挙動の参照用

## アーキテクチャの要点

- **認証**: LINEログイン(OAuth2)のみ。Supabase Authのセッションは使わず、`auth.users` はadmin APIで作成し(email=`{lineUserId}@line.local`)、セッションは自前の署名Cookie(`lib/session.ts`, SESSION_SECRET)
- **書き込みは全てサーバー経由**(service role)。RLSは直接アクセスへの防御層。クライアントからのDB書き込みはしない
- **管理者判定**: 環境変数 `ADMIN_USER_IDS`(カンマ区切りUUID)。`is_admin`カラムは使わない(仕様書§3)
- **演目**: `performance_works`(多対多・上演順)。ミックスビル対応。キャスト行への演目紐付けはしない(役名の自由記述「ボレロ: メロディ」で運用)
- **チケット販売**: `sale_stages`(v1.3)。5段階モデル(s1〜s5)+先着/抽選(抽選は申込締切・当落・入金締切も通知)。団体ごとに使う段階は `companies.sale_stage_names` テンプレートで制限。`ticket_sales` は非推奨(互換残置、v1.4で削除)
- **キャスト公開状態**(v1.3の中核): `casts.publication_status`(tbd/member_only/announced/final)。`is_published` はDBトリガーが導出する派生値で直接更新しない。**member_only(会員限定発表)はいかなる出力面にも出さない**(通知・画面・anon API。RLSも is_published=true に制限済み)。`publish_not_before` 経過後はバッチが自動公開+通知
- **会場**: `performance_venues`(公演×会場。ツアー対応)。`performances.venue_id` は互換残置。席種は `seat_types`(管理UIなし。Supabase Studioで登録)
- **会員組織**: `membership_orgs` / `user_memberships`(S6で設定)。会員先行通知は加入者+未設定ユーザーに送る(設定済みで非加入なら送らない)
- **日時の扱い**: DBは timestamptz。書き込みは `+09:00` 付き(`lib/jst.ts` 参照)、表示は必ず `timeZone: 'Asia/Tokyo'` 指定(サーバーはUTC)。datetime-local の生文字列を直接保存しない

## 通知の設計(壊すと誤配信につながるので注意)

- **全種別バッチ送信**(即時送信はしない)。A2-3の「保存」= 実公開時のみ `notification_queue` への登録
- バッチ: `/api/cron/notify`(CRON_SECRET保護)を Vercel Cron が **UTC 0:00/9:00 = JST 9:00/18:00** に実行
  1. `release_scheduled_casts()` で解禁時刻経過キャストを公開し、show単位でキュー投入
  2. 27時間以内の発売トリガー(`upcoming_sale_triggers`: open/close/result/payment_close の4種)を自動キュー投入
  3. キュー消化 → 宛先計算 → **1ユーザー1通のダイジェスト**でPush
- 宛先: キャスト系=該当ダンサーのフォロワーのみ / 発売=主催バレエ団フォロワー∪出演ダンサーフォロワー(distinct)。会員先行(s1〜s3で membership_org 指定あり)は加入状況でさらに絞る
- 送信前フィルタ: `is_line_friend=true` かつ `notify_cast/notify_sale=true`
- **通知テンプレートは `is_published=true` のキャストのみ参照**(§7.3。publication_status を直接見ない)。発売通知はキャストに触れない(§7.2)
- **二重送信防止**: `notifications` のunique制約(挿入できた行にのみ送信)。発売系は `(user_id, kind, sale_stage_id)`。テストでキュー行を作ったら必ず掃除すること
- 友だち状態: `/api/line/webhook`(follow/unfollow)で自動更新
- **漏洩監視**: `qa_leaked_member_only_casts` は常に0件(管理画面トップに常時表示)。1件でも出たら通知送信を停止して調査

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

- **migration 0004・0005 の適用**(ユーザー作業。v1.3アプリコードをmainにマージ/デプロイする前に必須。順に実行)
- v1.3のうち未実装: 席種(seat_types)の管理UI(Studioで登録)/ キャスト変更のハッシュ差分検知(§2.5)/ 団体別パーサ(§9)/ 通知の有料無料区分(§7.2、フェーズ1では全員送信と決定済み)
- S6の共有用画像生成(年間まとめ)— 仕様にあるが未実装(ユーザー判断で保留中)
- 東京バレエ団ダンサー12名の name_kana / rank が空(正確性優先で未入力。Supabase Studioで補完可)
- クローズドβ(知人招待)、Supabase Pro移行判断
