const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

export const api = {
  // Events
  listEvents: (params?: { project?: string; event_type?: string; event_layer?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.project) qs.set('project', params.project);
    if (params?.event_type) qs.set('event_type', params.event_type);
    if (params?.event_layer) qs.set('event_layer', params.event_layer);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<any[]>(`/events${q ? `?${q}` : ''}`);
  },
  createEvent: (data: any) => request<any>('/events', { method: 'POST', body: JSON.stringify(data) }),
  updateEvent: (id: string, data: any) => request<any>(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteEvent: (id: string) => request<any>(`/events/${id}`, { method: 'DELETE' }),
  eventHistory: (id: string) => request<any[]>(`/events/${id}/history`),

  // Skills
  listSkills: (category?: string, system?: boolean) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (system !== undefined) params.set('system', String(system));
    const q = params.toString();
    return request<any[]>(`/skills${q ? `?${q}` : ''}`);
  },
  createSkill: (data: any) => request<any>('/skills', { method: 'POST', body: JSON.stringify(data) }),
  updateSkill: (id: string, data: any) => request<any>(`/skills/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSkill: (id: string) => request<any>(`/skills/${id}`, { method: 'DELETE' }),
  toggleSkill: (id: string) => request<any>(`/skills/${id}/toggle`, { method: 'PATCH' }),
  useSkill: (id: string, data: any) => request<any>(`/skills/${id}/use`, { method: 'POST', body: JSON.stringify(data) }),
  skillRecommendations: (limit = 10) => request<any>(`/skills/recommendations?limit=${limit}`),
  skillLinkedEvents: (id: string, limit = 50) => request<any>(`/skills/${id}/events?limit=${limit}`),
  backfillSkillLinks: () => request<any>('/skills/backfill', { method: 'POST' }),
  mineSkills: (days = 30, maxCandidates = 5, useLlm = true) =>
    request<any>(`/skills/mine?days=${days}&max_candidates=${maxCandidates}&use_llm=${useLlm}`, { method: 'POST' }),
  minePatterns: (days = 30, minCount = 3) =>
    request<any>(`/skills/mine/patterns?days=${days}&min_count=${minCount}`),
  confirmMinedSkill: (data: any) =>
    request<any>('/skills/mine/confirm', { method: 'POST', body: JSON.stringify(data) }),
  skillUsageLogs: (id: string, limit = 20) =>
    request<any>(`/skills/${id}/usage-logs?limit=${limit}`),

  // Insights
  insightsSummary: (period: string) => request<any>(`/insights/summary?period=${period}`),

  // AI
  periodReview: (period: string, refresh = false) =>
    request<any>('/ai/period-review', { method: 'POST', body: JSON.stringify({ period, refresh }) }),
  skillDraft: (period: string, tag?: string, refresh = false) =>
    request<any>('/ai/skill-draft', { method: 'POST', body: JSON.stringify({ period, tag, refresh }) }),
  chatStream: (messages: { role: string; content: string }[], period = 'week') =>
    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, period }),
    }),
  listConversations: () => request<any[]>('/ai/conversations'),
  createConversation: (period: string) =>
    request<any>('/ai/conversations', { method: 'POST', body: JSON.stringify({ period }) }),
  deleteConversation: (id: string) =>
    request<any>(`/ai/conversations/${id}`, { method: 'DELETE' }),
  loadMessages: (convId: string) => request<any[]>(`/ai/conversations/${convId}/messages`),
  saveMessages: (convId: string, messages: { role: string; content: string }[]) =>
    request<any>(`/ai/conversations/${convId}/messages`, {
      method: 'POST', body: JSON.stringify({ messages }),
    }),

  // Search
  search: (q: string, params?: { topK?: number; scope?: string; source?: string; eventType?: string; project?: string }) => {
    const qs = new URLSearchParams({ q, top_k: String(params?.topK ?? 20) });
    if (params?.scope) qs.set('scope', params.scope);
    if (params?.source) qs.set('source', params.source);
    if (params?.eventType) qs.set('event_type', params.eventType);
    if (params?.project) qs.set('project', params.project);
    return request<any>(`/search?${qs}`);
  },
  searchExperience: (problem: string, topK = 10) =>
    request<any>(`/experience?problem=${encodeURIComponent(problem)}&top_k=${topK}`),
  reindex: () => request<any>('/search/reindex', { method: 'POST' }),
  hotTerms: () => request<any>('/search/hot'),

  // Analytics
  fullAnalysis: (period: string) => request<any>(`/analytics/full?period=${period}`),
  shellAnalysis: (period: string) => request<any>(`/analytics/shell?period=${period}`),
  workPatterns: (period: string) => request<any>(`/analytics/patterns?period=${period}`),
  timeline: (period: string, groupBy = 'project') => request<any>(`/analytics/timeline?period=${period}&group_by=${groupBy}`),

  // System
  health: () => request<any>('/health'),
  config: () => request<any>('/config'),
  updateConfig: (data: Record<string, any>) =>
    request<any>('/config', { method: 'PUT', body: JSON.stringify(data) }),
  llmHealth: () => request<any>('/llm/health'),
  dbHealth: () => request<any>('/health/db'),
  vectorHealth: () => request<any>('/health/vector'),

  // Collectors
  collectorStatus: () => request<any>('/collect/status'),
};
