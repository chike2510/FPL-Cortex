# FPL Cortex — Backend Architecture

## Stack Recommendation

### Why this stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Vanilla JS PWA (current) | Works. No framework debt. |
| API | Vercel Serverless Functions | Already deployed. Keep it. |
| Database | **Supabase (PostgreSQL)** | Open source. Self-hostable. Standard SQL. Portable. |
| Auth | **Supabase Auth** | JWT-based. Works standalone. Can self-host on any VPS. |
| ORM | **Drizzle ORM** | Lightweight. Type-safe. Works with any PostgreSQL. |
| FPL Layer | `/api/fpl.js` (new) | Single entry point. All FPL calls go here. |

### Why Supabase over Firebase/PlanetScale/Mongo

- It's just **PostgreSQL** under the hood — if you leave Supabase, your data moves with you
- Self-hostable on Hetzner, Railway, Coolify, Docker — zero vendor lock-in
- Auth is standard JWT — works the same anywhere
- Free tier is generous enough to launch

---

## Database Schema

```sql
-- Users (extends Supabase auth.users)
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),
  fpl_entry_id INTEGER,
  fpl_cookie  TEXT,          -- encrypted FPL session cookie
  username    TEXT,
  is_pro      BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Saved teams (squad snapshots)
CREATE TABLE saved_teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  gameweek    INTEGER,
  players     JSONB NOT NULL,   -- array of player IDs
  captain_id  INTEGER,
  vc_id       INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlists
CREATE TABLE watchlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL,
  added_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, player_id)
);

-- AI conversation history
CREATE TABLE ai_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,    -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  gameweek    INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences
CREATE TABLE preferences (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme       TEXT DEFAULT 'dark',
  kit_primary TEXT DEFAULT '#1e3a5f',
  kit_secondary TEXT DEFAULT '#ffffff',
  fav_team    INTEGER,
  notifs      JSONB DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Premium subscriptions (future)
CREATE TABLE subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  plan        TEXT DEFAULT 'free',    -- 'free' | 'pro'
  started_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  stripe_id   TEXT
);
```

---

## FPL Data Flow (fixed)

```
Frontend
  |
  | fetch('/api/fpl?path=/bootstrap-static/')
  ↓
/api/fpl.js  (unified service)
  |
  | — checks in-memory cache
  | — adds FPL headers + cookie if auth=1
  | — retries on failure (2x)
  | — formats errors consistently
  ↓
fantasy.premierleague.com/api
  |
  ↓
Returns JSON → cached → sent to frontend
```

**Public endpoints (no auth):**
- `/bootstrap-static/` — all players, teams, gameweek info
- `/fixtures/` — all fixtures
- `/event/{gw}/live/` — live GW scores
- `/entry/{id}/` — manager profile
- `/entry/{id}/history/` — season history

**Auth endpoints (need FPL cookie):**
- `/my-team/{id}/` — current picks + chips
- `/entry/{id}/event/{gw}/picks/` — GW picks
- `/leagues-classic/{id}/standings/` — league standings

---

## FPL Authentication Fix

The old approach stored cookies in localStorage (insecure, breaks on refresh).

**New approach:**
1. User logs in via `/api/fpl` POST with email + password
2. Server fetches FPL session cookie (never exposed to frontend)
3. Cookie stored encrypted in Supabase `users.fpl_cookie`
4. All authenticated FPL requests: frontend sends Supabase JWT → server decrypts FPL cookie → forwards to FPL

---

## Moving Away From Vercel

When ready to move:

1. **Database**: Already portable — it's Postgres. `pg_dump` → restore anywhere
2. **Auth**: Export Supabase users → re-import to self-hosted Supabase or Auth.js
3. **API**: The `/api/fpl.js` service is plain Node.js — wrap in Express and deploy anywhere
4. **Frontend**: Static files — serve from Nginx, Cloudflare Pages, or any CDN

No rebuild needed. Just redeploy.

---

## Root Causes of Current FPL Issues

| Issue | Root Cause | Fix |
|---|---|---|
| Players page not loading | `fplFetch` used 4 public CORS proxies that are rate-limited/blocked | Replaced with `/api/fpl.js` server-side proxy |
| Team import not working | `/api/myteam.js` forwarded cookie header incorrectly | Unified service handles cookie forwarding |
| Manager search broken | `/search/` endpoint doesn't exist on FPL API | Now uses `/entry/{id}/` lookup |
| Leagues not loading | Missing auth cookie on requests | `fplFetch(path, true)` now sends cookie |
| Loading screen stuck | Syntax error in `script.js` from bad regex replacements | Fixed: `node --check` passes clean |
| Stats strip doubled | Injected static HTML + JS-generated HTML both rendering | Removed static duplicate |
