# EvoWork Browser Tracker

A Chrome extension that tracks your browser activity and sends it to [EvoWork AI](https://github.com/yl0911/EvoWork-AI) for work pattern analysis.

## Features

- **Tab activity tracking**: Monitors which tabs you're actively viewing and for how long
- **Window focus detection**: Pauses tracking when the browser window loses focus
- **Periodic sync**: Sends activity batches every 5 minutes via Chrome Alarms API
- **Persistent buffer**: Events survive service worker restarts (stored in chrome.storage.local)
- **Badge counter**: Shows pending event count on the extension icon
- **Configurable server**: Set your EvoWork AI server URL via the popup

## Installation

### Developer mode (recommended for self-hosted)

1. Clone or download this repository
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the `chrome-extension` folder
5. The extension icon should appear in the toolbar

### Configuration

1. Click the extension icon to open the popup
2. Enter your EvoWork AI server URL (default: `http://localhost:8000`)
3. The status indicator will show green when connected

## How It Works

The extension's background service worker:
1. Listens to `tabs.onActivated`, `tabs.onUpdated`, `tabs.onRemoved`, and `windows.onFocusChanged`
2. Records time spent on each active tab (minimum 10 seconds)
3. Buffers events in memory and persists to `chrome.storage.local`
4. Flushes the buffer to `${serverUrl}/api/collect/browser` every 5 minutes
5. Updates the badge with the pending event count

## Data Collected

Each browser event includes:
- `url`: The page URL
- `title`: The page title
- `duration_seconds`: Time spent on the tab
- `timestamp`: ISO 8601 timestamp
- `tab_id`: Chrome tab identifier

## Privacy

- Only URLs and page titles are collected — **no page contents** are ever sent
- Chrome internal pages (`chrome://`, `chrome-extension://`) are excluded
- Events are buffered locally and only sent to your self-hosted server
- Clear the buffer anytime via the popup "Clear" button
