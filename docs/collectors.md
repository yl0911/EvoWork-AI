# Data Collection Layer

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collect/status` | Collector status dashboard — event counts, last collected, stale flags |
| POST | `/api/collect/git` | Git commit collector |
| POST | `/api/collect/shell` | Single shell command event |
| POST | `/api/collect/shell/batch` | Batch shell commands |
| POST | `/api/collect/browser` | Browser activity batch (Chrome extension) |
| POST | `/api/collect/ide` | IDE activity batch (VS Code extension) |
| POST | `/api/collect/activitywatch` | ActivityWatch import |
| POST | `/api/collect/import` | Generic batch import |

### Health Check

Check all collector statuses:

```bash
curl http://127.0.0.1:8000/api/collect/status
```

Each collector reports `event_count`, `last_collected_at`, and `stale` (boolean). Stale thresholds vary by source (see table below).

## Extensions

### Chrome Extension (`collectors/chrome-extension/`)

Tracks active browser tabs and sends activity to the server. See [README](../collectors/chrome-extension/README.md) for full details.

**Quick install:**

1. Open `chrome://extensions/` → Enable Developer mode
2. Click "Load unpacked" → Select `collectors/chrome-extension/` folder
3. Pin the extension icon for easy access
4. Click the extension icon → Set server URL (`http://localhost:8000`) → Verify green status
5. Browse a few pages (>10s each) → Click "Send Now" → Check Config page for events

**Troubleshooting:** If data stops flowing, click the "Service Worker" link in `chrome://extensions` to check console logs. Manifest V3 service workers may be terminated by Chrome after periods of inactivity.

### VS Code Extension (`collectors/vscode-extension/`)

Tracks active editor files and sends coding activity. See [README](../collectors/vscode-extension/README.md) for full details.

**Build and install:**

```bash
cd collectors/vscode-extension
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
```

> PowerShell: use `;` instead of `&&` to chain commands.

Then in VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..." → Select the generated `.vsix` file.

Configure `evowork.serverUrl` in VS Code Settings after installation.

## Git Hook

Records every commit with file changes, insertions/deletions, and branch info.

```bash
python scripts/install_git_hook.py --repo /path/to/your/repo
```

Verify: make a test commit and check the Config page for Git collector event count.

## Shell Hook

Captures terminal commands with exit codes, classifies them, filters noise, and deduplicates.

```bash
# Auto-install (detects bash/zsh/Git Bash)
python scripts/install_shell_hook.py

# Backfill history from shell history files
python scripts/parse_shell_history.py --hours 48
```

> Windows: Uses Git Bash (`~/.bashrc`). The hook captures `PROMPT_COMMAND` output after each command.

## ActivityWatch (optional)

Imports desktop window focus data. Requires [ActivityWatch](https://activitywatch.net/) to be installed and running.

```bash
# Verify ActivityWatch is running
curl http://localhost:5600/api/0/buckets

# Import recent data
python scripts/activitywatch_import.py --evowork-url http://127.0.0.1:8000 --hours 24
```

For automated imports, set up a scheduled task (Windows Task Scheduler or cron) to run the import script every 6 hours.

## Collector Staleness

The Config page monitors collector health and shows a **Stale** warning when a collector hasn't received data within its expected window:

| Source | Stale Threshold |
|---|---|
| Git | 48 hours |
| Shell | 24 hours |
| ActivityWatch | 6 hours |
| Browser | 24 hours |
| IDE | 24 hours |

## Source → System Skill Mapping

Each collector is linked to a system skill that can be toggled on/off from the Config page:

| Source | System Skill ID |
|--------|----------------|
| git | `sys_skill_git_collector` |
| shell | `sys_skill_shell_collector` |
| browser | `sys_skill_browser_tracker` |
| ide | `sys_skill_ide_tracker` |
| activitywatch | `sys_skill_activitywatch_import` |
| manual | `sys_skill_manual_event` |

When a skill is disabled, the corresponding collector endpoint returns HTTP 403.
