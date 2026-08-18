-- バレエ観劇ファン向けアプリ フェーズ1 スキーマ (Supabase / PostgreSQL)
-- 構造: 公演 performances → 公演回 shows → キャスト casts が核。
-- 書き込みは管理者(service role)のみ、閲覧は公開、個人データはRLSで本人限定。

-- ============ マスタ ============

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,                -- 例: 新国立劇場バレエ団
  official_url text,
  created_at timestamptz not null default now()
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,                -- 例: 東京文化会館 大ホール
  prefecture text
);

create table works (
  id uuid primary key default gen_random_uuid(),
  title text not null                -- 例: ジゼル(演目マスタ。集計や検索に使う)
);

create table dancers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_kana text,                    -- 検索用
  company_id uuid references companies(id),
  rank text,                         -- 例: プリンシパル
  profile_url text
);

-- ============ 公演の三層構造 ============

create table performances (
  id uuid primary key default gen_random_uuid(),
  title text not null,               -- 公演名(演目名とは別に持つ)
  company_id uuid references companies(id),
  venue_id uuid references venues(id),
  starts_on date,
  ends_on date,
  sale_starts_at timestamptz,        -- 一般発売開始(後方互換のため残置。発売通知のトリガーは ticket_sales を正とする)
  ticket_url text,                   -- 計測リダイレクトの飛び先
  status text not null default 'announced',  -- announced / on_sale / finished / cancelled
  source_url text,                   -- 情報の出どころ(公式発表URL)。信頼性の担保
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 公演と演目の紐付け(1公演に複数演目: トリプル・ビル、ガラ等に対応)
-- キャスト行への演目紐付けは行わない(役名の自由記述「ボレロ: メロディ」等で運用)
create table performance_works (
  performance_id uuid not null references performances(id) on delete cascade,
  work_id uuid not null references works(id),
  sort_order int not null default 0,   -- 上演順
  primary key (performance_id, work_id)
);

-- チケット販売窓口(会員先行・一般発売など、1公演に複数)
create table ticket_sales (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  label text,                        -- 例: 会員先行 / 一般発売(NULL・空は「一般発売」扱い)
  sale_starts_at timestamptz not null,  -- 発売通知はこの各行の前日9:00に送信
  created_at timestamptz not null default now()
);

create table shows (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  starts_at timestamptz not null,    -- マチネ/ソワレは時刻で判別
  note text
);

create table casts (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  dancer_id uuid not null references dancers(id),
  role_name text not null,           -- 例: ジゼル、アルブレヒト
  status text not null default 'scheduled',  -- scheduled / changed / cancelled
  announced_at timestamptz default now(),
  source_url text,
  is_published boolean not null default true,  -- false=下書き(A2-3の下書き保存・A2-4のCSV取込)。公演ページに表示しない
  unique (show_id, dancer_id, role_name)
);

-- ============ ユーザー・フォロー・記録 ============

-- Supabase Auth (LINEログイン) のユーザーに1:1で紐づくプロフィール
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  line_user_id text unique,          -- LINE Push Messageの宛先
  notify_cast boolean not null default true,
  notify_sale boolean not null default true,
  is_line_friend boolean not null default false,  -- 公式アカウント友だち状態(webhookのfollow/unfollowで更新。通知バッチはtrueのみに送信)
  created_at timestamptz not null default now()
);

create table follows (
  user_id uuid not null references profiles(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, dancer_id)
);

-- バレエ団フォロー(発売通知の宛先。キャスト未発表の公演でも通知を届けるため)
create table company_follows (
  user_id uuid not null references profiles(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create table theater_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  show_id uuid not null references shows(id),
  seat text,
  memo text,
  is_public boolean not null default false,   -- デフォルト非公開
  created_at timestamptz not null default now(),
  unique (user_id, show_id)
);

-- ============ 通知・計測 ============

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,                -- cast_announced / cast_changed / sale_start
  show_id uuid references shows(id),
  performance_id uuid references performances(id),
  ticket_sale_id uuid references ticket_sales(id) on delete cascade,  -- 発売通知(sale_start)用。窓口削除時は履歴も削除
  sent_at timestamptz not null default now(),
  unique (user_id, kind, show_id),          -- キャスト系通知の二重送信防止(show起点)
  unique (user_id, kind, ticket_sale_id)    -- 発売通知の二重送信防止(販売窓口起点。show_idはNULL)
);

create table click_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),      -- 未ログインはnull
  performance_id uuid not null references performances(id),
  source text,                       -- line / web / share(S10の src クエリと同一の値)
  clicked_at timestamptz not null default now()
);

-- ============ インデックス ============

create index idx_shows_performance on shows (performance_id);
create index idx_ticket_sales_performance on ticket_sales (performance_id);
create index idx_performance_works_work on performance_works (work_id);  -- 演目→公演の検索用(フェーズ2)
create index idx_ticket_sales_starts on ticket_sales (sale_starts_at);  -- Cronの当日抽出用
create index idx_casts_show on casts (show_id);
create index idx_casts_dancer on casts (dancer_id);
create index idx_follows_dancer on follows (dancer_id);
create index idx_company_follows_company on company_follows (company_id);
create index idx_dancers_company on dancers (company_id);  -- S4のバレエ団別グルーピング表示用
create index idx_clicks_performance on click_events (performance_id);

-- ============ RLS(行レベルセキュリティ) ============

alter table profiles enable row level security;
create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

alter table follows enable row level security;
create policy "own follows" on follows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table company_follows enable row level security;
create policy "own company follows" on company_follows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table theater_logs enable row level security;
create policy "own logs" on theater_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 公演系マスタは全員が閲覧可、書き込みはservice role(管理画面)のみ
alter table performances enable row level security;
create policy "public read performances" on performances for select using (true);
alter table shows enable row level security;
create policy "public read shows" on shows for select using (true);
alter table casts enable row level security;
create policy "public read casts" on casts for select using (true);
alter table dancers enable row level security;
create policy "public read dancers" on dancers for select using (true);
alter table companies enable row level security;
create policy "public read companies" on companies for select using (true);
alter table venues enable row level security;
create policy "public read venues" on venues for select using (true);
alter table works enable row level security;
create policy "public read works" on works for select using (true);
alter table ticket_sales enable row level security;
create policy "public read ticket_sales" on ticket_sales for select using (true);
alter table performance_works enable row level security;
create policy "public read performance_works" on performance_works for select using (true);

-- 通知・計測はクライアントから読み書きさせない(RLS有効・ポリシーなし = service roleのみ)
-- click_events のINSERTはS10のサーバー側リダイレクト処理で行う
alter table notifications enable row level security;
alter table click_events enable row level security;
