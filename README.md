# EvoWork AI (智行)

A local-first work and learning evolution assistant. EvoWork AI automatically collects activity data from Git, shell, browser, IDE, and ActivityWatch, then provides AI-powered insights, skill recommendations, and analytics to help you understand and improve your work patterns.

## Features

**Dashboard** — Period-based overview (week/month/year) with key metrics, activity distribution charts, and work pattern summaries.

**Events** — Full-text searchable event timeline with inline editing, revision history, filtering by source/type/tag, and batch import support.

**Skills** — Three-tier skill library (Thinking / Reusable / Open Source) with create, edit, toggle, backfill, pattern mining, and AI-powered recommendations based on 30-day activity analysis.

**AI Assistant** — Conversational interface with SSE streaming, conversation sidebar (create/switch/delete), persistent chat history (survives page navigation and browser refresh), and context-aware quick actions (period review, skill suggestions, data analysis).

**Search** — Hybrid full-text + vector search (FTS5 + ChromaDB) with keyword highlighting, source/type filters, and trending terms.

**Analytics** — Timeline Gantt chart, shell command statistics, work pattern analysis (24h distribution, project switching frequency, active days).

**Config** — System connection status (LLM / DB / Vector / Storage), collector management with staleness detection, per-collector setup guides, and skill toggle switches.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy, DuckDB, ChromaDB, Pydantic v2 |
| Frontend | React 19, Vite 5, TypeScript, Tailwind CSS v4, shadcn/ui (Radix), Recharts |
| AI | LLM Gateway (OpenAI-compatible), SSE streaming, vector search |
| Collectors | Chrome Extension (Manifest V3), VSCode Extension (globalState persistence) |
| Database | SQLite (default), with sequential migration system (Phase 2–6) |

## Architecture

```
EvoWork-AI/
├── app/                        # FastAPI backend
│   ├── main.py                 # Application entry, lifespan, migration runner
│   ├── core/                   # Config, dependencies, gateway interfaces
│   ├── models/                 # SQLAlchemy ORM models
│   ├── schemas/                # Pydantic request/response schemas
│   ├── services/               # Business logic (collector, search, skill engine, AI)
│   ├── modules/                # API routers (ai, analytics, collectors, events, insights, search, skills)
│   ├── gateways/               # Pluggable LLM/DB/Vector gateway implementations
│   └── migrations/             # Sequential schema migrations (phase 2–6)
├── frontend/                   # React SPA (built by Vite, served by FastAPI)
│   ├── src/pages/              # 7 page components (Dashboard, Events, Skills, AI, Search, Analytics, Config)
│   ├── src/components/         # UI components (shadcn/ui + custom)
│   ├── src/hooks/              # Custom hooks (useToast)
│   └── src/lib/                # API client, utilities
├── collectors/                 # Data collection extensions
│   ├── chrome-extension/       # Chrome Manifest V3 — browser activity tracking
│   └── vscode-extension/       # VSCode — IDE editing activity tracking
├── scripts/                    # Import scripts and hook installers
├── data/                       # SQLite DB, Chroma index, file storage
└── docs/                       # Design documents
```

The frontend is a single-page application with all 7 pages always mounted (CSS `hidden` toggling) to preserve state across navigation. FastAPI serves the built frontend as static files with SPA fallback routing.

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+ (for frontend development)

### Install and Run

```bash
# Clone the repository
git clone https://github.com/yl0911/EvoWork-AI.git
cd EvoWork-AI

# Install Python dependencies
pip install -r requirements.txt

# (Optional) Build frontend
cd frontend && npm install && npm run build && cd ..

# Start the server
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

The app works out of the box with SQLite and demo data — no external LLM or vector store required for basic functionality.

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
```

### Collector Security

When `COLLECTOR_API_KEY` is set, all collector endpoints require an `X-API-Key` header. Leave it empty for local development without authentication.

`COLLECTOR_MAX_BATCH_SIZE` limits the number of events per batch request (default: 500). Requests exceeding the limit receive HTTP 413.

## Data Collectors

EvoWork AI supports 6 data sources, each with automated collection:

### Git (post-commit hook)

Records every commit with file changes, insertions/deletions, and branch info.

```bash
python scripts/install_git_hook.py --repo /path/to/your/repo
```

### Shell (PROMPT_COMMAND hook)

Captures terminal commands with exit codes, classifies them (coding/ops/debug/research), filters noise (ls, cd, pwd), and deduplicates within 60s. Supports offline buffering — commands are stored locally and auto-flushed when the server is back.

```bash
python scripts/install_shell_hook.py
# Backfill history:
python scripts/parse_shell_history.py --hours 48
```

### ActivityWatch (window activity)

Imports window focus data, aggregates by (app, title) into sessions, auto-classifies event types via app/URL mappings, and extracts project names from window titles.

```bash
python scripts/activitywatch_import.py --hours 24
# Cron: 0 */6 * * * python scripts/activitywatch_import.py --hours 6
```

### Browser Extension (Chrome/Edge)

Tracks page visit duration and URL patterns. Install from `collectors/chrome-extension/` via Chrome's developer mode. Configure the server URL in the extension popup.

### IDE Extension (VSCode)

Tracks file editing activity with language detection, project inference, and line change metrics. Built with `globalState` persistence to survive extension restarts. Install from `collectors/vscode-extension/`:

```bash
cd collectors/vscode-extension && npm install && npm run compile
npx @vscode/vsce package
# Install the .vsix file in VSCode
```

### Collector Staleness

The Config page monitors collector health and shows a **Stale** warning when a collector hasn't received data within its expected window:

| Source | Stale Threshold |
|---|---|
| Git | 48 hours |
| Shell | 24 hours |
| ActivityWatch | 6 hours |
| Browser | 24 hours |
| IDE | 24 hours |

## API Overview

All API endpoints are prefixed with `/api`:

| Module | Endpoints | Description |
|---|---|---|
| Events | `/api/events` | CRUD for work events, revision history |
| Collectors | `/api/collect/*` | Git, shell, ActivityWatch, browser, IDE ingestion |
| AI | `/api/ai/*` | Chat streaming, conversation management |
| Skills | `/api/skills/*` | CRUD, recommendations, backfill, pattern mining |
| Analytics | `/api/analytics/*` | Dashboard stats, timeline, engine queries |
| Search | `/api/search/*` | Hybrid FTS5+vector search, hot terms |

Interactive API docs available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) (Swagger UI).

## Development

### Frontend Development

```bash
cd frontend
npm install
npm run dev        # Vite dev server with HMR
```

### Backend Development

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Database Migrations

Schema changes use sequential migration scripts (`app/migrations/migrate_phase*.py`), executed automatically at startup. New columns require explicit `ALTER TABLE` — `create_all()` only creates tables that don't exist yet.

## License

Private repository — all rights reserved.

