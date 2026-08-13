# Data Collection Layer

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collect/status` | Collector status with linked skills and event counts |
| POST | `/api/collect/git` | Git commit collector |
| POST | `/api/collect/shell` | Single shell command event |
| POST | `/api/collect/shell/batch` | Batch shell commands |
| POST | `/api/collect/browser` | Browser activity batch (Chrome extension) |
| POST | `/api/collect/ide` | IDE activity batch (VS Code extension) |
| POST | `/api/collect/activitywatch` | ActivityWatch import |
| POST | `/api/collect/import` | Generic batch import |

## Extensions

### Chrome Extension (`collectors/chrome-extension/`)

Tracks active browser tabs and sends activity to the server. See [README](../collectors/chrome-extension/README.md) for installation instructions.

**Installation:**
1. Open `chrome://extensions/` → Enable Developer mode
2. Click "Load unpacked" → Select `collectors/chrome-extension/` folder
3. Click the extension icon → Set server URL → Verify connection

### VS Code Extension (`collectors/vscode-extension/`)

Tracks active editor files and sends coding activity. See [README](../collectors/vscode-extension/README.md) for details.

**Installation:**
1. Build: `cd collectors/vscode-extension && npm install && npm run compile`
2. Package: `npx vsce package --no-dependencies`
3. Install the `.vsix` in VS Code: `Ctrl+Shift+P` → "Install from VSIX..."
4. Configure `evowork.serverUrl` in VS Code settings

## Git Hook Installation

```bash
python scripts/install_git_hook.py <repo_path>
```

## Shell History Hook

```bash
# Install shell hook (bash/zsh)
python scripts/install_shell_hook.py

# Or parse existing history
python scripts/parse_shell_history.py
```

## Source → Skill Mapping

| Source | System Skill |
|--------|-------------|
| git | git-workflow |
| shell | shell-ops |
| browser | browser-research |
| ide | ide-coding |
| activitywatch | aw-tracking |
