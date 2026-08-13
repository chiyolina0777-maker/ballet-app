-- 通知キュー(§6: A2の保存やCronが登録し、9:00/18:00のバッチが消化する)
create table notification_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                 -- cast_announced / cast_changed / sale_start
  performance_id uuid references performances(id) on delete cascade,
  show_id uuid references shows(id) on delete cascade,
  ticket_sale_id uuid references ticket_sales(id) on delete cascade,
  dancer_ids uuid[] not null default '{}',  -- 宛先計算用(該当キャストのダンサー)
  created_at timestamptz not null default now(),
  processed_at timestamptz            -- バッチ処理済みマーク
);
create index idx_nq_unprocessed on notification_queue (processed_at) where processed_at is null;

-- クライアントからは読み書き不可(service roleのみ)
alter table notification_queue enable row level security;
