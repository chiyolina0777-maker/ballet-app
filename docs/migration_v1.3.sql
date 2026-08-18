-- =====================================================================
-- Balletin Japan  migration v1.2 -> v1.3
-- =====================================================================
-- 背景: 新国立劇場 / 東京バレエ団(NBS) / Kバレエ トウキョウ の3団体を
--       実地調査した結果、v1.2 の前提が3点崩れたため、その修正を行う。
--
--   (1) キャストに「会員限定で発表済みだが公開不可」の状態が存在する
--       -> Kバレエ: FC先行時点のキャスト発表は K-BALLET FRIENDS 会員限定。
--          これを公開すると会員特典を毀損する。絶対に出力してはならない。
--   (2) 発売段階は公演単位ではなく「公演 x 会場」単位で変わる
--       -> Kバレエ / NBS のツアー公演は都市ごとに主催者・料金・発売日が別。
--   (3) 割引は「販売段階」の場合と「席種」の場合がある
--       -> NBS U25シートは独立した発売日を持つ(段階)。
--          Kバレエ学生券は一般発売と同時(席種)。
--
-- 適用順: 上から順に実行。すべて冪等 (if not exists / or replace) を意図。
-- =====================================================================


-- =====================================================================
-- 1. キャストの公開状態  ★本バージョンの中核
-- =====================================================================
-- v1.2 の casts.is_published (boolean) だけでは
-- 「未発表」と「会員限定で発表済み」を区別できなかった。
-- status を正とし、is_published は status から自動導出する派生値に降格する。
-- (既存の RLS ポリシー "public read casts" は is_published を参照しているため、
--  ポリシー側は変更せずに済む)

alter table casts
  add column if not exists status text not null default 'announced',
  add column if not exists publish_not_before timestamptz,
  add column if not exists source_type text,
  add column if not exists source_note text,
  add column if not exists as_of date,
  add column if not exists cast_group_label text;

comment on column casts.status is
  'tbd=未発表(誰も知らない) / member_only=会員限定発表済み(公開不可) / announced=公開済み / final=当日確定';
comment on column casts.publish_not_before is
  '公開解禁日時。member_only のキャストに解禁予定が判っている場合に設定する。';
comment on column casts.source_type is
  '情報の出所。監査用。member_site / member_email 由来は公開判断を必ず人が行う。';
comment on column casts.as_of is
  '「掲載キャスト予定は2026年6月12日現在」等の基準日。各団体が明記している。';
comment on column casts.cast_group_label is
  'NBS形式の「2/27, 3/1」等、原文の日付グループ表記を保持する。取込時は show 単位に展開したうえで併記する。';

alter table casts
  drop constraint if exists casts_status_check;
alter table casts
  add constraint casts_status_check
  check (status in ('tbd', 'member_only', 'announced', 'final'));

alter table casts
  drop constraint if exists casts_source_type_check;
alter table casts
  add constraint casts_source_type_check
  check (source_type is null or source_type in
    ('public_page', 'member_site', 'member_email', 'press', 'manual', 'other'));

-- 既存行の移行: is_published=true だったものは公開済みとみなす
update casts set status = 'announced' where is_published is true  and status = 'announced';
update casts set status = 'tbd'       where is_published is false and status = 'announced';


-- ---------------------------------------------------------------------
-- 1-2. is_published を status から自動導出する
-- ---------------------------------------------------------------------
-- これにより「status を member_only にしたのに画面に出てしまった」という
-- 事故が構造的に起きなくなる。アプリ側は is_published を信頼してよい。

create or replace function sync_cast_is_published()
returns trigger
language plpgsql
as $$
begin
  new.is_published :=
    new.status in ('announced', 'final')
    and (new.publish_not_before is null or new.publish_not_before <= now());
  return new;
end;
$$;

drop trigger if exists trg_sync_cast_is_published on casts;
create trigger trg_sync_cast_is_published
  before insert or update on casts
  for each row execute function sync_cast_is_published();

-- 既存行に反映
update casts set status = status;

-- 解禁時刻の経過を反映するバッチ。通知ワーカーと同じ周期で呼ぶ。
-- (publish_not_before を過ぎても誰も UPDATE しなければ is_published は false のまま)
create or replace function release_scheduled_casts()
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update casts
     set is_published = true
   where status in ('announced', 'final')
     and is_published = false
     and publish_not_before is not null
     and publish_not_before <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;


-- =====================================================================
-- 2. 会場（ツアー公演対応）
-- =====================================================================
-- v1.2 は performances.venue_id で単一会場を前提にしていた。
-- Kバレエ Spring Tour / Autumn Tour、NBS の地方公演では
-- 都市ごとに主催者・料金・発売日が異なるため中間テーブルを設ける。

create table if not exists performance_venues (
  id             uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  venue_id       uuid not null references venues(id),
  city_label     text,          -- 「[東京]」「[大阪]」など原文の表記
  starts_on      date,
  ends_on        date,
  presenter      text,          -- 主催 (例: TBS、日本舞台芸術振興会)
  ticket_url     text,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_performance_venues_performance
  on performance_venues(performance_id);

-- 既存 performances から1行ずつ backfill
insert into performance_venues (performance_id, venue_id, starts_on, ends_on, ticket_url)
select p.id, p.venue_id, p.starts_on, p.ends_on, p.ticket_url
  from performances p
 where p.venue_id is not null
   and not exists (
     select 1 from performance_venues pv where pv.performance_id = p.id
   );

-- 公演回を会場に紐づける
alter table shows
  add column if not exists performance_venue_id uuid references performance_venues(id);

update shows s
   set performance_venue_id = pv.id
  from performance_venues pv
 where pv.performance_id = s.performance_id
   and s.performance_venue_id is null;

-- 注: performances.venue_id は当面残す(既存クエリの互換のため)。
--     v1.4 で削除予定。新規コードは performance_venues を参照すること。


-- =====================================================================
-- 3. 会員組織マスタ / ユーザーの加入状況
-- =====================================================================
-- 会員先行の通知を、その会員組織に加入していないユーザーに送っても買えない。
-- 加入状況を持つことで通知精度を上げ、非会員には入会導線を出せる
-- (= バレエ団への送客になり、B2B提携の交渉材料になる)。

create table if not exists membership_orgs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id),
  name        text not null,                     -- クラブ・ジ・アトレ / K-BALLET FRIENDS
  short_name  text,
  is_paid     boolean not null default true,     -- 無料登録(新国メンバーズ)は false
  join_url    text,                              -- 入会導線
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists user_memberships (
  user_id            uuid not null references auth.users(id) on delete cascade,
  membership_org_id  uuid not null references membership_orgs(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (user_id, membership_org_id)
);

alter table user_memberships enable row level security;
drop policy if exists "own memberships" on user_memberships;
create policy "own memberships" on user_memberships
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table membership_orgs enable row level security;
drop policy if exists "public read membership_orgs" on membership_orgs;
create policy "public read membership_orgs" on membership_orgs
  for select using (true);


-- =====================================================================
-- 4. 発売段階の拡張
-- =====================================================================
-- (a) 会場単位の発売に対応  (b) 抽選型に対応  (c) 出所と公開可否を記録

alter table sale_stages
  add column if not exists performance_venue_id uuid references performance_venues(id),
  add column if not exists membership_org_id    uuid references membership_orgs(id),
  add column if not exists sale_type            text not null default 'first_come',
  add column if not exists result_announce_at   timestamptz,
  add column if not exists payment_opens_at     timestamptz,
  add column if not exists payment_closes_at    timestamptz,
  add column if not exists source_type          text,
  add column if not exists source_note          text,
  add column if not exists is_public_info       boolean not null default true,
  add column if not exists channel_note         text;

comment on column sale_stages.performance_venue_id is
  'ツアー公演で会場ごとに発売日が異なる場合に設定。null = 公演全体に適用。';
comment on column sale_stages.membership_org_id is
  '会員先行の場合、対象となる会員組織。通知の絞り込みと入会導線に使う。';
comment on column sale_stages.sale_type is
  'first_come=先着 / lottery=抽選。抽選は result_announce_at と payment_closes_at が締切通知の対象になる。';
comment on column sale_stages.is_public_info is
  'この段階の存在・日程を一般公開してよいか。会員メール等でのみ告知され、'
  '公開が不適切と判断した場合は false にする。false の行は通知にも画面にも出さない。';
comment on column sale_stages.channel_note is
  '購入窓口の制約(例: TBSチケット・チケットぴあWEBのみ受付)。';

alter table sale_stages
  drop constraint if exists sale_stages_sale_type_check;
alter table sale_stages
  add constraint sale_stages_sale_type_check
  check (sale_type in ('first_come', 'lottery'));

alter table sale_stages
  drop constraint if exists sale_stages_source_type_check;
alter table sale_stages
  add constraint sale_stages_source_type_check
  check (source_type is null or source_type in
    ('public_page', 'member_site', 'member_email', 'press', 'manual', 'other'));

-- 段階の表示順は日時と独立に持つ。
-- NBS では割引枠(U25シート)が一般発売の1.5か月「後」に開くため、
-- 「stage_type の番号順 = 時系列」という仮定は成立しない。
alter table sale_stages
  add column if not exists sort_order int not null default 0;


-- =====================================================================
-- 5. 席種
-- =====================================================================
-- 割引が席種として提供される場合(Kバレエ 学生券・A親子席)と、
-- 独立した発売日を持つ場合(NBS U25シート)の両方を表現する。
-- 後者は sale_stage_id を紐づける。

create table if not exists seat_types (
  id                   uuid primary key default gen_random_uuid(),
  performance_venue_id uuid not null references performance_venues(id) on delete cascade,
  name                 text not null,          -- S / A / 学生券 / A親子席 / U25シート
  price                int,                    -- 一般価格(税込)
  member_price         int,                    -- 会員価格(アトレ10%引・CAT10%引など)
  member_org_id        uuid references membership_orgs(id),
  is_discount          boolean not null default false,
  eligibility          text,                   -- 中学生以上25歳以下、5歳以上小6以下 など
  channel_note         text,                   -- 購入窓口の制約
  sale_stage_id        uuid references sale_stages(id),  -- 独立発売日を持つ席種のみ
  note                 text,                   -- 見切れ・特典等の補足
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);

create index if not exists idx_seat_types_performance_venue
  on seat_types(performance_venue_id);

-- 既知の未対応: Kバレエ K-BALLET SELECTION席のように、
-- 同一席種でも公演回によって特典内容が変わるケースがある
-- (7/19昼・7/20は「フォトカード付」、7/19夜のみ「手渡し」)。
-- 現状は note に文章で持つ。show 単位で分ける必要が出たら v1.4 で seat_type_shows を追加する。


-- =====================================================================
-- 6. 公演の付加属性
-- =====================================================================
-- 新国立劇場の「郵送申込シード権」対象公演フラグ。
-- 販売段階ではなく公演の属性(この公演を買うと翌シーズンの申込で優遇される)。

alter table performances
  add column if not exists counts_toward_seed_right boolean not null default false,
  add column if not exists seed_right_label text;

comment on column performances.seed_right_label is
  '例: 2027/2028シーズン バレエ&ダンス 郵送申込シード権';


-- =====================================================================
-- 7. ダンサーの外部識別子とゲスト対応
-- =====================================================================
-- 各団体がダンサー個別ページを持つが、slug の規則が統一されていない。
--   新国立: /dancer/list/okumura_kosuke.html  (姓_名, 小文字)
--   Kバレエ: /dancers/Masaya_Yamamoto.html    (名_姓, 先頭大文字)
-- 名寄せの安定キーとして (source_domain, external_slug) を持つ。

alter table dancers
  add column if not exists external_slug   text,
  add column if not exists source_domain   text,
  add column if not exists is_guest        boolean not null default false,
  add column if not exists affiliation_text text;

comment on column dancers.affiliation_text is
  'ゲスト出演者の所属を文字列で保持(例: パリ・オペラ座バレエ エトワール)。company_id で表せない団体に対応。';

create unique index if not exists uq_dancers_external
  on dancers(source_domain, external_slug)
  where external_slug is not null;


-- =====================================================================
-- 8. 通知トリガービューの更新
-- =====================================================================
-- v1.2 の upcoming_sale_triggers を置き換える。
--   - 抽選の当落発表・入金締切を追加
--   - is_public_info = false を除外
--   - 会場ラベルと会員組織を同梱(通知文の生成に使う)

drop view if exists upcoming_sale_triggers;
create view upcoming_sale_triggers as
with base as (
  select
    ss.id            as sale_stage_id,
    ss.performance_id,
    ss.performance_venue_id,
    ss.stage_type,
    ss.notify_category,
    ss.sale_type,
    ss.membership_org_id,
    ss.is_public_info,
    ss.opens_at,
    ss.closes_at,
    ss.result_announce_at,
    ss.payment_closes_at
  from sale_stages ss
  where ss.is_public_info is true
)
select b.sale_stage_id, b.performance_id, b.performance_venue_id,
       b.stage_type, b.notify_category, b.sale_type, b.membership_org_id,
       t.trigger_kind, t.trigger_at
from base b
cross join lateral (
  values
    ('open',          b.opens_at),
    ('close',         b.closes_at),
    ('result',        b.result_announce_at),
    ('payment_close', b.payment_closes_at)
) as t(trigger_kind, trigger_at)
where t.trigger_at is not null;

comment on view upcoming_sale_triggers is
  '通知ワーカー用。発売開始・申込締切・当落発表・入金締切を1行ずつに展開する。'
  'closes_at に時刻が明記されない団体があるため(例: 新国立「8月10日(月)」)、'
  '取込時は終日=23:59として保持し、通知は前日と当日朝の2回を推奨。';


-- =====================================================================
-- 9. RLS(新規テーブル)
-- =====================================================================

alter table performance_venues enable row level security;
drop policy if exists "public read performance_venues" on performance_venues;
create policy "public read performance_venues" on performance_venues
  for select using (true);

alter table seat_types enable row level security;
drop policy if exists "public read seat_types" on seat_types;
create policy "public read seat_types" on seat_types
  for select using (true);

-- sale_stages は非公開情報を含みうるため、公開読み取りを絞る
drop policy if exists "public read sale_stages" on sale_stages;
create policy "public read sale_stages" on sale_stages
  for select using (is_public_info is true);


-- =====================================================================
-- 10. 監視用ビュー(運用チェック)
-- =====================================================================
-- 事故検知用。本来 0 件であるべき。管理画面のダッシュボードに出す。

create or replace view qa_leaked_member_only_casts as
select c.id, c.show_id, c.status, c.is_published, c.source_type
  from casts c
 where c.status in ('tbd', 'member_only')
   and c.is_published is true;

comment on view qa_leaked_member_only_casts is
  '会員限定/未発表のキャストが公開状態になっていないかの検査。常に0件であること。';

-- 解禁待ちのキャスト一覧(手動運用の可視化)
create or replace view pending_cast_releases as
select c.id, c.show_id, c.status, c.publish_not_before, c.source_type, c.source_note
  from casts c
 where c.status = 'member_only'
 order by c.publish_not_before nulls last;
