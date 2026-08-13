-- 公演編集時に販売窓口(ticket_sales)を置換できるよう、通知履歴のFKをcascadeに変更
-- (販売窓口を消すとその通知履歴も消える = 新しい窓口は別IDなので再通知は正しく動く)
alter table notifications drop constraint notifications_ticket_sale_id_fkey;
alter table notifications add constraint notifications_ticket_sale_id_fkey
  foreign key (ticket_sale_id) references ticket_sales(id) on delete cascade;
