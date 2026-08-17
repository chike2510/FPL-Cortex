# Connect with official FPL: browser-companion user experience

## Product promise

> Sign in on the official Fantasy Premier League website. Cortex never asks for, receives, or stores your FPL password.

The connection experience is deliberately browser-first. Cortex owns the pairing screen and account status, while the official Premier League site owns authentication. The companion owns the short-lived PKCE verifier and authorization-code exchange inside the browser context.

## Step 1: Start from Cortex

The user opens **Connect FPL** from the dashboard, Leagues, or My Team. The modal presents a primary action named **Continue to official FPL**. When the companion is installed and enabled, that action opens the official PingOne authorization request in a separate browser tab. The request uses the whitelisted official FPL redirect, so the extension watches the return to the official FPL origin and pairs the result back to the Cortex tab.

The modal also presents **Team ID preview** as a separate, clearly read-only fallback. The existing token-import route is kept out of the primary path because it is too technical for normal users.

## Step 2: Pair the browser tab

When the user selects **Continue to official FPL**, Cortex asks the companion to generate a short-lived PKCE verifier, state, and authorization URL. The companion opens the official PingOne authorization request and Cortex changes the modal to **Waiting for official FPL**. The user sees three short instructions:

1. Sign in on the official FPL page.
2. Return to the Cortex tab when the account page has loaded.
3. Keep the companion installed and enabled for the connection to complete.

No email, password, cookie, refresh token, or authorization code is requested by Cortex. The authorization code is handled only inside the companion so it can complete the PKCE exchange against the whitelisted official redirect.

## Step 3: Authenticate only on the official site

The user enters credentials, completes any Premier League verification challenge, and reaches the authenticated FPL site. The companion observes the official FPL origin and the redirect back to that origin only. It exchanges the returned code with the stored PKCE verifier, calls the official `/api/me/` endpoint with the resulting short-lived access token, and extracts only a small account summary: entry ID, display name, team name, total points, overall rank, and current gameweek points.

The companion discards response bodies after extracting those fields. It never reads password fields or browser cookies. The access token and authorization code remain in the companion’s in-memory operation and are not sent to Cortex, stored in local storage, or written to the server.

## Step 4: Confirm the account in Cortex

Cortex receives a browser message containing the sanitized account summary. The modal changes to a confirmation card showing the manager name, team name, and entry ID. The user selects **Use this FPL account**. Cortex stores only the display summary locally for the proof of concept and marks the connection as **Browser companion connected**.

In the production version, the confirmation would establish a short-lived bridge session. Private reads and write actions would be executed by the companion on the official FPL origin after explicit user confirmation; Cortex would not receive the underlying browser session.

## Success state

The modal closes and the account control changes to the connected manager name. My Team and Leagues show a small **Connected via official FPL browser** label. A **Disconnect companion** action removes the local pairing state and asks the companion to forget the connection.

## Waiting and timeout states

If no official session is detected after 90 seconds, Cortex shows **Still waiting** with two actions: **Open official FPL again** and **Use Team ID preview**. The user can safely close the modal without losing any credentials because none were handled by Cortex.

If the extension is missing or disabled, Cortex shows **Companion not detected** and links to the local installation instructions. The fallback remains Team ID preview, which is public and read-only.

## Error states

If the official FPL site is unavailable, Cortex says **The official FPL site could not be reached. Try again shortly.** If the user is not signed in, Cortex says **No active official FPL session was found. Finish sign-in on the Premier League website, then retry.** If a site origin other than the official FPL domain attempts to send account data, Cortex ignores the message.

## Disconnect and privacy

Disconnecting removes Cortex’s local manager summary and the companion’s pairing state. It does not sign the user out of the official FPL site unless the user explicitly chooses **Sign out of official FPL** in that site.

## Proof-of-concept limitation

The current proof of concept validates the official PingOne authorization launch, the whitelisted return to `fantasy.premierleague.com`, the local PKCE exchange, and the sanitized `/api/me/` account summary. The browser companion is still required; the Cortex website alone cannot receive the official redirect because the supplied client is registered to the official FPL callback. Private team writes remain disabled until each write is implemented as an explicit companion action.
