-- =====================================================================
-- Balletin Japan  bridge migration: 現行スキーマ(v1.7系) -> v1.3
-- =====================================================================
-- v1.2系migrationが現存しないため、docs/migration_v1.3.sql と
-- docs/画面遷移・データモデル仕様書_v1.3追補.md から逆算して作成。
-- すべて冪等(if not exists / or replace)。上から順に実行。
--
-- v1.3原典からの適応(2026-08-18 ユーザー決定):
--   * casts.status は現行の出演状態(scheduled/changed/cancelled)を維持し、
--     v1.3の公開状態は別列 publication_status として追加する。
--     (v1.3原典は status を公開状態に転用するが、変更/降板の現行仕様を残すため)
--   * 通知の有料/無料区分(追補§7.2)はフェーズ1では実装しない(全員送信)
-- =====================================================================


-- =====================================================================
-- 1. 会場(ツアー公演対応): performance_venues
-- =====================================================================
create table if not exists performance_venues (
  id             uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  venue_id       uuid not null references venues(id),
  city_label     text,
  starts_on      date,
  ends_on        date,
  presenter      text,
  ticket_url     text,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_performance_venues_performance
  on performance_venues(performance_id);

insert into performance_venues (performance_id, venue_id, starts_on, ends_on, ticket_url)
select p.id, p.venue_id, p.starts_on, p.ends_on, p.ticket_url
  from performances p
 where p.venue_id is not null
   and not exists (select 1 from performance_venues pv where pv.performance_id = p.id);

alter table shows
  add column if not exists performance_venue_id uuid references performance_venues(id);
update shows s
   set performance_venue_id = pv.id
  from performance_venues pv
 where pv.performance_id = s.performance_id
   and s.performance_venue_id is null;

-- 注: performances.venue_id は互換のため残置。新規コードは performance_venues を参照。v1.4で削除。


-- =====================================================================
-- 2. 会員組織 / ユーザー加入状況
-- =====================================================================
create table if not exists membership_orgs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id),
  name        text not null,
  short_name  text,
  is_paid     boolean not null default true,
  join_url    text,
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

-- 既知の会員組織(追補§4.1の実地調査分。固定UUIDで冪等)
insert into membership_orgs (id, company_id, name, short_name, is_paid, sort_order) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000001', 'クラブ・ジ・アトレ', 'アトレ', true, 1),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000001', '新国立劇場メンバーズ', '新国メンバーズ', false, 2),
  ('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000002', 'CAT会員', 'CAT', true, 1),
  ('00000000-0000-0000-0000-000000000064', '00000000-0000-0000-0000-000000000002', 'NBS WEB会員', 'NBS WEB', false, 2)
on conflict (id) do nothing;


-- =====================================================================
-- 3. 発売段階: sale_stages(v1.2相当を逆算新設 + v1.3拡張を同梱)
-- =====================================================================
create table if not exists sale_stages (
  id                   uuid primary key default gen_random_uuid(),
  performance_id       uuid not null references performances(id) on delete cascade,
  stage_type           text not null default 's4_general',
  notify_category      text not null default 'general',
  label                text,
  opens_at             timestamptz,
  closes_at            timestamptz,
  performance_venue_id uuid references performance_venues(id),
  membership_org_id    uuid references membership_orgs(id),
  sale_type            text not null default 'first_come',
  result_announce_at   timestamptz,
  payment_opens_at     timestamptz,
  payment_closes_at    timestamptz,
  source_type          text,
  source_note          text,
  is_public_info       boolean not null default true,
  channel_note         text,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);
create index if not exists idx_sale_stages_performance on sale_stages(performance_id);
create index if not exists idx_sale_stages_opens on sale_stages(opens_at);
create index if not exists idx_sale_stages_closes on sale_stages(closes_at);

alter table sale_stages drop constraint if exists sale_stages_stage_type_check;
alter table sale_stages add constraint sale_stages_stage_type_check
  check (stage_type in ('s1_fastest','s2_member','s3_free','s4_general','s5_discount'));
alter table sale_stages drop constraint if exists sale_stages_notify_category_check;
alter table sale_stages add constraint sale_stages_notify_category_check
  check (notify_category in ('presale','general','discount'));
alter table sale_stages drop constraint if exists sale_stages_sale_type_check;
alter table sale_stages add constraint sale_stages_sale_type_check
  check (sale_type in ('first_come','lottery'));
alter table sale_stages drop constraint if exists sale_stages_source_type_check;
alter table sale_stages add constraint sale_stages_source_type_check
  check (source_type is null or source_type in
    ('public_page','member_site','member_email','press','manual','other'));

comment on column sale_stages.is_public_info is
  'この段階の存在・日程を一般公開してよいか。falseの行は通知にも画面にも出さない(service_role経路でも自前で除外)。';

-- RLS: 非公開情報を含みうるため公開readを絞る
alter table sale_stages enable row level security;
drop policy if exists "public read sale_stages" on sale_stages;
create policy "public read sale_stages" on sale_stages
  for select using (is_public_info is true);

-- ticket_sales からのデータ移行(label のヒューリスティックで段階を推定)
insert into sale_stages (performance_id, stage_type, notify_category, label, opens_at, source_type)
select ts.performance_id,
       case when coalesce(ts.label,'') like '%先行%' then 's2_member' else 's4_general' end,
       case when coalesce(ts.label,'') like '%先行%' then 'presale'   else 'general' end,
       coalesce(nullif(ts.label,''), '一般発売'),
       ts.sale_starts_at,
       'public_page'
  from ticket_sales ts
 where not exists (
   select 1 from sale_stages ss
    where ss.performance_id = ts.performance_id
      and ss.opens_at = ts.sale_starts_at
      and ss.label = coalesce(nullif(ts.label,''), '一般発売')
 );

comment on table ticket_sales is
  '[非推奨 v1.3] sale_stages へ移行済み。互換のため残置。新規コードは参照しないこと。v1.4で削除予定。';


-- =====================================================================
-- 4. 席種: seat_types
-- =====================================================================
create table if not exists seat_types (
  id                   uuid primary key default gen_random_uuid(),
  performance_venue_id uuid not null references performance_venues(id) on delete cascade,
  name                 text not null,
  price                int,
  member_price         int,
  member_org_id        uuid references membership_orgs(id),
  is_discount          boolean not null default false,
  eligibility          text,
  channel_note         text,
  sale_stage_id        uuid references sale_stages(id),
  note                 text,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);
create index if not exists idx_seat_types_performance_venue
  on seat_types(performance_venue_id);

alter table seat_types enable row level security;
drop policy if exists "public read seat_types" on seat_types;
create policy "public read seat_types" on seat_types
  for select using (true);

alter table performance_venues enable row level security;
drop policy if exists "public read performance_venues" on performance_venues;
create policy "public read performance_venues" on performance_venues
  for select using (true);


-- =====================================================================
-- 5. キャストの公開状態 ★中核
-- =====================================================================
-- 適応: v1.3原典は casts.status を転用するが、現行の出演状態
-- (scheduled/changed/cancelled)を維持するため publication_status を新設。
alter table casts
  add column if not exists publication_status text not null default 'tbd',
  add column if not exists publish_not_before timestamptz,
  add column if not exists source_type text,
  add column if not exists source_note text,
  add column if not exists as_of date,
  add column if not exists cast_group_label text;

comment on column casts.publication_status is
  'tbd=未発表(誰も知らない) / member_only=会員限定発表済み(公開不可) / announced=公開済み / final=当日確定。is_published はここから自動導出される派生値。直接更新しない。';
comment on column casts.status is
  '出演状態: scheduled / changed / cancelled(現行仕様を維持)。公開可否の判定には使わない。';

alter table casts drop constraint if exists casts_publication_status_check;
alter table casts add constraint casts_publication_status_check
  check (publication_status in ('tbd','member_only','announced','final'));
alter table casts drop constraint if exists casts_source_type_check;
alter table casts add constraint casts_source_type_check
  check (source_type is null or source_type in
    ('public_page','member_site','member_email','press','manual','other'));

-- 既存行の移行: is_published=true は公開済み、false は未発表とみなす
update casts set publication_status = 'announced' where is_published is true  and publication_status = 'tbd';

-- is_published を publication_status から自動導出(直接UPDATEを構造的に無効化)
create or replace function sync_cast_is_published()
returns trigger
language plpgsql
as $$
begin
  new.is_published :=
    new.publication_status in ('announced','final')
    and (new.publish_not_before is null or new.publish_not_before <= now());
  return new;
end;
$$;

drop trigger if exists trg_sync_cast_is_published on casts;
create trigger trg_sync_cast_is_published
  before insert or update on casts
  for each row execute function sync_cast_is_published();

-- 既存行にトリガーを適用
update casts set publication_status = publication_status;

-- 解禁時刻の経過を反映するバッチ関数。通知ワーカーと同一周期で呼ぶ
create or replace function release_scheduled_casts()
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update casts
     set is_published = true
   where publication_status in ('announced','final')
     and is_published = false
     and publish_not_before is not null
     and publish_not_before <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;


-- =====================================================================
-- 6. 公演の付加属性 / 団体の発売段階テンプレート
-- =====================================================================
alter table performances
  add column if not exists counts_toward_seed_right boolean not null default false,
  add column if not exists seed_right_label text;

alter table companies
  add column if not exists sale_stage_names jsonb;
comment on column companies.sale_stage_names is
  '団体で使う発売段階のテンプレート(追補§4.1)。定義済みの段階のみ管理画面で選択可能。';

update companies set sale_stage_names =
  '{"s1_fastest":"郵送申込(シード権優先)","s2_member":"アトレ会員先行","s3_free":"新国メンバーズ先行","s4_general":"一般発売"}'::jsonb
 where id = '00000000-0000-0000-0000-000000000001' and sale_stage_names is null;
update companies set sale_stage_names =
  '{"s2_member":"CAT会員WEB先行","s3_free":"NBS WEBチケット先行","s4_general":"一般発売","s5_discount":"親子割引 / U25・U39シート"}'::jsonb
 where id = '00000000-0000-0000-0000-000000000002' and sale_stage_names is null;


-- =====================================================================
-- 7. ダンサーの外部識別子とゲスト対応
-- =====================================================================
alter table dancers
  add column if not exists external_slug    text,
  add column if not exists source_domain    text,
  add column if not exists is_guest         boolean not null default false,
  add column if not exists affiliation_text text;

create unique index if not exists uq_dancers_external
  on dancers(source_domain, external_slug)
  where external_slug is not null;


-- =====================================================================
-- 8. 通知トリガービュー(4種展開・非公開除外)
-- =====================================================================
drop view if exists upcoming_sale_triggers;
create view upcoming_sale_triggers as
with base as (
  select ss.id as sale_stage_id, ss.performance_id, ss.performance_venue_id,
         ss.stage_type, ss.notify_category, ss.sale_type, ss.membership_org_id,
         ss.label, ss.channel_note,
         ss.opens_at, ss.closes_at, ss.result_announce_at, ss.payment_closes_at
    from sale_stages ss
   where ss.is_public_info is true
)
select b.sale_stage_id, b.performance_id, b.performance_venue_id,
       b.stage_type, b.notify_category, b.sale_type, b.membership_org_id,
       b.label, b.channel_note,
       t.trigger_kind, t.trigger_at
  from base b
 cross join lateral (
   values ('open',          b.opens_at),
          ('close',         b.closes_at),
          ('result',        b.result_announce_at),
          ('payment_close', b.payment_closes_at)
 ) as t(trigger_kind, trigger_at)
 where t.trigger_at is not null;


-- =====================================================================
-- 9. 通知の重複防止(sale_stage 単位)
-- =====================================================================
alter table notifications
  add column if not exists sale_stage_id uuid references sale_stages(id) on delete cascade;
create unique index if not exists uq_notifications_sale_stage
  on notifications(user_id, kind, sale_stage_id)
  where sale_stage_id is not null;

alter table notification_queue
  add column if not exists sale_stage_id uuid references sale_stages(id) on delete cascade;


-- =====================================================================
-- 10. 監視用ビュー
-- =====================================================================
create or replace view qa_leaked_member_only_casts as
select c.id, c.show_id, c.publication_status, c.is_published, c.source_type
  from casts c
 where c.publication_status in ('tbd','member_only')
   and c.is_published is true;

create or replace view pending_cast_releases as
select c.id, c.show_id, c.publication_status, c.publish_not_before, c.source_type, c.source_note
  from casts c
 where c.publication_status = 'member_only'
 order by c.publish_not_before nulls last;
