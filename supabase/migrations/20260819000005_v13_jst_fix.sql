-- =====================================================================
-- v1.3補正: ticket_sales から sale_stages へ移行した行の時刻ズレ修正
-- =====================================================================
-- 旧管理画面(A2-1)は datetime-local の値(JST意図)をタイムゾーン情報なしで
-- 保存していたため、Postgres側でUTCとして解釈され、実時刻より9時間未来に
-- ずれて格納されている。JSTの正しい時刻(-9時間)に補正する。
--
-- ticket_sales の元の値と一致する行のみを補正するため冪等
-- (補正後は一致しなくなり、2回実行しても二重にずれない)。
-- v1.3アプリ(発売段階の管理UI)はオフセット付きで保存するため、新規行は対象外。

update sale_stages ss
   set opens_at = ss.opens_at - interval '9 hours'
  from ticket_sales ts
 where ts.performance_id = ss.performance_id
   and ts.sale_starts_at = ss.opens_at
   and coalesce(nullif(ts.label, ''), '一般発売') = coalesce(ss.label, '一般発売');


-- =====================================================================
-- casts の公開readを is_published=true に制限(追補§2.2)
-- =====================================================================
-- 初版は using(true) で、未公開・会員限定のキャスト行も anonキーの
-- PostgREST 直叩きで読めてしまう(公開APIも出力面に含まれる=非公開原則違反)。
-- 画面(SSR)は is_published のみ表示しているため挙動は変わらない。
-- 管理画面・通知バッチは service role のためRLSの影響を受けない。

drop policy if exists "public read casts" on casts;
create policy "public read casts" on casts
  for select using (is_published is true);


-- =====================================================================
-- 運用ビューを anon から遮断
-- =====================================================================
-- ビューは所有者権限で基表を読むため(RLS非適用)、anonキーのPostgREST
-- 直叩きで member_only キャストの存在が読めてしまう。管理・バッチは
-- service role で読むため、anon / authenticated からは剥奪する。

revoke select on qa_leaked_member_only_casts from anon, authenticated;
revoke select on pending_cast_releases from anon, authenticated;
revoke select on upcoming_sale_triggers from anon, authenticated;
