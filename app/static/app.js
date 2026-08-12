const state = {
  period: "week",
  events: [],
  skills: [],
  insights: null,
  config: null,
  aiOutput: "",
  aiResults: {},
  activeAiKind: null,
  activeAiMeta: null,
};

const titles = {
  dashboard: ["工作概览", "WorkEvent / Insight / Skill"],
  events: ["事件时间线", "Manual / Browser / IDE / AI Chat"],
  skills: ["Skill 中心", "Thinking / Reusable / Open Source"],
  config: ["连接配置", "LLM / Database / Vector / Storage"],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function formatMinutes(minutes) {
  if (!minutes) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

async function loadAll() {
  const [events, skills, insights, config] = await Promise.all([
    api("/api/events"),
    api("/api/skills"),
    api(`/api/insights/summary?period=${state.period}`),
    api("/api/config"),
  ]);
  state.events = events;
  state.skills = skills;
  state.insights = insights;
  state.config = config;
  render();
}

function render() {
  renderMetrics();
  renderBars("type-bars", state.insights?.event_type_minutes || {}, "green");
  renderBars("source-bars", state.insights?.source_minutes || {}, "blue");
  renderDailyBars();
  renderNotes();
  renderEvents();
  renderSkills();
  renderConfig();
  renderAiOutput();
}

function renderMetrics() {
  $("#metric-events").textContent = state.insights?.total_events ?? 0;
  $("#metric-minutes").textContent = formatMinutes(state.insights?.total_minutes ?? 0);
  $("#metric-skills").textContent = state.insights?.skill_count ?? 0;
  $("#metric-tags").textContent = state.insights?.repeated_tags?.length ?? 0;
}

function renderBars(containerId, data, color) {
  const container = document.getElementById(containerId);
  const entries = Object.entries(data);
  if (!entries.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...entries.map(([, value]) => value), 1);
  container.innerHTML = entries
    .map(([label, value]) => {
      const width = Math.max(4, Math.round((value / max) * 100));
      const fill = color === "blue" ? "var(--blue)" : "var(--green)";
      return `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%;background:${fill}"></span></span>
          <span class="bar-value">${formatMinutes(value)}</span>
        </div>
      `;
    })
    .join("");
}

function renderDailyBars() {
  const container = $("#daily-bars");
  const data = state.insights?.daily_minutes || {};
  const entries = Object.entries(data);
  if (!entries.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...entries.map(([, value]) => value), 1);
  container.innerHTML = entries
    .map(([date, value]) => {
      const height = Math.max(8, Math.round((value / max) * 110));
      return `
        <div class="daily-bar">
          <div class="daily-stick" style="height:${height}px"></div>
          <span>${date.slice(5)}</span>
        </div>
      `;
    })
    .join("");
}

function renderNotes() {
  const notes = state.insights?.insight_notes || [];
  $("#insight-notes").innerHTML = notes.length
    ? notes.map((note) => `<div class="note-item">${escapeHtml(note)}</div>`).join("")
    : `<div class="empty">暂无洞察</div>`;
}

function renderAiOutput() {
  const output = $("#ai-output");
  if (!output) return;
  renderAiCacheState();
  if (!state.aiOutput) {
    output.innerHTML = `<div class="ai-placeholder">点击上方按钮生成复盘或 Skill 草稿。</div>`;
    return;
  }
  output.innerHTML = renderMarkdown(state.aiOutput);
}

function renderAiCacheState() {
  const label = $("#ai-cache-state");
  const button = $("#regenerate-ai");
  if (!label || !button) return;
  button.disabled = !state.activeAiKind;
  if (!state.activeAiKind) {
    label.textContent = "未生成";
    return;
  }
  const title = state.activeAiKind === "period-review" ? "复盘" : "Skill 草稿";
  if (!state.activeAiMeta) {
    label.textContent = `${title} / 准备中`;
    return;
  }
  const source = state.activeAiMeta.cached ? "缓存" : "新生成";
  label.textContent = `${title} / ${source} / ${state.period}`;
}

function renderEvents() {
  const container = $("#event-list");
  if (!state.events.length) {
    container.innerHTML = `<div class="empty">暂无事件</div>`;
    return;
  }
  container.innerHTML = state.events
    .map(
      (event) => `
      <article class="event-item">
        <div class="item-head">
          <div>
            <div class="item-title">${escapeHtml(event.title)}</div>
            <div class="item-meta">
              ${formatDate(event.started_at)} / ${escapeHtml(event.event_type)} / ${escapeHtml(event.source)} / ${formatMinutes(event.duration_minutes)}
            </div>
          </div>
          <button class="danger-button" type="button" data-delete-event="${event.id}">删除</button>
        </div>
        ${event.content ? `<div class="item-content">${escapeHtml(event.content)}</div>` : ""}
        <div class="tags">
          <span class="pill">${escapeHtml(event.outcome)}</span>
          ${(event.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </article>
    `,
    )
    .join("");
}

function renderSkills() {
  const container = $("#skill-list");
  if (!state.skills.length) {
    container.innerHTML = `<div class="empty">暂无 Skill</div>`;
    return;
  }
  container.innerHTML = state.skills
    .map(
      (skill) => `
      <article class="skill-item">
        <div class="item-head">
          <div>
            <div class="item-title">${escapeHtml(skill.name)}</div>
            <div class="item-meta">${escapeHtml(skill.category)} / ${escapeHtml(skill.source)}</div>
          </div>
          <button class="danger-button" type="button" data-delete-skill="${skill.id}">删除</button>
        </div>
        ${skill.trigger ? `<div class="item-content">${escapeHtml(skill.trigger)}</div>` : ""}
        ${
          skill.steps?.length
            ? `<ol class="item-content">${skill.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`
            : ""
        }
        ${skill.content ? `<div class="item-content">${escapeHtml(skill.content)}</div>` : ""}
      </article>
    `,
    )
    .join("");
}

function renderConfig() {
  if (!state.config) return;
  fillConfig("llm-config", {
    provider: state.config.llm.provider,
    base_url: state.config.llm.base_url || "未配置",
    model: state.config.llm.model || "未配置",
    api_key: state.config.llm.api_key_configured ? "已配置" : "未配置",
  });
  fillConfig("db-config", {
    url: state.config.database.url,
    configured: state.config.database.configured ? "已配置" : "未配置",
  });
  fillConfig("vector-config", {
    store: state.config.vector.store,
    path: state.config.vector.path || "未配置",
    url: state.config.vector.url || "未配置",
  });
  fillConfig("storage-config", {
    type: state.config.storage.type,
    path: state.config.storage.path,
  });
}

function fillConfig(id, values) {
  document.getElementById(id).innerHTML = Object.entries(values)
    .map(
      ([key, value]) => `
      <div>
        <dt>${escapeHtml(key)}</dt>
        <dd>${escapeHtml(String(value))}</dd>
      </div>
    `,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = null;

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length >= 4 ? 4 : 3;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const numberedHeading = line.match(/^\d+\.\s+(.+)$/);
    const sectionHeadingPattern = /^(本周期|观察到|可能的|建议沉淀|下一步|工作\/学习|习惯模式|认知卡点|技术壁垒)/;
    if (numberedHeading && sectionHeadingPattern.test(numberedHeading[1])) {
      closeList();
      html.push(`<h3>${renderInlineMarkdown(numberedHeading[1])}</h3>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function bindNavigation() {
  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      $$(".nav-tab").forEach((item) => item.classList.toggle("active", item === button));
      $$(".view").forEach((item) => item.classList.toggle("active", item.id === view));
      $("#view-title").textContent = titles[view][0];
      $("#view-subtitle").textContent = titles[view][1];
    });
  });

  $$(".period-button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.period = button.dataset.period;
      $$(".period-button").forEach((item) => item.classList.toggle("active", item === button));
      state.insights = await api(`/api/insights/summary?period=${state.period}`);
      restoreAiFromSessionCache();
      render();
    });
  });
}

function bindForms() {
  $("#event-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: form.get("title"),
      event_type: form.get("event_type"),
      source: form.get("source"),
      project: form.get("project") || null,
      duration_minutes: Number(form.get("duration_minutes") || 0),
      outcome: form.get("outcome"),
      privacy_level: form.get("privacy_level"),
      tags: splitTags(form.get("tags")),
      content: form.get("content") || null,
    };
    await api("/api/events", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    event.currentTarget.duration_minutes.value = 30;
    clearAiSessionCache();
    showToast("事件已添加");
    await loadAll();
  });

  $("#skill-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      category: form.get("category"),
      source: form.get("source"),
      trigger: form.get("trigger") || null,
      steps: splitLines(form.get("steps")),
      content: form.get("content") || null,
      inputs: [],
      outputs: [],
    };
    await api("/api/skills", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    showToast("Skill 已添加");
    await loadAll();
  });

  $("#refresh-events").addEventListener("click", loadAll);
  $("#refresh-skills").addEventListener("click", loadAll);
  $("#generate-review").addEventListener("click", async () => {
    await runAiAction("period-review");
  });
  $("#generate-skill-draft").addEventListener("click", async () => {
    await runAiAction("skill-draft");
  });
  $("#regenerate-ai").addEventListener("click", async () => {
    if (state.activeAiKind) {
      await runAiAction(state.activeAiKind, { refresh: true });
    }
  });

  document.body.addEventListener("click", async (event) => {
    const eventId = event.target.dataset?.deleteEvent;
    const skillId = event.target.dataset?.deleteSkill;
    if (eventId) {
      await api(`/api/events/${eventId}`, { method: "DELETE" });
      clearAiSessionCache();
      showToast("事件已删除");
      await loadAll();
    }
    if (skillId) {
      await api(`/api/skills/${skillId}`, { method: "DELETE" });
      showToast("Skill 已删除");
      await loadAll();
    }
  });
}

function aiCacheKey(kind) {
  return `${kind}:${state.period}`;
}

function clearAiSessionCache() {
  state.aiResults = {};
  state.activeAiKind = null;
  state.activeAiMeta = null;
  state.aiOutput = "";
}

function restoreAiFromSessionCache() {
  if (!state.activeAiKind) return;
  const cached = state.aiResults[aiCacheKey(state.activeAiKind)];
  if (cached) {
    state.aiOutput = cached.content;
    state.activeAiMeta = cached;
  } else {
    state.aiOutput = "";
    state.activeAiMeta = null;
  }
}

async function runAiAction(kind, options = {}) {
  const refresh = Boolean(options.refresh);
  state.activeAiKind = kind;
  if (!refresh) {
    const cached = state.aiResults[aiCacheKey(kind)];
    if (cached) {
      state.aiOutput = cached.content;
      state.activeAiMeta = cached;
      renderAiOutput();
      showToast("已使用本页缓存");
      return;
    }
  }

  const buttonId = kind === "period-review" ? "#generate-review" : "#generate-skill-draft";
  const button = $(buttonId);
  const regenButton = $("#regenerate-ai");
  const originalText = button.textContent;
  button.disabled = true;
  if (regenButton) regenButton.disabled = true;
  button.textContent = "生成中";
  state.aiOutput = "AI 正在分析近期事件...";
  state.activeAiMeta = null;
  renderAiOutput();
  try {
    const path = kind === "period-review" ? "/api/ai/period-review" : "/api/ai/skill-draft";
    const result = await api(path, {
      method: "POST",
      body: JSON.stringify({ period: state.period, refresh }),
    });
    state.aiOutput = result.content || "AI 没有返回内容。";
    state.activeAiMeta = {
      content: state.aiOutput,
      cached: Boolean(result.cached),
      cacheKey: result.cache_key,
      model: result.model,
      period: result.period,
      tag: result.tag,
    };
    state.aiResults[aiCacheKey(kind)] = state.activeAiMeta;
    showToast(result.cached ? "已使用缓存结果" : "AI 分析完成");
  } catch (error) {
    state.aiOutput = `AI 分析失败：${error.message}`;
    state.activeAiMeta = { content: state.aiOutput, cached: false, error: true };
    showToast("AI 分析失败");
  } finally {
    button.disabled = false;
    if (regenButton) regenButton.disabled = false;
    button.textContent = originalText;
    renderAiOutput();
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  bindNavigation();
  bindForms();
  try {
    await loadAll();
  } catch (error) {
    showToast(`加载失败：${error.message}`);
    console.error(error);
  }
});
