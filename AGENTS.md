# Time Blocks — Agent Guide

This file is for AI agents working with the **Time Blocks** Obsidian plugin.
It explains how the system works and provides concrete recipes for the two most
common agent tasks:

1. **Adding a time span to a task** (the equivalent of a user dragging a task
   onto the calendar grid).
2. **Batch-scheduling multiple tasks** on behalf of a user (organizing a
   backlog into a calendar week).

---

## System overview

Time Blocks is an Obsidian community plugin that adds a weekly time-blocking
calendar to a vault. The plugin:

- Scans all markdown files in the vault for tasks written in the
  [Obsidian Tasks](https://obsidian-tasks-group.github.io/obsidian-tasks/)
  emoji format (`- [ ] task text 📅 2025-01-15 ⏫`).
- Displays those tasks in a backlog sidebar so the user can drag them onto a
  7-day, hourly time grid.
- Persists the resulting *scheduled blocks* (+ plugin settings) to a single
  JSON file: `<vault>/.obsidian/plugins/time-blocks/data.json`.
- Optionally syncs blocks to/from a connected Google Calendar (two-way, OAuth
  2.0 PKCE).

**Entry point:** `src/main.ts` — minimal lifecycle shell.  
**All feature logic** lives in `src/views/`, `src/utils/`, and `src/gcal/`.

---

## Key source modules

| File | What it does |
|---|---|
| `src/types.ts` | Core interfaces: `ScheduledBlock`, `TaskItem`, `GCalEvent` |
| `src/settings.ts` | `TimeBlockSettings` interface, defaults, settings UI |
| `src/utils/taskQuery.ts` | Vault scanner (`scanAllTasks`), task parser, `setTaskCompletion`, `clearTaskScheduledDate` |
| `src/utils/weekUtils.ts` | `getWeekStart`, `formatDate`, `addWeeks`, `formatHour` |
| `src/utils/queryFilter.ts` | Tasks-plugin query parser and filter pipeline |
| `src/utils/icsParser.ts` | ICS/iCal feed parser |
| `src/views/TimeBlockView.ts` | Weekly grid UI, drag-and-drop, block rendering, `scheduleTask`, `moveBlock`, `deleteBlock` |
| `src/views/DayView.ts` | Single-day sidebar view (same data model, different layout) |
| `src/gcal/syncEngine.ts` | Two-way sync orchestrator |
| `src/gcal/calendarApi.ts` | Google Calendar API v3 client |

---

## Data model

### `ScheduledBlock` (`src/types.ts`)

The central record. One row per time block on the grid.

```ts
interface ScheduledBlock {
  id: string;           // unique, e.g. "block-3-1720000000000"
  taskId?: string;      // "<filePath>:<lineNumber>" — links to the source task
  gcalEventId?: string; // Google Calendar event ID (only when source === 'gcal')
  title: string;
  weekStart: string;    // ISO date of the Monday of the target week: "YYYY-MM-DD"
  dayIndex: number;     // 0 = Monday … 6 = Sunday
  startHour: number;    // 0–23 (local time)
  startMinute: number;  // 0, 15, 30, or 45  (15-minute snap)
  duration: number;     // minutes (minimum 15)
  color: string;        // CSS hex, e.g. "#7B61FF"
  source: 'task' | 'gcal' | 'manual';
}
```

### `TaskItem` (`src/types.ts`)

Parsed representation of a markdown task line.

```ts
interface TaskItem {
  id: string;            // "<filePath>:<lineNumber>"
  title: string;         // cleaned display text (emojis/dates stripped)
  dueDate?: Date;        // 📅 YYYY-MM-DD
  scheduledDate?: Date;  // ⏰ YYYY-MM-DD
  priority?: number;     // 1 (highest) … 5 (lowest)
  filePath: string;      // relative path inside the vault, e.g. "tasks/work.md"
  lineNumber: number;    // 1-based
  completed: boolean;
  tags: string[];        // e.g. ["#work", "#q1"]
  rawText: string;       // original markdown line
}
```

### `data.json` schema

Located at `<vault>/.obsidian/plugins/time-blocks/data.json`.

```json
{
  "version": 1,
  "settings": { /* TimeBlockSettings — see src/settings.ts */ },
  "blocks": [ /* ScheduledBlock[] */ ],
  "eventMappings": [ /* EventMapping[] — gcal sync metadata */ ]
}
```

Only `blocks` needs to be modified for scheduling tasks. Leave `settings` and
`eventMappings` untouched unless you are explicitly working with Google Calendar
sync.

---

## Vault task format

Tasks must follow the [Obsidian Tasks](https://obsidian-tasks-group.github.io/obsidian-tasks/) emoji format to be picked up by the scanner:

```markdown
- [ ] Task title
- [ ] Task with due date 📅 2025-07-15
- [ ] High-priority task ⏫ 📅 2025-07-10
- [x] Completed task
- [ ] Tagged task #work #q3
- [ ] Scheduled to work on it ⏰ 2025-07-11
```

**Priority emojis** (highest → lowest): `🔺 ⏫ 🔼 🔽 ⏬`  
**Due date:** `📅 YYYY-MM-DD`  
**Scheduled date** (when you plan to work on it): `⏰ YYYY-MM-DD`

The task `id` is always `"<filePath>:<lineNumber>"` — for example
`"tasks/work.md:7"` means line 7 of `tasks/work.md`.

---

## Agent recipe 1 — Add a time span to a task

This mirrors what a user does when they drag a task from the backlog onto the
calendar grid.

### Approach A — Modify `data.json` directly (recommended for external agents)

This approach works without running JavaScript inside Obsidian.

**Step 1 — Find the task**

Read the relevant markdown file and locate the task line. The task `id` is
`"<relative/path/in/vault.md>:<1-based line number>"`.

Example: file `tasks/work.md`, line 7, task text `- [ ] Finish report 📅 2025-07-15 ⏫`  
→ task id = `"tasks/work.md:7"`

**Step 2 — Compute the `weekStart`**

`weekStart` is the ISO date (YYYY-MM-DD) of the **Monday** of the week you want
to schedule the task into.

```python
from datetime import date, timedelta

def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())  # weekday(): Mon=0, Sun=6

# Example: schedule into the week containing 2025-07-15
ws = week_start(date(2025, 7, 15))  # → date(2025, 7, 14)
week_start_str = ws.isoformat()     # → "2025-07-14"
```

**Step 3 — Build the `ScheduledBlock`**

```python
import time

block = {
    "id": f"block-agent-{int(time.time() * 1000)}",
    "taskId": "tasks/work.md:7",
    "title": "Finish report",   # cleaned title (no emojis/dates)
    "weekStart": "2025-07-14",
    "dayIndex": 1,              # 0=Mon 1=Tue … 6=Sun
    "startHour": 10,
    "startMinute": 0,
    "duration": 60,             # minutes
    "color": "#7B61FF",         # default task block color
    "source": "task"
}
```

**Step 4 — Append the block to `data.json`**

```python
import json, pathlib

data_path = pathlib.Path("<vault>/.obsidian/plugins/time-blocks/data.json")
data = json.loads(data_path.read_text())
data["blocks"].append(block)
data_path.write_text(json.dumps(data, indent="\t"))
```

**Step 5 — Reload the view in Obsidian**

After writing `data.json`, open the Obsidian command palette and run:

> **Time blocks: Refresh time-block view**

Or, if using the Obsidian API from a script / another plugin:

```ts
app.commands.executeCommandById('time-blocks:refresh');
```

### Approach B — Call plugin methods directly (from TypeScript / another plugin)

If you have access to the plugin instance (e.g. from a sibling plugin or an
Obsidian script runner):

```ts
// Obtain the plugin instance
const plugin = app.plugins.plugins['time-blocks'] as TimeBlockPlugin;

// Build a block
const block: ScheduledBlock = {
    id: `block-agent-${Date.now()}`,
    taskId: 'tasks/work.md:7',
    title: 'Finish report',
    weekStart: '2025-07-14',
    dayIndex: 1,
    startHour: 10,
    startMinute: 0,
    duration: 60,
    color: plugin.settings.taskBlockColor,
    source: 'task',
};

plugin.blocks.push(block);
await plugin.saveBlocks();

// Refresh the open view (if any)
app.commands.executeCommandById('time-blocks:refresh');
```

### Constraints to respect

| Constraint | Details |
|---|---|
| Minimum duration | 15 minutes |
| Snap grid | `startMinute` must be 0, 15, 30, or 45 |
| `weekStart` | Always the Monday of the target week (YYYY-MM-DD) |
| `dayIndex` | 0 = Monday, 1 = Tuesday, … 6 = Sunday |
| `source` for task blocks | Always `"task"` |
| `id` uniqueness | Include a timestamp or UUID; never reuse an existing id |
| Visible grid range | Blocks outside `workdayStart`–`workdayEnd` (default 8–18) won't render, but they are still persisted |

---

## Agent recipe 2 — Organize multiple tasks onto the calendar

This is the "schedule my week" use case: the agent reads the backlog, decides
when each task should happen, and writes all the blocks at once.

### High-level workflow

```
1. Read vault tasks          → parse markdown files (or use scanAllTasks)
2. Read existing blocks      → data.json "blocks" array
3. Decide a schedule         → your logic (priority, duration, constraints)
4. Write new blocks          → append to data.json
5. Trigger a refresh         → time-blocks:refresh command
```

### Step 1 — Read vault tasks (Python example)

```python
import re, pathlib
from datetime import datetime, date

TASK_RE = re.compile(r'^(\s*)-\s+\[([ xX])\]\s+(.*)$')
DUE_RE  = re.compile(r'📅\s*(\d{4}-\d{2}-\d{2})')
PRIO_MAP = {'🔺': 1, '⏫': 2, '🔼': 3, '🔽': 4, '⏬': 5}

def parse_tasks(vault_root: pathlib.Path):
    tasks = []
    for md_file in vault_root.rglob('*.md'):
        rel = md_file.relative_to(vault_root)
        lines = md_file.read_text(encoding='utf-8').splitlines()
        for i, line in enumerate(lines, start=1):
            m = TASK_RE.match(line)
            if not m:
                continue
            completed = m.group(2).lower() == 'x'
            text = m.group(3)
            due = None
            dm = DUE_RE.search(text)
            if dm:
                due = date.fromisoformat(dm.group(1))
            priority = next(
                (v for k, v in PRIO_MAP.items() if k in text), None
            )
            # Strip emojis/dates for the display title
            title = re.sub(r'[📅⏰🛫➕✅❌🔁🔺⏫🔼🔽⏬]', '', text)
            title = re.sub(r'\d{4}-\d{2}-\d{2}', '', title).strip()
            tasks.append({
                'id': f'{rel}:{i}',
                'title': title or '(empty task)',
                'dueDate': due,
                'priority': priority,
                'filePath': str(rel),
                'lineNumber': i,
                'completed': completed,
            })
    return tasks
```

### Step 2 — Read existing scheduled blocks

```python
data_path = pathlib.Path('<vault>/.obsidian/plugins/time-blocks/data.json')
data = json.loads(data_path.read_text())
existing_task_ids = {b['taskId'] for b in data['blocks'] if 'taskId' in b}
```

### Step 3 — Build a schedule

A simple greedy scheduler that assigns tasks to the next available slot,
Monday–Friday, using the plugin's configured workday hours:

```python
from datetime import date, timedelta
import time as time_mod

def make_schedule(tasks, week_start: date, workday_start=9, workday_end=17,
                  default_duration=30, skip_task_ids=None):
    """
    Returns a list of ScheduledBlock dicts.
    Tasks are sorted by priority (ascending) then due date.
    Slots are filled greedily; each task gets `default_duration` minutes.
    """
    skip = skip_task_ids or set()
    pending = sorted(
        [t for t in tasks if not t['completed'] and t['id'] not in skip],
        key=lambda t: (t['priority'] or 999,
                       t['dueDate'] or date.max,
                       t['title'])
    )

    blocks = []
    day = 0        # 0 = Monday
    hour = workday_start
    minute = 0

    for task in pending:
        if day > 4:            # only Mon–Fri
            break

        ws_monday = week_start.strftime('%Y-%m-%d')

        blocks.append({
            'id': f'block-agent-{int(time_mod.time() * 1000)}-{len(blocks)}',
            'taskId': task['id'],
            'title': task['title'],
            'weekStart': ws_monday,
            'dayIndex': day,
            'startHour': hour,
            'startMinute': minute,
            'duration': default_duration,
            'color': '#7B61FF',
            'source': 'task',
        })

        # Advance the clock; snap to 15-minute boundary
        total_minutes = hour * 60 + minute + default_duration
        hour = total_minutes // 60
        minute = (total_minutes % 60 // 15) * 15
        if hour >= workday_end:
            day += 1
            hour = workday_start
            minute = 0

    return blocks
```

### Step 4 — Write back and refresh

```python
tasks = parse_tasks(pathlib.Path('<vault>'))
new_blocks = make_schedule(
    tasks,
    week_start=date(2025, 7, 14),
    skip_task_ids=existing_task_ids,
)
data['blocks'].extend(new_blocks)
data_path.write_text(json.dumps(data, indent='\t'))
print(f"Scheduled {len(new_blocks)} tasks.")
# Then run inside Obsidian: Time blocks: Refresh time-block view
```

---

## Obsidian plugin commands (for in-Obsidian agents)

| Command ID | What it does |
|---|---|
| `time-blocks:open` | Open the weekly time-block view |
| `time-blocks:open-day-view` | Open the single-day sidebar view |
| `time-blocks:refresh` | Re-scan vault tasks and re-render the current week |
| `time-blocks:sync-calendar` | Trigger a two-way Google Calendar sync |

Run any command programmatically:

```ts
app.commands.executeCommandById('time-blocks:refresh');
```

---

## Settings reference (for agents that need to read configuration)

Read from `data.json` → `settings`. Important fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `workdayStart` | number | `8` | First hour shown on the grid |
| `workdayEnd` | number | `18` | Last hour shown on the grid |
| `defaultTaskDuration` | number | `30` | Default block duration (minutes) |
| `taskBlockColor` | string | `"#7B61FF"` | Default color for task blocks |
| `gcalEventColor` | string | `"#4285F4"` | Color for Google Calendar event blocks |
| `tagColors` | `Record<string,string>` | `{}` | Per-tag color overrides |
| `backlogMode` | `'all' \| 'custom'` | `'all'` | Which tasks appear in the backlog |
| `customTaskQuery` | string | `""` | Multi-line Tasks-plugin query (custom mode) |
| `enableTwoWaySync` | boolean | `false` | Whether Google Calendar two-way sync is on |

---

## Safety rules for agents

1. **Never delete blocks the user created.** Only add new blocks (or modify
   blocks your agent previously created, identifiable by the `id` prefix you
   chose).
2. **Never modify `eventMappings`** unless you are explicitly implementing
   Google Calendar sync logic.
3. **Never modify `settings`** unless the user explicitly asked you to change a
   specific setting.
4. **Preserve existing `data.json` keys.** Read the full file, mutate only the
   `blocks` array, and write the whole file back.
5. **Validate before writing.** Ensure `weekStart` is a Monday, `dayIndex` is
   0–6, `startMinute` is 0/15/30/45, and `duration` ≥ 15.
6. **Idempotency.** Before scheduling a task, check whether it already has a
   block in the target week (`block.weekStart === targetWeek && block.taskId === taskId`).
   Do not create duplicates.
7. **Vault scope.** Only read and write files inside the vault. Do not access
   system files or network resources unless the user explicitly enabled Google
   Calendar sync.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| New blocks don't appear | View not refreshed | Run `time-blocks:refresh` |
| Block appears at wrong time | `startHour`/`startMinute` outside `workdayStart`–`workdayEnd` | Adjust to fall within the visible range |
| Task not found in backlog | Task already has a block this week | Check `existing_task_ids`; the backlog hides already-scheduled tasks |
| `data.json` not found | Plugin never opened in Obsidian | Open the plugin once so it creates the file, or seed it with `{"version":1,"settings":{},"blocks":[],"eventMappings":[]}` |
| JSON parse error | Concurrent write | Read → mutate → write atomically; never interleave reads/writes |

---

## Development quick-start (for agents modifying plugin code)

```bash
npm install          # install dependencies
npm run build        # type-check + bundle → main.js
npm run dev          # watch mode
npm run lint         # ESLint
npm test             # Vitest unit tests (no Obsidian installation needed)
```

Source lives in `src/`. Bundle artifact is `main.js` at the repo root
(gitignored). Obsidian loads `main.js`, **not** the TypeScript sources.

---

## Obsidian community plugin

### Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.

### Environment & tooling

- Node.js: use current LTS (Node 18+ recommended).
- **Package manager: npm** (required for this sample - `package.json` defines npm scripts and dependencies).
- **Bundler: esbuild** (required for this sample - `esbuild.config.mjs` and build scripts depend on it). Alternative bundlers like Rollup or webpack are acceptable for other projects if they bundle all external dependencies into `main.js`.
- Types: `obsidian` type definitions.

**Note**: This sample project has specific technical dependencies on npm and esbuild. If you're creating a plugin from scratch, you can choose different tools, but you'll need to replace the build configuration accordingly.

#### Install

```bash
npm install
```

#### Dev (watch)

```bash
npm run dev
```

#### Production build

```bash
npm run build
```

### Linting

- To use eslint install eslint from terminal: `npm install -g eslint`
- To use eslint to analyze this project use this command: `eslint main.ts`
- eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder: `eslint ./src/`

### File & folder conventions

- **Organize code into multiple files**: Split functionality across separate modules rather than putting everything in `main.ts`.
- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **Example file structure**:
  ```
  src/
    main.ts           # Plugin entry point, lifecycle management
    settings.ts       # Settings interface and defaults
    commands/         # Command implementations
      command1.ts
      command2.ts
    ui/              # UI components, modals, views
      modal.ts
      view.ts
    utils/           # Utility functions, helpers
      helpers.ts
      constants.ts
    types.ts         # TypeScript interfaces and types
  ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- Generated output should be placed at the plugin root or `dist/` depending on your build setup. Release artifacts must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

### Manifest rules (`manifest.json`)

- Must include (non-exhaustive):  
  - `id` (plugin ID; for local dev it should match the folder name)  
  - `name`  
  - `version` (Semantic Versioning `x.y.z`)  
  - `minAppVersion`  
  - `description`  
  - `isDesktopOnly` (boolean)  
  - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Canonical requirements are coded here: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

### Testing

- Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` (if any) to:
  ```
  <Vault>/.obsidian/plugins/<plugin-id>/
  ```
- Reload Obsidian and enable the plugin in **Settings → Community plugins**.

### Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

### Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json` to map plugin version → minimum app version.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version`. Do not use a leading `v`.
- Attach `manifest.json`, `main.js`, and `styles.css` (if present) to the release as individual assets.
- After the initial release, follow the process to add/update your plugin in the community catalog as required.

### Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. In particular:

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. If you collect optional analytics or call third-party services, require explicit opt-in and document clearly in `README.md` and in settings.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside of normal releases.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.
- Register and clean up all DOM, app, and interval listeners using the provided `register*` helpers so the plugin unloads safely.

### UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to indicate literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

### Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce/throttle expensive operations in response to file system events.

### Coding conventions

- TypeScript with `"strict": true` preferred.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

### Mobile

- Where feasible, test on iOS and Android.
- Don't assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Avoid large in-memory structures; be mindful of memory and storage constraints.

### Agent do/don't

**Do**
- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**
- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

### Common tasks

#### Organize code across multiple files

**main.ts** (minimal, lifecycle only):
```ts
import { Plugin } from "obsidian";
import { MySettings, DEFAULT_SETTINGS } from "./settings";
import { registerCommands } from "./commands";

export default class MyPlugin extends Plugin {
  settings: MySettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    registerCommands(this);
  }
}
```

**settings.ts**:
```ts
export interface MySettings {
  enabled: boolean;
  apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
  enabled: true,
  apiKey: "",
};
```

**commands/index.ts**:
```ts
import { Plugin } from "obsidian";
import { doSomething } from "./my-command";

export function registerCommands(plugin: Plugin) {
  plugin.addCommand({
    id: "do-something",
    name: "Do something",
    callback: () => doSomething(plugin),
  });
}
```

#### Add a command

```ts
this.addCommand({
  id: "your-command-id",
  name: "Do the thing",
  callback: () => this.doTheThing(),
});
```

#### Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  await this.saveData(this.settings);
}
```

#### Register listeners safely

```ts
this.registerEvent(this.app.workspace.on("file-open", f => { /* ... */ }));
this.registerDomEvent(window, "resize", () => { /* ... */ });
this.registerInterval(window.setInterval(() => { /* ... */ }, 1000));
```

### Troubleshooting

- Plugin doesn't load after build: ensure `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`. 
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev` to compile your TypeScript source code.
- Commands not appearing: verify `addCommand` runs after `onload` and IDs are unique.
- Settings not persisting: ensure `loadData`/`saveData` are awaited and you re-render the UI after changes.
- Mobile-only issues: confirm you're not using desktop-only APIs; check `isDesktopOnly` and adjust.

### References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
