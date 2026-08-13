import * as vscode from 'vscode';
import * as path from 'path';

interface IdeEvent {
  file_path: string;
  language: string;
  action: string;
  project: string | null;
  duration_seconds: number;
  lines_changed: number;
  timestamp: string;
  editor: string;
}

const BUFFER_KEY = 'evowork.eventBuffer';
const MAX_BUFFER_SIZE = 500;

let eventBuffer: IdeEvent[] = [];
let currentFile: {
  filePath: string;
  language: string;
  project: string | null;
  startTime: number;
  linesChanged: number;
} | null = null;
let sendTimer: ReturnType<typeof setInterval> | null = null;
let statusBarItem: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext | null = null;

// ── Buffer persistence ──────────────────────────────

function saveBuffer() {
  if (extensionContext) {
    extensionContext.globalState.update(BUFFER_KEY, eventBuffer);
  }
}

function loadBuffer() {
  if (extensionContext) {
    eventBuffer = extensionContext.globalState.get<IdeEvent[]>(BUFFER_KEY, []);
  }
}

function pushEvent(event: IdeEvent) {
  eventBuffer.push(event);
  // Cap buffer size to prevent unbounded growth
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer = eventBuffer.slice(-MAX_BUFFER_SIZE);
  }
  saveBuffer();
}

// ── Tracking ────────────────────────────────────────

function getProjectName(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].name;
  }
  return null;
}

function startTracking(doc: vscode.TextDocument) {
  stopTracking();

  const scheme = doc.uri.scheme;
  if (scheme !== 'file') return;  // Skip untitled, git, etc.

  currentFile = {
    filePath: doc.uri.fsPath,
    language: doc.languageId,
    project: getProjectName(),
    startTime: Date.now(),
    linesChanged: 0,
  };
  updateStatusBar();
}

function stopTracking() {
  if (!currentFile) return;

  const durationSec = Math.round((Date.now() - currentFile.startTime) / 1000);

  if (durationSec >= 5 || currentFile.linesChanged > 0) {
    pushEvent({
      file_path: currentFile.filePath,
      language: currentFile.language,
      action: currentFile.linesChanged > 0 ? 'save' : 'focus',
      project: currentFile.project,
      duration_seconds: durationSec,
      lines_changed: currentFile.linesChanged,
      timestamp: new Date(currentFile.startTime).toISOString(),
      editor: 'vscode',
    });
  }

  currentFile = null;
  updateStatusBar();
}

function updateStatusBar() {
  if (currentFile) {
    const filename = path.basename(currentFile.filePath);
    statusBarItem.text = `$(pulse) EvoWork: ${filename}`;
    statusBarItem.tooltip = `Tracking: ${currentFile.filePath}`;
    statusBarItem.show();
  } else {
    const bufCount = eventBuffer.length;
    statusBarItem.text = bufCount > 0
      ? `$(pulse) EvoWork: idle (${bufCount} pending)`
      : `$(pulse) EvoWork: idle`;
    statusBarItem.show();
  }
}

// ── Batch sending ───────────────────────────────────

async function sendBatch() {
  stopTracking();  // Flush current file session

  if (eventBuffer.length === 0) return;

  const config = vscode.workspace.getConfiguration('evowork');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:8000');
  const apiKey = config.get<string>('apiKey', '');
  const enabled = config.get<boolean>('enabled', true);

  if (!enabled) {
    vscode.window.showWarningMessage('EvoWork: Tracking is disabled. Enable it in settings.');
    return;
  }

  const payload = { source: 'ide', events: eventBuffer };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  try {
    const response = await fetch(`${serverUrl}/api/collect/ide`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json() as { created: number; skipped: number };
      vscode.window.showInformationMessage(
        `EvoWork: Sent ${result.created} events (${result.skipped} skipped)`
      );
      eventBuffer = [];
      saveBuffer();
    } else {
      const text = await response.text();
      vscode.window.showWarningMessage(`EvoWork: Send failed (${response.status})`);
      console.error('EvoWork send failed:', text);
    }
  } catch (err: any) {
    vscode.window.showWarningMessage(`EvoWork: Connection error — ${err.message}`);
    // Buffer persisted via globalState, will retry next cycle
  }
}

// ── Extension lifecycle ─────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  // Restore buffer from previous session
  loadBuffer();

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'evowork.showStatus';
  context.subscriptions.push(statusBarItem);

  // Track active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        startTracking(editor.document);
      } else {
        stopTracking();
      }
    })
  );

  // Track document saves (count lines changed)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (currentFile && currentFile.filePath === doc.uri.fsPath) {
        currentFile.linesChanged += 1;  // Approximate: we know a save happened
      }
    })
  );

  // Track text changes (more granular line count)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (currentFile && currentFile.filePath === event.document.uri.fsPath) {
        for (const change of event.contentChanges) {
          const added = change.text.split('\n').length - 1;
          const removed = change.range.end.line - change.range.start.line;
          currentFile.linesChanged += Math.max(added, removed);
        }
      }
    })
  );

  // Start tracking current editor if any
  if (vscode.window.activeTextEditor) {
    startTracking(vscode.window.activeTextEditor.document);
  }

  // Periodic send timer
  const config = vscode.workspace.getConfiguration('evowork');
  const intervalMin = config.get<number>('sendIntervalMinutes', 5);
  sendTimer = setInterval(sendBatch, intervalMin * 60 * 1000);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('evowork.sendNow', sendBatch)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('evowork.showStatus', () => {
      const bufSize = eventBuffer.length;
      const tracking = currentFile
        ? `Tracking: ${path.basename(currentFile.filePath)} (${currentFile.language})`
        : 'Not tracking any file';
      vscode.window.showInformationMessage(
        `EvoWork: ${bufSize} events buffered (persisted). ${tracking}`
      );
    })
  );

  updateStatusBar();

  const restoredMsg = eventBuffer.length > 0
    ? ` (restored ${eventBuffer.length} events from previous session)`
    : '';
  console.log(`EvoWork IDE Tracker activated${restoredMsg}`);
}

export async function deactivate() {
  stopTracking();
  if (sendTimer) clearInterval(sendTimer);
  // Attempt final flush (await to give the request a chance to complete)
  if (eventBuffer.length > 0) {
    try {
      await sendBatch();
    } catch {
      // Buffer is persisted, will be sent on next activation
    }
  }
}
