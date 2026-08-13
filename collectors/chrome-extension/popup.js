const STORAGE_KEY = 'evowork_config';

const serverInput = document.getElementById('serverUrl');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const bufferCount = document.getElementById('bufferCount');
const trackingSection = document.getElementById('trackingSection');
const trackingUrl = document.getElementById('trackingUrl');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const resultBox = document.getElementById('resultBox');

// Load config
chrome.storage.local.get(STORAGE_KEY, (data) => {
  const config = data[STORAGE_KEY] || {};
  serverInput.value = config.serverUrl || 'http://localhost:8000';
  checkConnection(config.serverUrl || 'http://localhost:8000');
});

// Save config on change
serverInput.addEventListener('change', () => {
  const url = serverInput.value.replace(/\/+$/, '');
  chrome.storage.local.set({ [STORAGE_KEY]: { serverUrl: url } });
  checkConnection(url);
});

// Get status from background
chrome.runtime.sendMessage({ action: 'getStatus' }, (resp) => {
  if (resp) {
    bufferCount.textContent = resp.bufferSize;
    if (resp.tracking) {
      trackingSection.style.display = 'block';
      trackingUrl.textContent = resp.tracking.title || resp.tracking.url;
      trackingUrl.title = resp.tracking.url;
    }
  }
});

// Check server connection
async function checkConnection(url) {
  statusDot.className = 'dot yellow';
  statusText.textContent = 'Connecting...';
  try {
    const resp = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      statusDot.className = 'dot green';
      statusText.textContent = `Connected — ${data.app || 'EvoWork AI'}`;
    } else {
      statusDot.className = 'dot gray';
      statusText.textContent = `Server error (${resp.status})`;
    }
  } catch (err) {
    statusDot.className = 'dot gray';
    statusText.textContent = 'Server unreachable';
  }
}

// Send button
sendBtn.addEventListener('click', () => {
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  chrome.runtime.sendMessage({ action: 'sendNow' }, (resp) => {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send Now';
    if (resp?.sent > 0) {
      showResult('success', `Sent ${resp.sent} events successfully`);
      bufferCount.textContent = '0';
    } else if (resp?.error) {
      showResult('error', `Failed: ${resp.error}`);
    } else {
      showResult('success', 'No events to send');
    }
  });
});

// Clear button
clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'clearBuffer' }, () => {
    bufferCount.textContent = '0';
    showResult('success', 'Buffer cleared');
  });
});

function showResult(type, message) {
  resultBox.className = `result ${type}`;
  resultBox.textContent = message;
  setTimeout(() => { resultBox.className = 'result'; }, 3000);
}
