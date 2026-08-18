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

### From VSIX (recommended)

1. Download the `.vsix` file from releases, or build from source (see below)
2. In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the `.vsix` file
4. Reload VS Code when prompted

### From source

```bash
cd collectors/vscode-extension

# Install dependencies and compile
npm install
npm run compile

# Package into .vsix
npx @vscode/vsce package --no-dependencies
```

> **PowerShell users**: Replace `&&` chains with `;` — e.g. `npm install; npm run compile`

## Configuration

Open VS Code Settings (`Ctrl+,`) and search for `evowork`:

| Setting | Default | Description |
|---------|---------|-------------|
| `evowork.serverUrl` | `http://localhost:8000` | EvoWork AI server URL |
| `evowork.sendIntervalMinutes` | `5` | How often to send batches (1–60 min) |
| `evowork.enabled` | `true` | Enable/disable tracking |
| `evowork.apiKey` | *(empty)* | API key for server authentication (leave empty if not required) |

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and search for `EvoWork`:

| Command | Description |
|---------|-------------|
| `EvoWork: Send Activity Now` | Immediately send all buffered events |
| `EvoWork: Show Tracking Status` | Show current tracking state and buffer size |

## Verification

After installing and configuring:

1. Open any project and edit a file for a few minutes
2. Check the VS Code status bar for the EvoWork tracking indicator
3. Run `EvoWork: Show Tracking Status` to see buffer size
4. Run `EvoWork: Send Activity Now` to flush immediately
5. Open the EvoWork **Config page** → check the IDE collector `event_count` has increased

## Troubleshooting

| Symptom | Cause & Fix |
|---------|-------------|
| Status bar shows no EvoWork indicator | Extension not activated — reload VS Code window (`Ctrl+Shift+P` → `Developer: Reload Window`) |
| Events not appearing on server | Check `evowork.serverUrl` is correct and the server is running. Use `EvoWork: Send Activity Now` and check VS Code Output panel |
| `npx @vscode/vsce package` fails | Ensure Node.js ≥ 18 is installed. Try `npm install` first to get devDependencies |
| Buffer keeps growing | Server unreachable — verify network connectivity and server URL |

## Data Collected

Each activity event includes:

- `file_path` — Full path of the active file
- `language` — Programming language (from VS Code language ID)
- `action` — "save" (if lines changed) or "focus" (viewing only)
- `project` — Workspace folder name
- `duration_seconds` — Time spent on the file
- `lines_changed` — Number of lines added/removed
- `timestamp` — ISO 8601 timestamp
- `editor` — Always "vscode"

## Privacy

- Only file paths and activity metadata are collected — **no file contents** are ever sent
- Set `evowork.enabled` to `false` to disable tracking at any time
- Data is sent only to your self-hosted EvoWork AI server
