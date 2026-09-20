# Task 1 summary — auth.ts redirect URI -> GitHub Pages static page (Option D)

Task: t_ac0f8273
Branch: feature/gcal-oauth-ux (not merged, not pushed)
Repo worktree: /Users/obmBot/source/obsidian-time-blocks.worktrees/gcal-oauth-ux

## What changed

1. `src/gcal/auth.ts`
   - `REDIRECT_URI` changed from `http://127.0.0.1` to
     `https://jonmccon.github.io/obsidian-time-blocks/oauth-redirect.html`.
   - Doc comment above the constant rewritten to explain Option D: a
     "Web application" OAuth client type in Google Cloud Console (not
     "Desktop app"/native), which requires a real `https://` redirect URI;
     the target is the new static GitHub Pages page. Notes that code/state
     arrive via `window.location.search`, references the Task 0b spike
     evidence, and reiterates that the URI must exactly match an
     "Authorized redirect URI" on the Web-application OAuth client.
   - No signature changes: `buildAuthUrl` / `exchangeCodeForTokens` still
     accept an optional `redirectUri` override, untouched.

2. `docs/oauth-redirect.html` (new file, new `docs/` dir at repo root)
   - Pure static HTML + inline vanilla JS. No backend, no build step, no
     external JS/CSS dependencies.
   - Reads `code` / `state` / `error` / `error_description` from
     `window.location.search` (confirmed by spike: query string, not hash).
   - Success state: shows the code in a readonly `<input>`, "Copy code"
     button using `navigator.clipboard.writeText`, with a
     `document.execCommand('copy')` fallback and a user-visible message if
     clipboard access is denied/unavailable. Numbered instructions telling
     the user to copy the code and paste it into Obsidian's Time Blocks
     settings pane (Settings → Time Blocks → Google Calendar).
   - Error state: shown when `code` is missing — either because Google
     returned an `error` param (e.g. `access_denied`, with
     `error_description` if present) or because the user navigated to the
     page directly with no query params at all. No broken/empty page in
     either case.
   - Minimal one-off styling (no framework), light/dark aware via
     `prefers-color-scheme`.
   - Header comment in the file itself flags the GitHub Pages infra step
     (see below) — this agent did not touch repo/Pages settings.

## Infra note — manual action required (NOT done by this agent)

For `docs/oauth-redirect.html` to actually be served at
`https://jonmccon.github.io/obsidian-time-blocks/oauth-redirect.html`,
**jonmccon must manually enable GitHub Pages** on the
`obsidian-time-blocks` repo:

> Settings → Pages → Build and deployment → Source: "Deploy from a
> branch" → Branch: default branch, folder `/docs`.

This is a repo-admin action in GitHub's web UI. No `gh api` calls or any
other automation were run against Pages/repo settings — intentionally
out of scope per task instructions. This must be called out explicitly
in the PR description when this branch is opened for review.

## Build verification

- `npm install` (node_modules was missing in the worktree) — 361 packages,
  no errors relevant to this change (12 pre-existing audit advisories,
  unrelated).
- `npm run build` → `tsc -noEmit -skipLibCheck && node esbuild.config.mjs
  production` — **completed with exit code 0, no errors.** This
  compiles the full project including the modified `src/gcal/auth.ts`.

## Other

- No dev server / preview process was started for the static page, so
  nothing needed to be killed.
- Working tree also has two pre-existing untracked spike files
  (`SPIKE_task0_redirect_uri.md`, `SPIKE_task0b_weblient_redirect.md`)
  from prior tasks in this pipeline — left untouched.
- Change is uncommitted in the worktree (git diff --stat:
  `src/gcal/auth.ts | 21 ++++++++++++++-------`, plus the new untracked
  `docs/oauth-redirect.html`). Not merged to master, not pushed, per
  instructions.
