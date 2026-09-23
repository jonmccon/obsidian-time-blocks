# Task 3: settings.ts OAuth wizard restructure (5 steps)

## Scope
Restructured the Google Calendar OAuth setup wizard in `src/settings.ts` from
its old ad-hoc 2-field shape (client ID + single "Calendar sign-in" item) into
a 5-step wizard matching the rescoped Option D design (Web-application OAuth
client + GitHub Pages static redirect page, manual-paste as the PRIMARY path,
not a delayed fallback).

## The 5 steps (all gated with the existing `visible()` predicate pattern)

1. **Create a Google Cloud project** — deep-link button to
   `console.cloud.google.com/projectcreate` + self-reported toggle
   ("I've created a project"), persisted as `settings.oauthSetupProjectCreated`.
2. **Enable the Calendar API** — deep-link button to the Calendar API's
   library-enable page + self-reported toggle, persisted as
   `settings.oauthSetupApiEnabled`. Only visible once step 1's toggle is on.
3. **Create OAuth credentials** — bold **"Web application"** application-type
   instruction (via `createFragment`, not a plain string, so the bold tag
   renders), inline note + "Copy redirect URI" button (clipboard API with a
   Notice fallback if clipboard access is denied) for the fixed URL
   `https://jonmccon.github.io/obsidian-time-blocks/oauth-redirect.html`,
   a deep-link button to the OAuth credentials page, and a self-reported
   toggle persisted as `settings.oauthSetupRedirectConfigured`. Only visible
   once step 2's toggle is on.
4. **Paste your Client ID** — unchanged existing text field bound to
   `oauthClientId` (kept as-is per the task scope). Only visible once step 3's
   toggle is on.
5. **Authorize** — unchanged existing "Authorize" button (PKCE flow, opens the
   Google consent screen in the browser). Directly below it, immediately
   visible with no delay/disclosure widget, the "Authorization code" item now
   presents both hand-back paths as equally valid: a note ("After authorizing,
   click 'Open in Obsidian' on the redirect page, or...") followed by the
   existing manual code-paste text field + Submit button. Both paths funnel
   into the same `completeAuthorization()` (auth.ts) — the manual-paste side
   directly, and the protocol-handler side via
   `TimeBlockSettingTab.completePendingAuthorization()` (already wired in
   Task 2+4, confirmed still correct — see main.ts:105-117 and
   settings.ts:157-174, both call `refreshDomState()` after completion so the
   green-check/"Calendar account" status flips identically regardless of
   which path delivered the code).

Removed the old Step-4-that-doesn't-apply concept entirely — no "register the
redirect URI in Console" step exists in the wizard, because that's a one-time,
fixed, already-known URL for ALL users, presented instead as an inline
copy-to-clipboard note inside step 3 (not a step requiring user judgment).

No 15-second delayed disclosure was built. Both hand-back paths are visible
together, unconditionally, the moment step 5's authorize item renders.

## Settings model changes (`TimeBlockSettings` interface + `DEFAULT_SETTINGS`)
Added three new persisted boolean fields to back the self-reported step
checkboxes:
- `oauthSetupProjectCreated`
- `oauthSetupApiEnabled`
- `oauthSetupRedirectConfigured`

All default to `false`. These are purely UI-gating state — they are never
validated against Google, matching the "self-reported checkbox" language in
the task spec.

## Files changed
- `src/settings.ts` — wizard restructure (steps 1-5), new settings fields,
  new `REDIRECT_URI` import from `./gcal/auth` for the copy-to-clipboard step,
  `createFragment` import from `obsidian` for the bold "Web application" text.

No changes to `src/gcal/auth.ts` (exchange logic untouched, as instructed) or
`src/main.ts` (protocol handler wiring verified correct, not rebuilt).

## Verification
- `npm run build` → `tsc -noEmit -skipLibCheck && esbuild production` — exit 0,
  no errors.
- `npm run test` (vitest) → 186 total, 182 passing, 4 failing. The 4 failures
  are the same pre-existing `tests/gcal/conflictResolver.test.ts`
  (`blockToISOStart`/`blockToISOEnd`) timezone-dependent test bugs already
  present at the Task 2+4 baseline (confirmed identical failure count/messages
  before and after this change) — unrelated to this task, not introduced by it.
- `npx eslint src/**/*.ts` → 0 problems.
- No dev server / watch process was started during this task; none needed to
  be killed.

## Screenshot description (no live Obsidian instance available to capture one)
Settings pane → "Two-way sync" group, with "Enable two-way sync" toggled on:
  Step 1: Create a Google Cloud project
    [Open Google Cloud Console]  (toggle) "I've created a project"
  Step 2: Enable the Calendar API   (appears once step 1's toggle is on)
    [Enable Calendar API]  (toggle) "I've enabled the Calendar API"
  Step 3: Create OAuth credentials   (appears once step 2's toggle is on)
    "Create an OAuth client ID and choose **Web application** as the
     application type... copy this exact URL into the redirect URIs field:"
     `https://jonmccon.github.io/obsidian-time-blocks/oauth-redirect.html`
    [Copy redirect URI] [Open OAuth credentials page]  (toggle) "I've created..."
  Step 4: Paste your Client ID   (appears once step 3's toggle is on)
    [text field: "Your client ID"]
  Step 5: Authorize   (appears once step 4 has a non-empty client ID)
    [Authorize] (CTA button)
  Authorization code   (appears immediately alongside step 5, no delay)
    "After authorizing, click 'Open in Obsidian' on the redirect page, or..."
    [text field: paste code/URL] [Submit]

Once tokens are obtained (via either path), the wizard collapses and the
existing "Calendar account" / "Sign out" / "Target calendar" items appear,
unchanged from before this task.

## Branch / commit
Branch `feature/gcal-oauth-ux`, committed locally only. Not pushed, not
merged to master (per task instructions).
