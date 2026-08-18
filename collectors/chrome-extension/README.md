# EvoWork Browser Tracker

A Chrome/Edge extension that tracks your browser activity and sends it to [EvoWork AI](https://github.com/yl0911/EvoWork-AI) for work pattern analysis.

## Features

- **Tab activity tracking**: Monitors which tabs you're actively viewing and for how long
- **Window focus detection**: Pauses tracking when the browser window loses focus
- **Periodic sync**: Sends activity batches every 5 minutes via Chrome Alarms API
- **Persistent buffer**: Events survive service worker restarts (stored in `chrome.storage.local`)
- **Badge counter**: Shows pending event count on the extension icon
- **Configurable server**: Set your EvoWork AI server URL via the popup

## Installation

### Step 1: Load the extension

1. Open Chrome (or Edge) → address bar: `chrome://extensions/` (Edge: `edge://extensions/`)
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select the `collectors/chrome-extension` folder
4. The extension icon should appear in the toolbar

### Step 2: Pin the icon (recommended)

Click the puzzle icon 🧩 in the toolbar → find **EvoWork Browser Tracker** → click 📌 to pin it for easy access.

### Step 3: Configure the server

1. Click the extension icon to open the popup
2. Enter your EvoWork AI server URL (default: `http://localhost:8000`)
3. The status indicator will show **green** when connected

### Step 4: Verify data collection

1. Browse a few pages (stay on each page for at least **10 seconds**)
2. Click the extension icon → check the buffer count
3. Click **Send Now** to flush immediately
4. Open the EvoWork **Config page** → check the Browser collector `event_count` has increased

## Troubleshooting

| Symptom | Cause & Fix |
|---------|-------------|
| Badge shows events but server count doesn't increase | Server URL misconfigured or server not running. Check the popup for connection status |
| No events after browser restart | Manifest V3 service workers can be terminated by Chrome. Click the extension icon to wake it up, or check `chrome://extensions` → click the "Service Worker" link for console logs |
| Events missing for short visits | Tabs viewed for less than 10 seconds are filtered out by design |
| Buffer keeps growing | Server unreachable — check that EvoWork is running at the configured URL |

## How It Works

The extension's background service worker:

1. Listens to `tabs.onActivated`, `tabs.onUpdated`, `tabs.onRemoved`, and `windows.onFocusChanged`
2. Records time spent on each active tab (minimum 10 seconds)
3. Buffers events in memory and persists to `chrome.storage.local`
4. Flushes the buffer to `${serverUrl}/api/collect/browser` every 5 minutes
5. Updates the badge with the pending event count

## Data Collected

Each browser event includes:

- `url` — The page URL
- `title` — The page title
- `duration_seconds` — Time spent on the tab
- `timestamp` — ISO 8601 timestamp
- `tab_id` — Chrome tab identifier

## Privacy

- Only URLs and page titles are collected — **no page contents** are ever sent
- Chrome internal pages (`chrome://`, `chrome-extension://`) are excluded
- Events are buffered locally and only sent to your self-hosted server
- Clear the buffer anytime via the popup "Clear" button
