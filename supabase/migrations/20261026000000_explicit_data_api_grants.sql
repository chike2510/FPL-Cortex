-- Supabase stops auto-granting Data API access on new tables in `public` from 30 Oct 2026
-- (https://supabase.com/changelog/45329). Existing tables keep their grants, but a fresh project,
-- branch, or `supabase db reset` would leave these tables unreachable via supabase-js / REST (42501).
-- This makes the access the app already relies on explicit. RLS policies are unchanged.

grant usage on schema public to authenticated, service_role;

-- Server side (Vercel functions with the service role key): full access.
grant select, insert, update, delete on table
  public.profiles,
  public.subscriptions,
  public.webhook_events,
  public.push_subscriptions,
  public.push_log,
  public.league_packs,
  public.promo_codes,
  public.promo_redemptions,
  public.live_state,
  public.entry_picks
to service_role;
grant select on public.creator_revenue to service_role;

-- Signed-in users: read only, rows limited by the existing "own ..." RLS policies.
grant select on table
  public.profiles,
  public.subscriptions,
  public.push_subscriptions,
  public.league_packs
to authenticated;

-- Going forward: every new `create table` in public needs RLS + policies + an explicit grant
-- in the same migration, e.g.
--   alter table public.my_table enable row level security;
--   grant select, insert, update, delete on public.my_table to service_role;
--   grant select on public.my_table to authenticated;  -- only if the client reads it
