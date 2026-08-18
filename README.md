# EvoWork AI

A local-first work and learning evolution assistant. EvoWork AI automatically collects activity data from Git, shell, browser, IDE, and ActivityWatch, then provides AI-powered insights, skill recommendations, and analytics to help you understand and improve your work patterns.

## Features

**Dashboard** — Period-based overview (week/month/year) with key metrics, activity distribution charts, and work pattern summaries.

**Events** — Full-text searchable event timeline with inline editing, revision history, filtering by source/type/tag, and batch import support.

**Skills** — Three-tier skill library (Thinking / Reusable / Open Source) with create, edit, toggle, backfill, pattern mining, usage tracking (record effectiveness per use), and AI-powered recommendations based on 30-day activity analysis.

**AI Event Analysis** — Hierarchical period analysis (Week → Month → Year) with calendar-aligned periods (ISO week, calendar month/year). Week analyzes raw events via LLM, Month consolidates Week results, Year consolidates Month results. Supports manual, daily, biweekly (Wed+Sun), and interval scheduling via APScheduler. Automatic fallback to previous periods when current period has no events.

**Note Import** — Import user documents (.md / .txt / .docx / .pdf / .xlsx) as work events via AI-powered content splitting. Supports manual file upload, inbox directory scanning, and configurable inbox path. Files are auto-archived by week (`archive/YYYY-MM/WXX/`). Content-hash deduplication prevents duplicate imports; files re-added to inbox are re-imported automatically.

**AI Assistant** — Conversational interface with SSE streaming, conversation sidebar (create/switch/delete), persistent chat history (survives page navigation and browser refresh), and context-aware quick actions (period review, skill suggestions, data analysis).

**Search** — Hybrid full-text + vector search (FTS5 + ChromaDB) with keyword highlighting, source/type filters, and trending terms.

**Analytics** — Calendar-aligned period analysis (ISO week / month 1st / year Jan 1st) with timeline Gantt chart, daily efficiency trend (minutes + events), shell command statistics, work pattern analysis (24h distribution, project switching frequency, active days).

**Config** — System connection status (LLM / DB / Vector / Storage), collector management with staleness detection, per-collector setup guides, and skill toggle switches.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy, DuckDB, ChromaDB, Pydantic v2, pydantic-settings, APScheduler, python-docx, PyPDF2, openpyxl |
| Frontend | React 19, Vite 5, TypeScript, Tailwind CSS v4, shadcn/ui (Radix), Recharts |
| AI | LLM Gateway (OpenAI-compatible), SSE streaming, vector search |
| Collectors | Chrome Extension (Manifest V3), VSCode Extension (globalState persistence) |
| Database | SQLite (default), with sequential migration system (Phase 2–8) |

## Architecture

```
EvoWork-AI/
├── app/                        # FastAPI backend
│   ├── main.py                 # Application entry, lifespan, migration runner
│   ├── core/                   # Config, dependencies, gateway interfaces
│   ├── models/                 # SQLAlchemy ORM models
│   ├── schemas/                # Pydantic request/response schemas
│   ├── services/               # Business logic (collector, search, skill engine, AI, event analysis, scheduler, note import)
│   ├── modules/                # API routers (ai, analytics, collectors, events, insights, notes, search, skills)
│   ├── gateways/               # Pluggable LLM/DB/Vector gateway implementations
│   └── migrations/             # Sequential schema migrations (phase 2–8)
├── frontend/                   # React SPA (built by Vite, served by FastAPI)
│   ├── src/pages/              # 7 page components (Dashboard, Events, Skills, AI, Search, Analytics, Config)
│   ├── src/components/         # UI components (shadcn/ui + custom)
│   ├── src/hooks/              # Custom hooks (useToast)
│   └── src/lib/                # API client, utilities
├── collectors/                 # Data collection extensions
│   ├── chrome-extension/       # Chrome Manifest V3 — browser activity tracking
│   └── vscode-extension/       # VSCode — IDE editing activity tracking
├── scripts/                    # Import scripts, hook installers, setup_collectors.py
├── data/                       # SQLite DB, Chroma index, file storage, notes inbox/archive
└── docs/                       # Design documents
```

The frontend is a single-page application with all 7 pages always mounted (CSS `hidden` toggling) to preserve state across navigation. FastAPI serves the built frontend as static files with SPA fallback routing.

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+ (for frontend build)

### Install and Run

```bash
# Clone the repository
git clone https://github.com/yl0911/EvoWork-AI.git
cd EvoWork-AI

# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies and build
cd frontend && npm install && npm run build && cd ..

# Start the server (serves both API and frontend)
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

For active frontend development, run the Vite dev server alongside the backend:

```bash
# Terminal 1: backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2: frontend dev server (HMR)
cd frontend && npm run dev
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

The app works out of the box with SQLite and demo data — no external LLM or vector store required for basic functionality.

## New Machine Setup

When setting up EvoWork on a new computer, use the one-click setup script to configure all data collectors at once:

```bash
# Basic setup (local server, no git repos)
python scripts/setup_collectors.py

# With git repos and remote server
python scripts/setup_collectors.py \
  --server-url http://my-server:8000 \
  --repos ~/code/project-a ~/code/project-b

# With API key authentication
python scripts/setup_collectors.py --api-key my-secret-key

# Skip specific collectors
python scripts/setup_collectors.py --skip-browser --skip-activitywatch
```

The script automatically:

- Installs Git post-commit hooks for specified repositories (with per-repo server URL config in `.git/evowork-env`)
- Installs Shell PROMPT_COMMAND hook to `.bashrc`/`.zshrc` (with auto-detect of shell type)
- Compiles and packages the VSCode extension (generates `.vsix` for installation)
- Detects ActivityWatch and runs an initial data import
- Prints Chrome extension installation instructions

All settings are idempotent — safe to re-run on the same machine.

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```env
# Application
APP_NAME=EvoWork AI
APP_ENV=dev

# Database (SQLite by default)
DATABASE_URL=sqlite:///./data/evowork.db

# LLM Gateway (optional — AI features require a configured LLM)
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=
LLM_MODEL=qwen2.5:14b

# Vector Store (ChromaDB by default)
VECTOR_STORE=chroma
VECTOR_STORE_PATH=./data/chroma

# File Storage
STORAGE_TYPE=local
STORAGE_PATH=./data/files

# Collector Security (leave API_KEY empty to disable auth)
COLLECTOR_API_KEY=
COLLECTOR_MAX_BATCH_SIZE=500

# Note Import (optional — defaults shown below)
NOTES_INBOX_DIR=./data/notes/inbox
NOTES_ARCHIVE_DIR=./data/notes/archive
```

### Collector Security

When `COLLECTOR_API_KEY` is set, all collector endpoints require an `X-API-Key` header. Leave it empty for local development without authentication.

`COLLECTOR_MAX_BATCH_SIZE` limits the number of events per batch request (default: 500). Requests exceeding the limit receive HTTP 413.

## Data Collectors

EvoWork AI supports 6 data sources, each with automated collection. Use the **Config page** to monitor all collector statuses — each one shows event count, last collected time, and a **Stale** warning when data stops flowing.

Quick health check from the command line:

```bash
curl -s http://127.0.0.1:8000/api/collect/status
```

### Git (post-commit hook)

Records every commit with file changes, insertions/deletions, and branch info. Idempotent — safe to re-run.

```bash
python scripts/install_git_hook.py --repo /path/to/your/repo
```

Verify: make a test commit (`git commit --allow-empty -m "test"`) and check the Config page for Git collector event count.

### Shell (PROMPT_COMMAND hook)

Captures terminal commands with exit codes, classifies them (coding/ops/debug/research), filters noise (ls, cd, pwd), and deduplicates within 60s. Supports offline buffering — commands are stored locally and auto-flushed when the server is back.

```bash
python scripts/install_shell_hook.py
# Backfill history:
python scripts/parse_shell_history.py --hours 48
```

> Windows: Uses Git Bash (`~/.bashrc`). The hook captures `PROMPT_COMMAND` output after each command.

### ActivityWatch (window activity, optional)

Imports desktop window focus data, aggregates by (app, title) into sessions, auto-classifies event types via app/URL mappings, and extracts project names from window titles. Requires [ActivityWatch](https://activitywatch.net/) to be installed and running.

```bash
# Verify ActivityWatch is running:
curl http://localhost:5600/api/0/buckets

# Import recent data:
python scripts/activitywatch_import.py --evowork-url http://127.0.0.1:8000 --hours 24

# Scheduled import (Windows Task Scheduler or cron):
# 0 */6 * * * python scripts/activitywatch_import.py --evowork-url http://127.0.0.1:8000 --hours 6
```

### Browser Extension (Chrome/Edge)

Tracks page visit duration and URL patterns. See [collectors/chrome-extension/README.md](collectors/chrome-extension/README.md) for full installation guide.

1. `chrome://extensions/` → Enable Developer mode → Load unpacked → Select `collectors/chrome-extension/`
2. Pin the extension icon, click it to configure server URL (default `http://localhost:8000`)
3. Browse pages (>10s each) → Click "Send Now" → Check Config page for events

> **Tip:** If data stops flowing, click the "Service Worker" link in `chrome://extensions` to check console logs. Manifest V3 service workers may be terminated by Chrome after inactivity.

### IDE Extension (VSCode)

Tracks file editing activity with language detection, project inference, and line change metrics. See [collectors/vscode-extension/README.md](collectors/vscode-extension/README.md) for full installation guide.

```bash
cd collectors/vscode-extension
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
```

Install the generated `.vsix` in VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX...". Configure `evowork.serverUrl` in VS Code Settings.

> PowerShell users: use `;` instead of `&&` to chain commands.

### Collector Staleness

The Config page monitors collector health and shows a **Stale** warning when a collector hasn't received data within its expected window:

| Source | Stale Threshold |
|---|---|
| Git | 48 hours |
| Shell | 24 hours |
| ActivityWatch | 6 hours |
| Browser | 24 hours |
| IDE | 24 hours |

### Data Collection Model

EvoWork uses a **push-based** architecture — the server never polls for data. Each collector pushes events to the API when triggered:

| Source | Trigger | Frequency |
|---|---|---|
| Git | `post-commit` hook fires on every `git commit` | Per commit |
| Shell | `PROMPT_COMMAND` hook fires after each command | Per command (with offline buffer) |
| ActivityWatch | `activitywatch_import.py` script (manual or scheduled) | User-configured (e.g. every 6h) |
| Browser | Chrome extension internal timer | Every 5 minutes |
| IDE | VSCode extension internal timer | Every 5 minutes |
| Manual | User creates via Events page | On demand |
| Note Import | Inbox scan or file upload via Events page | On demand (manual or scheduled) |

## API Overview

All API endpoints are prefixed with `/api`:

| Module | Endpoints | Description |
|---|---|---|
| Events | `/api/events` | CRUD for work events, revision history |
| Collectors | `/api/collect/*` | Git, shell, ActivityWatch, browser, IDE ingestion |
| AI | `/api/ai/*` | Chat streaming, conversation management |
| Skills | `/api/skills/*` | CRUD, recommendations, backfill, pattern mining, usage tracking |
| Analytics | `/api/analytics/*` | Dashboard stats, timeline, engine queries |
| Notes | `/api/notes/*` | Inbox scan, file upload, import history, open folder |
| Search | `/api/search/*` | Hybrid FTS5+vector search, hot terms |

Interactive API docs available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) (Swagger UI).

## Development

### Backend Development

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend Development

```bash
cd frontend && npm run dev    # Vite dev server with HMR on port 5173
```

The Vite dev server proxies `/api` requests to the backend at `localhost:8000`.

### Database Migrations

Schema changes use sequential migration scripts (`app/migrations/migrate_phase*.py`), executed automatically at startup. New columns require explicit `ALTER TABLE` — `create_all()` only creates tables that don't exist yet. Phase 8 adds the `imported_notes` table for note import tracking.

## License

Private repository — all rights reserved.

