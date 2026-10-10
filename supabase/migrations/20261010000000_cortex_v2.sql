-- FPL Cortex v2: auth-linked profiles, server-side entitlements, billing, push, league packs, promo codes.
-- Run in a NEW Supabase project (or `supabase db push`). Writes happen only with the service role
-- from Vercel functions; users can read their own rows via RLS.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fpl_entry_id bigint,
  data_saver boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('lemonsqueezy','paystack','manual')),
  provider_subscription_id text not null,
  provider_customer_id text,
  plan text not null default 'plus',
  interval text check (interval in ('monthly','yearly')),
  status text not null,               -- active | on_trial | past_due | cancelled | expired | paused | unpaid
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

create table if not exists public.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  fpl_entry_id bigint,
  prefs jsonb not null default '{"deadline":true,"injuries":true,"prices":true}',
  created_at timestamptz not null default now()
);

create table if not exists public.push_log (
  subscription_id bigint not null references public.push_subscriptions(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (subscription_id, key)
);

-- League packs: an admin buys the recap/awards TOOL for their mini-league. Never an entry fee or prize.
create table if not exists public.league_packs (
  league_id bigint primary key,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  provider text,
  provider_order_id text,
  period_end timestamptz,
  created_at timestamptz not null default now()
);

-- Creator promo codes + revenue-share tracking.
create table if not exists public.promo_codes (
  code text primary key check (code = upper(code)),
  creator_name text not null,
  creator_email text,
  discount_pct numeric(5,2) not null default 0,
  rev_share_pct numeric(5,2) not null default 20,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.promo_redemptions (
  id bigint generated always as identity primary key,
  code text not null references public.promo_codes(code),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  order_id text not null,
  amount_minor integer not null default 0,
  currency text not null default 'GBP',
  rev_share_minor integer not null default 0,
  paid_out boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, order_id)
);
create or replace view public.creator_revenue as
  select code, count(*) as redemptions, sum(amount_minor) as gross_minor, sum(rev_share_minor) as owed_minor,
         sum(case when paid_out then rev_share_minor else 0 end) as paid_minor, currency
  from public.promo_redemptions group by code, currency;

-- RLS: users read their own rows; service role (Vercel functions) bypasses RLS for writes.
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.league_packs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.push_log enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;

create policy "own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "own subscriptions" on public.subscriptions for select using (auth.uid() = user_id);
create policy "own push" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "own league packs" on public.league_packs for select using (auth.uid() = admin_user_id);
-- webhook_events, push_log, promo_* : no policies => service role only.
revoke all on public.creator_revenue from anon, authenticated;
