# EvoWork IDE Tracker

A VS Code extension that tracks your coding activity and sends it to [EvoWork AI](https://github.com/yl0911/EvoWork-AI) for work pattern analysis.

## Features

- **Active editor tracking**: Monitors which files you're working on and for how long
- **Line change counting**: Tracks lines added/removed during editing sessions
- **Project detection**: Automatically detects the workspace project name
- **Periodic sync**: Sends activity batches to your EvoWork AI server every N minutes (configurable)
- **Status bar indicator**: Shows current tracking state in the VS Code status bar
- **Offline buffer**: Events are held in memory and retried on next sync if the server is unreachable

## Installation

### From VSIX (local install)

1. Download the `.vsix` file from releases
2. In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the `.vsix` file

### From source

```bash
npm install
npm run compile
npx vsce package --no-dependencies
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `evowork.serverUrl` | `http://localhost:8000` | EvoWork AI server URL |
| `evowork.sendIntervalMinutes` | `5` | How often to send batches (1-60 min) |
| `evowork.enabled` | `true` | Enable/disable tracking |

## Commands

| Command | Description |
|---------|-------------|
| `EvoWork: Send Activity Now` | Immediately send buffered events |
| `EvoWork: Show Tracking Status` | Show current tracking state and buffer size |

## Data Collected

Each activity event includes:
- `file_path`: Full path of the active file
- `language`: Programming language (from VS Code language ID)
- `action`: "save" (if lines changed) or "focus" (viewing only)
- `project`: Workspace folder name
- `duration_seconds`: Time spent on the file
- `lines_changed`: Number of lines added/removed
- `timestamp`: ISO 8601 timestamp
- `editor`: Always "vscode"

## Privacy

- Only file paths and activity metadata are collected — **no file contents** are ever sent
- Set `evowork.enabled` to `false` to disable tracking at any time
- Data is sent only to your self-hosted EvoWork AI server
