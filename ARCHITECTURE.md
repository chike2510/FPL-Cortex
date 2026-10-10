# FPL Cortex v2 architecture

**Unofficial. Not affiliated with the Premier League or Fantasy Premier League.**

## Layout
| Path | What |
|---|---|
| `/` (`index.html`) | Landing page |
| `/app/` (`app/index.html`, `src/`) | The app: Vite, ES modules, one lazy chunk per tab |
| `/classic/` (`public/classic/`) | The v1 app, kept read-only while v2 settles (news now via `/api/news`) |
| `shared/xp.js` | Component xP model (ported from v1), captain picks, transfer suggestions, price outlook. Used by browser **and** API |
| `shared/kits.js` | Generic kit drawings from club colours (no PL artwork / photo hotlinks) |
| `api/` | Vercel functions (10). `_lib/` holds shared helpers, not deployed as functions |
| `supabase/migrations/` | SQL for profiles, subscriptions, webhooks, push, league packs, promo codes |

## App IA (5 tabs)
Home (deadline, GW score/rank, captain, top-3 alerts, intel) · Team (pitch, rating, captain, transfers + official FPL transfers deep link, chip planner, share card) · Players (search, quick chips, Filter/Sort bottom sheets with price histogram and live counts, cards/compact toggle, FDR grid, price movers, "Best pick for your team") · Live (live points + provisional bonus, rank trend, rivals with EO/swing, mini-leagues, league recap) · Ask (AI analyst). Profile/settings behind the gear (sign-in, Plus, data saver, alerts, Draft add-on, League Pack, classic link).

## API
| Function | Runtime | Notes |
|---|---|---|
| `api/fpl.js` | Edge | Whitelisted public FPL paths + legacy routes; CDN cache (bootstrap 5m, fixtures 2m, live 30s, s-maxage + SWR). FPL 403s Node serverless IPs; Edge works |
| `api/ai.js` | Edge | Groq with tool calling (`get_player`, `get_fixtures`, `get_my_squad`, `compare_players`); same-origin only; 8/min/IP; free = 3 questions/GW; Plus unlimited (60/h fair use); token caps |
| `api/account.js` | Edge | `config`, `me`, `checkout` (Lemon Squeezy / Paystack), `push-subscribe`, `link-team` |
| `api/plus.js` | Edge | Plus-only `captain`, `transfers`, `planner`; `league-recap` (Plus or League Pack). Entitlement verified server-side from Supabase JWT + `subscriptions` |
| `api/billing/[provider].js` | Edge | Lemon Squeezy (HMAC-SHA256 `X-Signature`) and Paystack (HMAC-SHA512 `x-paystack-signature`) webhooks; idempotent via `webhook_events`; promo attribution |
| `api/og.js` | Edge | `@vercel/og` team card / award card PNG; `format=html` share page with OG tags |
| `api/news.js` | Edge | Server-side RSS (BBC, Sky, Guardian, ESPN, 90min), plain text only |
| `api/cron/notify.js` | Node | Web push: deadline (≤26h), injury flags, likely price changes. Reads FPL through our edge proxy |
| `api/fpl-companion.js` | Node | Browser-companion refresh-token session only. Password login removed |
| `api/weather.js` | Node | Unchanged |

## Security
- No FPL passwords anywhere. Team ID / team-name search only.
- Every rendered string goes through `src/lib/dom.js` `html```, which escapes interpolations.
- Plus is never decided in the browser.

See `.env.example` for configuration.
