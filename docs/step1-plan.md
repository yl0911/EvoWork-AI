## EvoWork AI 第一步：基础层加固实施方案

### 总体目标

将现有 Demo 重构为 Gateway 可插拔架构，增强数据模型，接入 DuckDB + Chroma，前端迁移至 React + Vite。完成后项目具备：三层事件模型、三类 Skill 模型、LLM/DB/Vector 三个 Gateway 可独立切换、语义检索能力、高性能统计分析。

---

### Phase 1：项目结构与配置重构

> 目标：建立 Gateway 模式的目录结构，配置系统升级，为后续所有模块提供基础。

#### 1.1 目录重构

当前结构：

```
app/
├── api/routes.py          # 所有路由在一个文件
├── core/config.py         # 自定义 .env 解析器
├── db/session.py          # SQLAlchemy 直连
├── models/                # ORM 模型
├── schemas/               # Pydantic 模型
├── services/              # 业务逻辑混在一起
└── static/                # vanilla 前端
```

目标结构：

```
app/
├── main.py
├── core/
│   ├── config.py              # Pydantic Settings（替换自定义解析器）
│   ├── constants.py           # 共享常量（PERIOD_DAYS 等，消除 ai_analysis/insights 重复）
│   └── dependencies.py        # FastAPI Depends 注入（Gateway 实例化）
├── gateways/
│   ├── __init__.py
│   ├── base.py                # Gateway 抽象基类
│   ├── llm/
│   │   ├── __init__.py
│   │   ├── base.py            # LLMGateway 抽象接口
│   │   └── openai_compat.py   # OpenAI-compatible 实现（迁移现有 llm_gateway.py）
│   ├── db/
│   │   ├── __init__.py
│   │   ├── base.py            # DBGateway 抽象接口
│   │   └── sqlalchemy_impl.py # SQLAlchemy 实现（迁移现有 session.py）
│   └── vector/
│       ├── __init__.py
│       ├── base.py            # VectorGateway 抽象接口
│       └── chroma_impl.py     # ChromaDB 实现
├── models/                    # ORM 模型（增强）
├── schemas/                   # Pydantic 模型（增强）
├── modules/
│   ├── events/
│   │   ├── router.py          # 事件相关 API
│   │   └── service.py         # 事件业务逻辑
│   ├── skills/
│   │   ├── router.py
│   │   └── service.py
│   ├── insights/
│   │   ├── router.py
│   │   └── service.py         # 重构为使用 DuckDB
│   └── ai/
│       ├── router.py
│       ├── review_service.py  # AI 复盘
│       └── skill_draft.py     # AI Skill 草稿
├── static/                    # 保留（迁移期间可并行提供旧前端）
└── __init__.py
```

#### 1.2 配置系统升级

当前 `config.py` 用自定义解析器读 `.env`，字段硬编码。升级为 `pydantic-settings`：

```python
# app/core/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # App
    app_env: str = "dev"
    app_secret_key: str = "change-me"

    # LLM Gateway
    llm_provider: str = "openai_compatible"
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"

    # Database
    database_url: str = "sqlite:///./data/evowork.db"

    # Vector Store
    vector_store: str = "chroma"
    vector_store_path: str = "./data/chroma"
    vector_store_url: str = ""

    # File Storage
    storage_type: str = "local"
    storage_path: str = "./data/files"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()
```

好处：类型安全、自动验证、IDE 提示、后续切服务只改 .env。

#### 1.3 依赖注入

```python
# app/core/dependencies.py
from functools import lru_cache
from app.gateways.llm.openai_compat import OpenAICompatGateway
from app.gateways.db.sqlalchemy_impl import SQLAlchemyGateway
from app.gateways.vector.chroma_impl import ChromaVectorGateway

@lru_cache
def get_llm_gateway():
    return OpenAICompatGateway(...)

@lru_cache
def get_db_gateway():
    return SQLAlchemyGateway(...)

@lru_cache
def get_vector_gateway():
    return ChromaVectorGateway(...)
```

**新增依赖**：`pydantic-settings`

---

### Phase 2：数据模型增强

> 目标：WorkEvent 支持三层分类，Skill 模型增强字段，对齐 AI 生成与模型持久化。

#### 2.1 WorkEvent 三层模型

当前 WorkEvent 是扁平的 14 字段结构。需要增加分层抽象：

```
Layer 1 - 习惯事件 (habit)
  关注：时间、工具、频率、切换模式
  特点：不关心内容细节，只做画像
  
Layer 2 - 问题事件 (problem)
  关注：报错、调试、搜索、方案设计
  特点：能拿到细节才分析，有项目/标签关联
  
Layer 3 - 结果事件 (result)
  关注：是否解决、用了多久、产出了什么
  特点：关联到问题事件，追踪闭环
```

字段变更方案：

```python
# 新增字段
event_layer: str          # "habit" | "problem" | "result"  —— 三层分类
parent_event_id: str      # 可选，结果事件关联到问题事件
artifacts: JSON           # 附件引用（日志文件路径、截图等）
ai_summary: str           # AI 自动生成的事件摘要

# 扩展 event_type 枚举
# 习惯层: "app_usage" | "browser" | "context_switch"
# 问题层: "debug" | "search" | "coding" | "reading" | "design" | "error"
# 结果层: "resolved" | "unresolved" | "partial" | "abandoned"

# 现有 outcome 字段保留，语义调整为结果层专用
```

向后兼容策略：现有事件的 `event_layer` 默认为 `"problem"`（现有 Demo 数据都是问题类），不破坏已有功能。

#### 2.2 Skill 模型增强

当前 Skill 的 `steps/inputs/outputs` 三个 JSON 字段对三类 Skill 来说粒度不够。增强方案：

```python
# 现有字段保留
id, name, category, trigger, content, steps, inputs, outputs, source

# 新增字段
skill_layer: str              # "thinking" | "reusable" | "open_source"（与 category 对齐）
methods: JSON                 # 思路型：方法论描述（参考站点、资料、思考路径）
success_criteria: str         # 可复用型：成功判断标准
failure_fallback: str         # 可复用型：失败回退方案
agent_assistable: bool        # 是否可被 Agent 辅助执行
agent_assistable_parts: JSON  # Agent 可辅助的具体环节
usage_count: int = 0          # 使用次数
avg_effectiveness: float = 0  # 平均有效性评分
```

对齐 AI skill-draft 生成的字段（当前 prompt 生成了 success_criteria、failure_fallback、agent_assistable_parts 但模型存不下）。

#### 2.3 新增模型

```python
# models/event_embedding.py - 事件向量索引记录
class EventEmbedding:
    id: str
    event_id: str        # 关联 WorkEvent
    content: str         # 被向量化前的文本
    embedding_model: str # 使用的 embedding 模型
    created_at: datetime

# models/skill_usage_log.py - Skill 使用记录（效果验证用）
class SkillUsageLog:
    id: str
    skill_id: str
    event_id: str        # 触发使用的关联事件
    outcome: str         # "effective" | "ineffective" | "partial"
    time_saved_minutes: int
    notes: str
    used_at: datetime
```

---

### Phase 3：数据层集成（DuckDB + Chroma）

> 目标：统计分析用 DuckDB 提速，语义检索用 Chroma 落地。

#### 3.1 DuckDB 统计分析引擎

当前 `insights.py` 用 SQLAlchemy 做聚合查询（COUNT、SUM、GROUP BY），数据量小时没问题，但事件量增长后性能会下降，且复杂分析（窗口函数、同比环比）SQLAlchemy 表达力不足。

实现方案：

```python
# gateways/db/analytics.py
import duckdb

class AnalyticsEngine:
    """基于 DuckDB 的分析引擎，直接读取 SQLite 数据做复杂分析"""
    
    def __init__(self, sqlite_path: str):
        self.conn = duckdb.connect(":memory:")
        self.sqlite_path = sqlite_path
    
    def _load_events(self, period: str):
        """从 SQLite 加载指定周期的事件到 DuckDB"""
        self.conn.execute(f"""
            CREATE TABLE events AS 
            SELECT * FROM read_sqlite('{self.sqlite_path}', 
                'SELECT * FROM work_events WHERE started_at >= ?')
        """, [period_start_date])
    
    def time_distribution(self, group_by: str = "event_type"):
        """时间分布分析"""
    
    def habit_profile(self):
        """习惯画像：搜索/编码/阅读/总结时间比例"""
    
    def repeated_problems(self, threshold: int = 2):
        """重复问题识别"""
    
    def trend_analysis(self):
        """趋势分析：同比/环比"""
    
    def efficiency_metrics(self):
        """效率指标：同类问题解决耗时变化"""
```

DuckDB 的优势：直接读 SQLite 文件、SQL 分析能力强（窗口函数、CTE、pivot）、无需额外服务。

重构 `insights.py`：现有规则引擎保留作为快速路径（小数据集），DuckDB 作为深度分析路径（大数据集 + 复杂查询），通过配置切换。

#### 3.2 Chroma 向量检索

```python
# gateways/vector/chroma_impl.py
import chromadb

class ChromaVectorGateway:
    def __init__(self, persist_path: str, collection_name: str = "evowork"):
        self.client = chromadb.PersistentClient(path=persist_path)
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )
    
    def index_event(self, event_id: str, content: str, metadata: dict):
        """索引事件到向量库"""
    
    def index_skill(self, skill_id: str, content: str, metadata: dict):
        """索引 Skill 到向量库"""
    
    def search_similar(self, query: str, top_k: int = 5, 
                       filter_type: str = None) -> list:
        """语义相似搜索，可按类型过滤（event/skill）"""
    
    def search_experience(self, problem_description: str) -> list:
        """搜索类似问题的历史经验"""
```

索引策略：
- 事件写入时自动索引（`content` + `title` + `tags` 拼接为向量化文本）
- Skill 创建/更新时自动索引
- 隐私级别为 `private` 的内容不索引（与 AI 分析保持一致）

新增 API 端点：
```
POST /api/search?q=关键词&top_k=5
  → 语义搜索事件和 Skill
GET /api/experience?problem=描述
  → 搜索历史类似问题的解决经验
```

**新增依赖**：`chromadb`、`duckdb`

---

### Phase 4：API 层重构

> 目标：路由按模块拆分，补全 CRUD，增加 Gateway 健康检查。

#### 4.1 路由模块化

```python
# app/main.py
from app.modules.events.router import events_router
from app.modules.skills.router import skills_router
from app.modules.insights.router import insights_router
from app.modules.ai.router import ai_router

app.include_router(events_router, prefix="/api")
app.include_router(skills_router, prefix="/api")
app.include_router(insights_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
```

#### 4.2 补全 CRUD

当前缺少编辑/更新接口，补全：

```
PATCH /api/events/{event_id}     # 更新事件（修改 outcome、补充内容等）
PATCH /api/skills/{skill_id}     # 更新 Skill（编辑步骤、标记使用等）
POST  /api/skills/{skill_id}/use # 记录 Skill 使用（关联到 SkillUsageLog）
```

#### 4.3 Gateway 健康检查

```
GET /api/health/llm      # LLM 连接状态
GET /api/health/db       # 数据库连接状态
GET /api/health/vector   # 向量库连接状态
GET /api/health/analytics # DuckDB 分析引擎状态
```

每个端点返回：`{ "status": "ok" | "error", "provider": "...", "detail": "..." }`

---

### Phase 5：前端迁移（React + Vite）

> 目标：从 vanilla HTML/CSS/JS 迁移到 React + Vite + shadcn/ui + TailwindCSS。

#### 5.1 项目初始化

```bash
# 在 EvoWork-AI/frontend/ 创建独立前端项目
cd /d/yl/project/EvoWork-AI
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npx shadcn@latest init
```

#### 5.2 页面映射

| 现有 Tab | React 页面/组件 | shadcn 组件 |
|---------|---------------|------------|
| Dashboard 概览 | `pages/Dashboard.tsx` | Card, Chart (Recharts), Badge |
| Events 事件 | `pages/Events.tsx` | DataTable, Dialog, Form, Select, Badge |
| Skills | `pages/Skills.tsx` | Card, Dialog, Form, Tabs (三类切换) |
| Config 连接 | `pages/Config.tsx` | Card, Badge, Button |
| *(新增)* Timeline | `pages/Timeline.tsx` | 自定义时间线组件 |
| *(新增)* Search | `pages/Search.tsx` | Input, SearchResults |
| *(新增)* Agent Tasks | `pages/AgentTasks.tsx` | Card, StatusBadge |

#### 5.3 开发代理配置

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
})
```

后端保持 8000 端口，前端 3000 端口，开发期间通过 Vite proxy 转发。

#### 5.4 构建与部署

生产构建：`npm run build` → 输出到 `frontend/dist/`
后端静态服务：FastAPI 挂载 `frontend/dist/` 目录，单端口部署。

---

### 任务依赖图

```
Phase 1（结构重构）
  ├── 1.1 目录重构
  ├── 1.2 配置升级 ← 依赖 1.1
  └── 1.3 依赖注入 ← 依赖 1.2
  
Phase 2（模型增强）← 依赖 Phase 1
  ├── 2.1 WorkEvent 三层模型
  ├── 2.2 Skill 模型增强 ← 可与 2.1 并行
  └── 2.3 新增模型 ← 依赖 2.1
  
Phase 3（数据层）← 依赖 Phase 1
  ├── 3.1 DuckDB 分析引擎 ← 可与 3.2 并行
  └── 3.2 Chroma 向量检索 ← 可与 3.1 并行
  
Phase 4（API 重构）← 依赖 Phase 2 + Phase 3
  ├── 4.1 路由模块化
  ├── 4.2 补全 CRUD ← 依赖 4.1
  └── 4.3 健康检查 ← 依赖 4.1

Phase 5（前端迁移）← 可与 Phase 2/3 并行启动
  ├── 5.1 项目初始化
  ├── 5.2 页面开发 ← 依赖 5.1，参考 Phase 4 API
  ├── 5.3 代理配置 ← 依赖 5.1
  └── 5.4 构建部署 ← 依赖 5.2
```

**关键路径**：Phase 1 → Phase 2 → Phase 4 → 联调。Phase 3 和 Phase 5 可并行推进。

---

### 新增依赖清单

| 包 | 用途 | 优先级 |
|---|------|-------|
| `pydantic-settings` | 配置管理 | Phase 1 |
| `duckdb` | 统计分析引擎 | Phase 3 |
| `chromadb` | 向量检索 | Phase 3 |
| `alembic` | 数据库迁移 | Phase 1（可选） |

**前端依赖**（独立 package.json）：
| 包 | 用途 |
|---|------|
| `react` + `react-dom` | UI 框架 |
| `vite` | 构建工具 |
| `tailwindcss` | 样式 |
| `shadcn/ui` | 组件库 |
| `recharts` | 图表 |
| `@tanstack/react-query` | 数据请求 |
| `lucide-react` | 图标 |

---

### 预估工作量

| Phase | 预估 | 备注 |
|-------|------|------|
| Phase 1 结构重构 | 1 轮对话 | 主要是文件搬运和配置改写 |
| Phase 2 模型增强 | 1 轮对话 | ORM 字段新增 + Schema 同步 |
| Phase 3 数据层 | 1-2 轮对话 | DuckDB + Chroma 各一个实现 |
| Phase 4 API 重构 | 1 轮对话 | 路由拆分 + 新端点 |
| Phase 5 前端迁移 | 2-3 轮对话 | 最大工作量，页面逐个迁移 |

Phase 1-4 可以在 2-3 轮对话内完成后端重构。Phase 5 前端迁移是最大工程量，建议后端稳定后再集中做。
