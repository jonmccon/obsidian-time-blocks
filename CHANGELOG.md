# Changelog

All notable changes to **Time Blocks** are documented in this file.

## [1.0.2] – 2026-07-21

### Features

- **Weekly time-block canvas** — 7-day hourly grid with drag-and-drop scheduling, block resize, now-indicator, and sticky day headers ([#1](https://github.com/jonmccon/obsidian-time-blocks/pull/1))
- **Tasks-plugin backlog** — Vault-wide task scanner using emoji markers (`📅 ⏰ 🔺 ⏫ 🔼 🔽 ⏬`); tasks appear in a sidebar for drag-to-schedule ([#1](https://github.com/jonmccon/obsidian-time-blocks/pull/1))
- **Configurable backlog with custom queries** — Switch between "show all" and a Tasks-plugin-compatible multi-line query filter (16 rule types: status, due/path/tag/priority filters, sort, limit) ([#3](https://github.com/jonmccon/obsidian-time-blocks/pull/3))
- **Task source linking + completion toggles** — Task titles in both backlog and scheduled blocks open the originating note at the exact line; checkboxes write completion state back to the markdown file ([#7](https://github.com/jonmccon/obsidian-time-blocks/pull/7))
- **Multi-calendar ICS feeds** — Add, verify, and delete multiple calendar feed URLs; per-feed connection status; event IDs namespaced to prevent collisions across feeds ([#8](https://github.com/jonmccon/obsidian-time-blocks/pull/8))
- **Two-way Google Calendar sync** — Full OAuth 2.0 PKCE flow, bidirectional event mapping, conflict resolution, rate-limited API client with exponential backoff, and automated sync on plugin load ([#10](https://github.com/jonmccon/obsidian-time-blocks/pull/10))
- **Single-day sidebar view** — New `DayView` opens in Obsidian's right sidebar with day navigation, a single-column time grid, and full block interaction (drag-and-drop, completion, resize, delete) ([#14](https://github.com/jonmccon/obsidian-time-blocks/pull/14))
- **Overdue scheduled-task surfacing** — Tasks with a past `⏰` scheduled date are pinned to the top of the backlog with a subtle red indicator and a one-click "Clear" action ([#15](https://github.com/jonmccon/obsidian-time-blocks/pull/15))
- **Sidebar resizer** — Draggable resize handle between the backlog panel and the calendar grid (constrained 150–600 px); task titles changed from buttons to links ([#13](https://github.com/jonmccon/obsidian-time-blocks/pull/13))
- **Inline filter examples in settings** — Representative query examples rendered under the custom query textarea to guide users ([#9](https://github.com/jonmccon/obsidian-time-blocks/pull/9))
- **Backlog filter controls in sidebar + tag chip viewer** — Backlog mode and completed-task toggles moved from Settings into the sidebar panel; clickable multi-select tag chips for filtering ([#16](https://github.com/jonmccon/obsidian-time-blocks/pull/16))
- **Interactive CI preview** — Per-PR GitHub Pages preview at `pr-<number>/` with full drag-and-drop, navigation, search, and `localStorage` persistence (no vault required) ([#17](https://github.com/jonmccon/obsidian-time-blocks/pull/17), [#20](https://github.com/jonmccon/obsidian-time-blocks/pull/20))

### Bug Fixes

- **Duplicate tasks in backlog** — `app.vault.getMarkdownFiles()` can return duplicate entries during metadata-cache rebuilds; deduplicated by path before scanning ([#12](https://github.com/jonmccon/obsidian-time-blocks/pull/12))
- **TypeScript strict index access errors** — `tagColors` Record lookups in `settings.ts` and `TimeBlockView.ts` now handle `undefined` entries under `strict` mode ([#4](https://github.com/jonmccon/obsidian-time-blocks/pull/4))

### Infrastructure & DX

- **Test infrastructure** — Vitest setup with Obsidian API mock; 173+ unit tests across `weekUtils`, `icsParser`, `queryFilter`, `taskQuery`, `gcal/*` modules ([#5](https://github.com/jonmccon/obsidian-time-blocks/pull/5), [#10](https://github.com/jonmccon/obsidian-time-blocks/pull/10))
- **CI workflow** — Consolidated lint + build + test pipeline in `.github/workflows/ci.yml` ([#5](https://github.com/jonmccon/obsidian-time-blocks/pull/5))
- **Release workflow** — `.github/workflows/release.yml` builds on tag push and creates a GitHub release with `main.js`, `manifest.json`, and `styles.css` attached ([#11](https://github.com/jonmccon/obsidian-time-blocks/pull/11))
- **AGENTS.md** — Comprehensive agent guide covering the data model, vault task format, and step-by-step recipes for programmatic scheduling ([#18](https://github.com/jonmccon/obsidian-time-blocks/pull/18))
- **README** — Full feature documentation, installation paths (build from source, GitHub Releases, BRAT), settings reference, and project structure ([#2](https://github.com/jonmccon/obsidian-time-blocks/pull/2), [#6](https://github.com/jonmccon/obsidian-time-blocks/pull/6))

---

## [1.0.1] – 2026-07-12

### Bug Fixes

- **Obsidian community plugin review failures** — `minAppVersion` updated from `0.15.0` to `1.4.0` to match actual API usage (`getLeaf('tab')`, `revealLeaf`, `addColorPicker`, `addExtraButton`); `authorUrl` corrected to personal GitHub profile per submission requirements; deprecated API calls replaced with current equivalents ([#22](https://github.com/jonmccon/obsidian-time-blocks/pull/22))
- **version-bump.mjs silently skipping versions.json** — Removed guard that prevented writing an entry when the `minAppVersion` already existed as a value; every release tag now appears as a key ([#21](https://github.com/jonmccon/obsidian-time-blocks/pull/21))

---

## [1.0.0] – 2026-03-16

Initial release. Scaffolded the full plugin with a weekly time-block canvas, Tasks-plugin-compatible backlog sidebar, ICS calendar feed support, and Google Calendar integration groundwork.

---

### In Progress

- **Quick-filter bar** — Status pills (Open / Done / All) and a sort dropdown (Default / Priority / Due date / Name) added to the backlog sidebar above the task list ([#19](https://github.com/jonmccon/obsidian-time-blocks/pull/19))
- **OAuth security hardening** — CSRF state parameter validation, token endpoint error handling, re-entrant authorization guard, and token storage documentation ([#25](https://github.com/jonmccon/obsidian-time-blocks/pull/25))
