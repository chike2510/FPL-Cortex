# FPL Integration Protocol

**Verification date:** 12 August 2026

**Scope:** The supplied FPL Cortex archive is a static/Vercel application. This document records what was verified against the live 2026/27 official FPL website and its public client bundle, what remains historical or inferred, and how Cortex now isolates the integration.

## Executive summary

Cortex now treats `bootstrap-static` as the independent public data source for the Players page. It does not use an entry ID as authentication, does not persist an upstream FPL cookie or bearer token in browser storage, and routes protected calls through `api/fpl.js`.

The official 2026/27 client bundle visibly uses a redirect-based OAuth/OIDC signin abstraction for its public login CTA. The exact authorization URL, client ID, callback contract, and token exchange were not recoverable from the public bundle alone. Cortex therefore does **not** invent those values. The current server adapter exposes a clear unsupported state unless a deployment explicitly enables the legacy form-login fallback with `FPL_ENABLE_LEGACY_LOGIN=true`. This prevents Cortex from presenting an unverified historical flow as current behavior.

> **Important:** Enabling the legacy fallback is a deployment decision, not a claim that the historical login endpoint is the current official authentication protocol. The current official redirect flow still needs to be configured or verified in a logged-in development browser session.

## Verified live behavior

The following requests were made against the official 2026/27 API on 12 August 2026.

| Operation | Request | Observed result |
| --- | --- | --- |
| Public season data | `GET https://fantasy.premierleague.com/api/bootstrap-static/` | HTTP 200, JSON payload containing `chips`, `events`, `element_types`, `elements`, `teams`, and season configuration data. |
| Public entry lookup | `GET https://fantasy.premierleague.com/api/entry/1/` | HTTP 200, public entry JSON containing manager and league metadata. This is not authentication. |
| Current account without auth | `GET https://fantasy.premierleague.com/api/me/` | HTTP 200 with `{"player":null,"watched":[]}`. |
| Current team without auth | `GET https://fantasy.premierleague.com/api/my-team/1/` | HTTP 403 with `{"detail":"Authentication credentials were not provided."}`. |
| Official login surface | Public FPL home page | A `Log in` CTA invokes a redirect-based `signinRedirect` flow in the official client bundle. |

The public Players page is therefore independent of Cortex or FPL account authentication. If its data is unavailable, the defect is in Cortex’s own fetch, cache, normalization, or rendering pipeline.

## Current official client-bundle evidence

The public `index-oPAWs5dP.js` bundle was downloaded from the live official site and inspected as static code. The bundle’s request helper adds the following headers to JSON mutations:

```http
Content-Type: application/json
X-CSRFToken: <csrftoken cookie value>
```

The bundle contains these request call sites:

| Workflow | Method | Current path in the official client | Payload evidence |
| --- | --- | --- | --- |
| Bootstrap and account initialization | `GET` | `/api/bootstrap-static/` and `/api/me/` | The client loads both during initialization. |
| Authenticated current team | `GET` | `/api/my-team/{entry}/` | The client loads the current team after it knows the authenticated entry. |
| Initial pre-season squad creation | `POST` | `/api/entry-create/` | The bundle calls `Ca("entry-create/", { ...e, picks: dPe(n()) }, ...)`. The expanded registration fields represented by `e` were not recoverable from public static inspection. |
| Existing squad/chip save | `POST` | `/api/my-team/{entry}/` | The bundle calls `Ca("my-team/${entry}/", { chip: ..., picks: ... }, ...)`. |
| Post-gameweek transfers | `POST` | `/api/transfers/` | The bundle calls `Ca("transfers/", { chip, entry, event, transfers }, ...)`. |
| Official auto-pick | `POST` | `/api/entry-autopick/` | Present in the client bundle; not used by Cortex because the product requirement calls for a local numerical optimisation engine. |

Cortex wraps the verified mutation routes behind `POST /api/fpl?route=team%2Fsubmit`, requires an explicit browser confirmation, and re-fetches the current team after the mutation. It reports success only when the returned player IDs match the requested player IDs.

## Authentication status

### Verified current behavior

The official public client uses an OAuth/OIDC-style redirect abstraction. The official home-page login CTA invokes `signinRedirect({ ... })`. The bundle contains an authorization-code flow implementation, but the public static bundle does not disclose a complete deployable authorization configuration for a third-party Cortex application.

### Historical behavior

Older open-source FPL tooling posts an `application/x-www-form-urlencoded` body to:

```http
POST https://users.premierleague.com/accounts/login/
Content-Type: application/x-www-form-urlencoded

login=<email>&password=<password>&app=plfpl-web&redirect_uri=https://fantasy.premierleague.com/a/identify/user
```

This is preserved only as an explicitly disabled fallback. It must not be treated as the verified 2026/27 protocol.

### Cortex behavior

The browser submits credentials only to the Cortex server route. The browser does not receive an upstream FPL cookie, bearer token, or password. When the server obtains upstream authentication material through a supported flow, it stores it only in an encrypted `HttpOnly`, `Secure`, `SameSite=Lax` Cortex session cookie. The session uses AES-256-GCM and requires `FPL_SESSION_SECRET` in production.

When the current official login callback is not configured, `POST /api/fpl?route=connect` returns `FPL_AUTH_UNSUPPORTED` rather than guessing a login endpoint. This is intentional and is the remaining blocker for fully automated account connection in this archive.

## Cortex API surface

| Cortex route | Purpose | Authentication |
| --- | --- | --- |
| `GET /api/fpl?route=bootstrap` | Return cached official bootstrap payload | Public |
| `GET /api/fpl?route=players` | Return public player, team, and position data | Public |
| `GET /api/fpl?route=fixtures` | Return official fixture data | Public |
| `GET /api/fpl?route=gameweeks` | Return official gameweek data | Public |
| `POST /api/fpl?route=connect` | Execute the configured server-side account transaction | None before connection; creates HttpOnly session on success |
| `GET /api/fpl?route=connection` | Return sanitized connection metadata | Cortex session |
| `GET /api/fpl?route=me` | Proxy the authenticated current-account lookup | Cortex session |
| `GET /api/fpl?route=my-team` | Load the authenticated current/pre-season team | Cortex session |
| `GET /api/fpl?route=sync` | Reconcile account identity and current team | Cortex session |
| `DELETE /api/fpl?route=connection` | Clear the Cortex session | Cortex session |
| `POST /api/fpl?route=team%2Fsubmit` | Submit a pre-season or post-gameweek payload and verify returned state | Cortex session |
| `GET /api/fpl?path=...` | Compatibility proxy for existing public calls | Public by default; `auth=1` requires Cortex session |

## Pre-season squad model

The UI distinguishes a **Cortex Draft** from the **FPL Official Team**. The draft builder uses public bootstrap data before Gameweek 1 and supports direct player selection, positions, budget, club allocation, starting XI, bench order, captain, vice captain, validation, analysis, local draft saving, and an explicit synchronization action.

The validator returns structured fields in the same conceptual shape as the requirement:

```json
{
  "valid": false,
  "budget": { "spent": 97.5, "remaining": 2.5, "limit": 100 },
  "errors": ["11 players selected; 15 required"],
  "warnings": ["Player X has an availability note"]
}
```

The UI does not require `is_current === 1` or a gameweek-specific `/event/1/picks/` endpoint to build a draft. If the authenticated current-team endpoint returns a pre-season state, Cortex accepts it as the source for the official-team snapshot.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `FPL_SESSION_SECRET` | Yes in production | Secret used to encrypt and authenticate the Cortex session cookie. |
| `FPL_ENABLE_LEGACY_LOGIN` | No; defaults to disabled | Set to `true` only when the deployment explicitly accepts the historical form-login fallback. This is not verified current protocol. |
| `FPL_ENABLE_ENTRY_CREATE` | No; defaults to disabled | Set to `true` only after the official logged-in frontend’s complete pre-season registration payload has been captured and configured. |

No FPL password is stored. No bearer token or upstream cookie is returned from any Cortex JSON route.

## Remaining limitations

The live account page references an account service URL, but direct public navigation to `https://account.premierleague.com/as` returned `{"message":"Missing Authentication Token"}`. That response is not enough to construct an OAuth authorization URL or token exchange. A real logged-in development session, official third-party client configuration, or documented callback contract is required to complete a supported 2026/27 account connection.

The exact expanded request body for `POST /api/entry-create/` remains partially unknown because the public static bundle only exposed the call shape `{ ...e, picks: dPe(n()) }`. Cortex therefore keeps pre-season writes disabled by default and does not claim that its `team/submit` pre-season payload is production-ready for a live FPL account until that payload has been captured and verified from the official logged-in frontend.

The supplied archive does not contain the promised Next.js/Supabase schema or a persistent database layer. The implemented draft persistence is local to the browser, while the server-side session is encrypted in an HttpOnly cookie. A future Supabase migration should add profiles, fpl_connections, fpl_players, fpl_teams, fpl_gameweeks, squad_drafts, and squad_draft_players without storing passwords.

## References

[1]: https://fantasy.premierleague.com/api/bootstrap-static/ "Official FPL bootstrap-static endpoint"
[2]: https://fantasy.premierleague.com/api/me/ "Official FPL current-account endpoint"
[3]: https://fantasy.premierleague.com/api/my-team/1/ "Official FPL current-team endpoint example"
[4]: https://fantasy.premierleague.com/en/ "Official Fantasy Premier League 2026/27 public site"
[5]: https://users.premierleague.com/accounts/login/ "Historical FPL login endpoint used by older tooling"
[6]: https://fantasy.premierleague.com/api/entry/1/ "Official FPL public entry endpoint example"
