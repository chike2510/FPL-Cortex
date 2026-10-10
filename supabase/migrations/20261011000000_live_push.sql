-- Live push alerts: anonymous (device-only) subscriptions, per-alert prefs, live diff state, picks cache.
alter table public.push_subscriptions alter column user_id drop not null;
alter table public.push_subscriptions add column if not exists updated_at timestamptz not null default now();
alter table public.push_subscriptions alter column prefs set default '{"goal":true,"assist":true,"cs":true,"cs_lost":true,"red":true,"pen_miss":true,"bonus":true,"deadline":true,"prices":true,"injuries":true}';

-- Small key/value store for the live cron: schedule meta, player index, last live snapshot, price snapshot.
create table if not exists public.live_state (
  k text primary key,
  v jsonb not null,
  updated_at timestamptz not null default now()
);

-- Each subscriber's 15 picks per gameweek (fetched once from FPL, then reused every minute).
create table if not exists public.entry_picks (
  entry_id bigint not null,
  gw int not null,
  picks jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (entry_id, gw)
);

alter table public.live_state enable row level security;
alter table public.entry_picks enable row level security;
-- No policies: service role only.
create index if not exists push_log_sent_at on public.push_log (sent_at);
