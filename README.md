# Time Blocks

A weekly time-blocking plugin for [Obsidian](https://obsidian.md). Drag tasks from your vault onto a visual calendar grid to plan your week, with optional Google Calendar overlay.

## Features

- **Weekly calendar grid** — A 7-day time grid (Monday–Sunday) with configurable workday start/end hours and a current-time indicator.
- **Task backlog sidebar** — Automatically scans your vault for tasks written in [Obsidian Tasks](https://obsidian-tasks-group.github.io/obsidian-tasks/) format (`- [ ] task text`) and displays them in a filterable sidebar, sorted by priority and due date.
- **Configurable backlog** — Choose between showing all vault tasks or a custom query. The custom query uses a subset of the Obsidian Tasks community plugin query syntax, so users familiar with that plugin can reuse their knowledge.
- **Drag-and-drop scheduling** — Drag tasks from the backlog onto the grid to schedule them. Once placed, blocks snap to 15-minute increments and can be repositioned by dragging again.
- **Block resizing** — Drag the bottom edge of any scheduled block to change its duration.
- **Google Calendar integration** — Paste a private ICS feed URL in settings to overlay your Google Calendar events on the grid (read-only, HTTPS only).
- **Customizable colors** — Choose background colors for task blocks and calendar event blocks.
- **Search & filter** — Filter the backlog by text, tag, or completion status.
- **Week navigation** — Move between weeks or jump back to the current week.
- **Persistent schedule** — Scheduled blocks are saved to `data.json` and restored when the plugin reloads.

## How it works

1. **Open the view** — Click the calendar icon in the ribbon or run the command *Open weekly time-block view*.
2. **Browse your backlog** — The left sidebar lists incomplete tasks from your vault. Tasks already scheduled for the current week are hidden from the backlog.
3. **Schedule a task** — Drag a task from the backlog and drop it onto a day/time slot. A block is created with the default duration configured in settings.
4. **Adjust blocks** — Drag a block to move it to a different day or time. Drag the bottom edge of a block to resize it. Click the **×** button on a block to remove it from the schedule.
5. **View calendar events** — If a Google Calendar ICS URL is configured, events from that calendar appear as read-only blocks on the grid.
6. **Refresh** — Click the ↻ button or run the *Refresh time-block view* command to re-scan vault tasks and re-fetch calendar events.

## Settings

| Setting | Description | Default |
|---|---|---|
| **Calendar feed URL** | Private ICS feed URL from Google Calendar (HTTPS only) | *(empty)* |
| **Workday start** | First hour shown on the grid (0–12) | 8 |
| **Workday end** | Last hour shown on the grid (12–24) | 18 |
| **Default task duration** | Duration in minutes when a task is first dropped (15–240) | 30 |
| **Backlog mode** | `All tasks` shows every task (with optional tag/completed filters). `Custom query` applies the multi-line query below. | All tasks |
| **Tag filter** | *(All tasks mode)* Only show tasks with this tag (e.g. `#work`). Leave blank for all. | *(empty)* |
| **Show completed tasks** | *(All tasks mode)* Include tasks marked done in the backlog | Off |
| **Custom query** | *(Custom query mode)* Multi-line filter using Tasks-plugin-compatible syntax (see below) | *(empty)* |
| **Task block color** | Background color for scheduled task blocks | `#7B61FF` |
| **Google calendar event color** | Background color for calendar event blocks | `#4285F4` |

### Custom query syntax

When **Backlog mode** is set to *Custom query*, write one filter rule per line. Rules are ANDed together. Lines starting with `#` are treated as comments.

| Rule | Example | Description |
|---|---|---|
| `not done` | `not done` | Only incomplete tasks |
| `done` | `done` | Only completed tasks |
| `due before <date>` | `due before 2025-06-01` | Due date is before the given date |
| `due after <date>` | `due after 2025-01-01` | Due date is after the given date |
| `due on <date>` | `due on 2025-03-15` | Due date matches exactly |
| `path includes <text>` | `path includes projects/` | File path contains the text |
| `path does not include <text>` | `path does not include archive` | File path does not contain the text |
| `description includes <text>` | `description includes meeting` | Task title contains the text |
| `description does not include <text>` | `description does not include template` | Task title does not contain the text |
| `tag includes <tag>` | `tag includes #work` | Task has the specified tag |
| `tag does not include <tag>` | `tag does not include #someday` | Task does not have the specified tag |
| `priority is <level>` | `priority is high` | Exact priority match (highest, high, medium, low, lowest, none) |
| `priority above <level>` | `priority above medium` | Priority is higher than the given level |
| `priority below <level>` | `priority below medium` | Priority is lower than the given level |
| `sort by <field>` | `sort by due` | Sort results (priority, due, or description) |
| `limit to <N> tasks` | `limit to 20 tasks` | Cap the number of results |

This syntax is a subset of the [Obsidian Tasks](https://obsidian-tasks-group.github.io/obsidian-tasks/) query language. Tasks written in the Tasks-plugin emoji format (`📅`, `⏫`, `🔼`, etc.) are parsed automatically regardless of whether the Tasks community plugin is installed.

## Known issues

- **Recurring calendar events are not expanded.** The ICS parser does not process `RRULE` recurrence rules, so recurring Google Calendar events only appear for their original occurrence date and are missing on subsequent weeks.
- **Timezone offsets in ICS feeds are approximated.** Events with `TZID` parameters are treated as local time rather than being converted from the specified timezone, which may cause events to display at incorrect times.
- **Custom query unknown rules are silently ignored.** If a query line doesn't match any recognized rule pattern, it is skipped without an error message. Check spelling if a filter doesn't appear to work.

## Installing the plugin

This plugin is not yet listed in the Obsidian Community Plugins marketplace.
The compiled `main.js` is not stored in the repository (it is a build artifact);
choose one of the options below to install it.

### Option A — Build from source

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/jonmccon/Obsidian-Time-Blocks.git
   cd Obsidian-Time-Blocks
   npm install
   npm run build
   ```

2. Copy `main.js`, `styles.css`, and `manifest.json` into your vault:

   ```
   <vault>/.obsidian/plugins/time-blocks/
   ```

3. Enable **Time Blocks** in *Settings → Community plugins*.

### Option B — Download a release

1. Go to the [Releases page](https://github.com/jonmccon/Obsidian-Time-Blocks/releases) and download the latest `main.js`, `styles.css`, and `manifest.json`.
2. Copy them into your vault:

   ```
   <vault>/.obsidian/plugins/time-blocks/
   ```

3. Enable **Time Blocks** in *Settings → Community plugins*.

### Option C — BRAT (beta users)

If you have the [BRAT community plugin](https://github.com/TfTHacker/obsidian42-brat) installed:

1. Open *Settings → BRAT → Add beta plugin*.
2. Enter: `https://github.com/jonmccon/Obsidian-Time-Blocks`
3. Click **Add plugin**, then enable **Time Blocks** in *Settings → Community plugins*.

## Development

```bash
# Install dependencies
npm install

# Build for production (type-check + bundle)
npm run build

# Dev mode (watch for changes)
npm run dev

# Lint
npm run lint

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/) and run entirely without an Obsidian
installation. The test suite covers the utility modules (`weekUtils`,
`icsParser`, `queryFilter`, `taskQuery`) as well as settings defaults and type
shapes. CI runs build, lint, and tests on every push and pull request.

Requires Node.js v18 or later.

### Project structure

All source code is **TypeScript** in the `src/` directory.
The build step (`npm run build`) type-checks the TypeScript and uses [esbuild](https://esbuild.github.io/) to bundle everything into a single `main.js` file at the repository root.
That `main.js` is the file Obsidian loads at runtime — **not** the TypeScript sources.

```
src/
  main.ts           # Plugin entry point (Plugin subclass, lifecycle hooks)
  settings.ts       # Settings interface, defaults, and settings tab UI
  types.ts          # Shared TypeScript interfaces (ScheduledBlock, TaskItem, GCalEvent)
  utils/
    icsParser.ts    # ICS/iCal feed parser
    queryFilter.ts  # Tasks-plugin query parser and filter
    taskQuery.ts    # Vault task scanner and query executor
    weekUtils.ts    # Date helpers (week start, formatting, navigation)
  views/
    TimeBlockView.ts  # Full calendar view: rendering, drag-and-drop, resizing
```

`main.js` (the compiled bundle) and `node_modules/` are listed in `.gitignore` and are never committed to the repository.
