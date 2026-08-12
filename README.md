# EvoWork AI

EvoWork AI is a local-first work and learning evolution assistant. The first demo focuses on Work Events, habit insights, Skill management, and reserved connectors for LLM, database, and vector services.

## Current Demo Scope

- Work Event timeline and manual event creation
- Weekly/monthly/yearly insight summary
- Three Skill categories:
  - Thinking Skill
  - Reusable Skill
  - Open Source Skill
- Configurable LLM/DB/vector connection placeholders
- FastAPI backend with SQLite default storage
- Lightweight built-in frontend served by FastAPI

## Run

```powershell
D:\anaconda3\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Then open:

```text
http://127.0.0.1:8000
```

## Configuration

Copy `.env.example` to `.env` when you want to override defaults.

```env
DATABASE_URL=sqlite:///./data/evowork.db
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:14b
VECTOR_STORE=chroma
VECTOR_STORE_PATH=./data/chroma
```

The demo does not require local LLM or external DB services to start. It only reserves connection fields and health states.

