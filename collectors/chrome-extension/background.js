/**
 * EvoWork Browser Tracker — Background Service Worker
 *
 * Tracks active tab time and periodically sends batches to the EvoWork server.
 * Events are buffered in memory and flushed every SEND_INTERVAL minutes.
 */

const SEND_INTERVAL_MINUTES = 5;
const MIN_DURATION_SECONDS = 10;
const STORAGE_KEY = 'evowork_config';
const BUFFER_KEY = 'evowork_buffer';

/** @type {{ url: string; title: string; duration_seconds: number; timestamp: string; tab_id: string }[]} */
let eventBuffer = [];
let currentTab = null;  // { tabId, url, title, startTime }

// ── Tab tracking ────────────────────────────────────

function startTracking(tabId, url, title) {
  stopTracking();
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
  currentTab = { tabId, url, title, startTime: Date.now() };
}

function stopTracking() {
  if (!currentTab) return;
  const durationSec = Math.round((Date.now() - currentTab.startTime) / 1000);
  if (durationSec >= MIN_DURATION_SECONDS) {
    eventBuffer.push({
      url: currentTab.url,
      title: currentTab.title || '',
      duration_seconds: durationSec,
      timestamp: new Date(currentTab.startTime).toISOString(),
      tab_id: String(currentTab.tabId),
    });
  }
  currentTab = null;
}

// Tab activated (switched tabs)
chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await chrome.tabs.get(info.tabId);
    startTracking(info.tabId, tab.url, tab.title);
  } catch (_) { /* tab may be closed */ }
});

// Tab updated (URL changed or title loaded)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.title)) {
    if (changeInfo.url) startTracking(tabId, changeInfo.url, changeInfo.title || tab.title);
    else if (currentTab && currentTab.tabId === tabId && changeInfo.title) {
      currentTab.title = changeInfo.title;
    }
  }
});

// Tab removed (closed)
chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentTab && currentTab.tabId === tabId) stopTracking();
});

// Window focus changed
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    stopTracking();  // Window lost focus
  } else {
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
    });
  }
});

// ── Batch sending ───────────────────────────────────

async function sendBatch() {
  stopTracking();  // Flush current tab session

  if (eventBuffer.length === 0) return { sent: 0 };

  const config = await chrome.storage.local.get(STORAGE_KEY);
  const serverUrl = config[STORAGE_KEY]?.serverUrl || 'http://localhost:8000';

  const payload = { source: 'browser', events: eventBuffer };

  try {
    const resp = await fetch(`${serverUrl}/api/collect/browser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (resp.ok) {
      const result = await resp.json();
      const sent = eventBuffer.length;
      eventBuffer = [];
      // Persist empty buffer
      await chrome.storage.local.set({ [BUFFER_KEY]: [] });
      return { sent, result };
    } else {
      console.warn('EvoWork send failed:', resp.status, await resp.text());
      return { sent: 0, error: `HTTP ${resp.status}` };
    }
  } catch (err) {
    console.warn('EvoWork send error:', err.message);
    // Keep buffer for retry
    await chrome.storage.local.set({ [BUFFER_KEY]: eventBuffer });
    return { sent: 0, error: err.message };
  }
}

// ── Alarms (periodic flush) ─────────────────────────

chrome.alarms.create('sendBatch', { periodInMinutes: SEND_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sendBatch') {
    const result = await sendBatch();
    // Update badge with buffer size
    chrome.action.setBadgeText({ text: eventBuffer.length > 0 ? String(eventBuffer.length) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  }
});

// ── Message handler (from popup) ────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getStatus') {
    sendResponse({
      bufferSize: eventBuffer.length,
      tracking: currentTab ? { url: currentTab.url, title: currentTab.title } : null,
    });
    return true;
  }

  if (msg.action === 'sendNow') {
    sendBatch().then(sendResponse);
    return true;
  }

  if (msg.action === 'clearBuffer') {
    eventBuffer = [];
    chrome.storage.local.set({ [BUFFER_KEY]: [] });
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ cleared: true });
    return true;
  }
});

// ── Init: restore buffer from storage ───────────────

chrome.storage.local.get(BUFFER_KEY, (data) => {
  if (data[BUFFER_KEY]?.length) {
    eventBuffer = data[BUFFER_KEY];
  }
});

// Start tracking the currently active tab on startup
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
});
