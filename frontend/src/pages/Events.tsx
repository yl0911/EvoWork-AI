import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Trash2, Plus, Calendar, Pencil, X, Check, History, ChevronDown, ChevronUp, Filter, Search, GitCompare, RotateCcw, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

const EVENT_TYPES = [
  'search', 'debug', 'coding', 'reading', 'writing',
  'design', 'error', 'planning', 'summary', 'note',
  'ops', 'research', 'app_usage', 'browser', 'context_switch',
] as const;

const EVENT_LAYERS = ['habit', 'problem', 'result'] as const;
const SOURCES = ['manual', 'browser', 'ide', 'git', 'shell', 'ai_chat', 'document'] as const;
const OUTCOMES = ['resolved', 'partial', 'unresolved', 'failed'] as const;
const PRIVACY_LEVELS = ['metadata', 'content', 'private'] as const;

const LAYER_VARIANT: Record<string, 'secondary' | 'default' | 'success'> = {
  habit: 'secondary',
  problem: 'default',
  result: 'success',
};

const OUTCOME_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  resolved: 'success',
  partial: 'warning',
  unresolved: 'destructive',
  failed: 'destructive',
};

const EVENT_PAGE_SIZE = 50;

/* Source color mapping */
const SOURCE_COLOR: Record<string, string> = {
  git: '#22c55e',
  shell: '#a855f7',
  manual: '#3b82f6',
  ide: '#f59e0b',
  browser: '#06b6d4',
  ai_chat: '#ec4899',
  document: '#8b5cf6',
};

/* Field display labels */
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  content: 'Content',
  event_type: 'Type',
  event_layer: 'Layer',
  source: 'Source',
  project: 'Project',
  tags: 'Tags',
  duration_minutes: 'Duration',
  outcome: 'Outcome',
  privacy_level: 'Privacy',
  started_at: 'Started At',
  linked_skill_id: 'Linked Skill',
  parent_event_id: 'Parent Event',
  artifacts: 'Artifacts',
  ai_summary: 'AI Summary',
};

interface EventFormData {
  title: string;
  event_type: string;
  event_layer: string;
  source: string;
  project: string;
  duration_minutes: string;
  outcome: string;
  privacy_level: string;
  tags: string;
  content: string;
  started_at: string;
}

const EMPTY_FORM: EventFormData = {
  title: '',
  event_type: 'coding',
  event_layer: 'habit',
  source: 'manual',
  project: '',
  duration_minutes: '',
  outcome: 'resolved',
  privacy_level: 'metadata',
  tags: '',
  content: '',
  started_at: '',
};

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatTime(iso);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

function getDateKey(iso: string | null): string {
  if (!iso) return 'unknown';
  return iso.slice(0, 10);
}

function eventToForm(ev: any): EventFormData {
  return {
    title: ev.title ?? '',
    event_type: ev.event_type ?? 'coding',
    event_layer: ev.event_layer ?? 'habit',
    source: ev.source ?? 'manual',
    project: ev.project ?? '',
    duration_minutes: ev.duration_minutes != null ? String(ev.duration_minutes) : '',
    outcome: ev.outcome ?? 'resolved',
    privacy_level: ev.privacy_level ?? 'metadata',
    tags: Array.isArray(ev.tags) ? ev.tags.join(', ') : '',
    content: ev.content ?? '',
    started_at: ev.started_at ? ev.started_at.slice(0, 16) : '',
  };
}

/* ── Field-type-aware diff renderer ── */
function DiffValue({ field, diff }: { field: string; diff: { old: any; new: any } }) {
  const label = FIELD_LABELS[field] || field;

  // Tags / arrays: show added/removed pills
  if (field === 'tags' || field === 'artifacts') {
    const oldArr: string[] = Array.isArray(diff.old) ? diff.old : [];
    const newArr: string[] = Array.isArray(diff.new) ? diff.new : [];
    const removed = oldArr.filter((v: string) => !newArr.includes(v));
    const added = newArr.filter((v: string) => !oldArr.includes(v));
    const kept = oldArr.filter((v: string) => newArr.includes(v));
    return (
      <div className="flex flex-wrap gap-1">
        {kept.map((v: string) => (
          <span key={v} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px]">{v}</span>
        ))}
        {removed.map((v: string) => (
          <span key={v} className="rounded-full bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] text-red-700 dark:text-red-400 line-through">{v}</span>
        ))}
        {added.map((v: string) => (
          <span key={v} className="rounded-full bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 text-[10px] text-green-700 dark:text-green-400">{v}</span>
        ))}
        {removed.length === 0 && added.length === 0 && (
          <span className="text-[10px] text-muted-foreground">reordered</span>
        )}
      </div>
    );
  }

  // Duration: show with "min" suffix
  if (field === 'duration_minutes') {
    return (
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="line-through text-red-600/70 dark:text-red-400/70">{diff.old ?? 0}m</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium text-green-700 dark:text-green-400">{diff.new ?? 0}m</span>
      </div>
    );
  }

  // Content / long text: block display
  if (field === 'content' || field === 'ai_summary') {
    return (
      <div className="space-y-1">
        {diff.old && (
          <div className="rounded bg-red-50 dark:bg-red-950/20 px-2 py-1 text-[10px] text-red-700 dark:text-red-400 line-through max-h-[60px] overflow-y-auto">
            {String(diff.old).slice(0, 200)}
          </div>
        )}
        <div className="rounded bg-green-50 dark:bg-green-950/20 px-2 py-1 text-[10px] text-green-700 dark:text-green-400 max-h-[60px] overflow-y-auto">
          {String(diff.new ?? '').slice(0, 200) || '(empty)'}
        </div>
      </div>
    );
  }

  // Datetime fields
  if (field === 'started_at') {
    return (
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="line-through text-red-600/70 dark:text-red-400/70">{diff.old ? formatTime(diff.old) : '—'}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium text-green-700 dark:text-green-400">{diff.new ? formatTime(diff.new) : '—'}</span>
      </div>
    );
  }

  // Default: simple old → new
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="line-through text-red-600/70 dark:text-red-400/70">{String(diff.old ?? '—')}</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-medium text-green-700 dark:text-green-400">{String(diff.new ?? '—')}</span>
    </div>
  );
}

/* ── Filter pill component ── */
function FilterPill({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`rounded-full px-1 text-[10px] ${active ? 'bg-primary-foreground/20' : 'bg-background/50'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function Events() {
  const [events, setEvents] = useState<any[]>([]);
  const [form, setForm] = useState<EventFormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  // Filter state
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EventFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // History state
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Expanded events
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Pagination state
  const [totalEvents, setTotalEvents] = useState(0);
  const [eventOffset, setEventOffset] = useState(0);
  const offsetRef = useRef(0);

  // Toast + confirm
  const { toast } = useToast();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchEvents = useCallback(async (append = false) => {
    try {
      const offset = append ? offsetRef.current : 0;
      const res = await api.listEvents({ limit: EVENT_PAGE_SIZE, offset });
      const newEvents = res.events ?? res;
      const total = res.total ?? newEvents.length;

      if (append) {
        setEvents((prev) => [...prev, ...newEvents]);
      } else {
        setEvents(newEvents);
      }

      offsetRef.current = offset + newEvents.length;
      setEventOffset(offsetRef.current);
      setTotalEvents(total);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  /* ── Filtering ── */
  const filteredEvents = useMemo(() => {
    let result = events;
    if (filterSource !== 'all') {
      result = result.filter((e) => e.source === filterSource);
    }
    if (filterType !== 'all') {
      result = result.filter((e) => e.event_type === filterType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          (e.title || '').toLowerCase().includes(q) ||
          (e.project || '').toLowerCase().includes(q) ||
          (e.content || '').toLowerCase().includes(q) ||
          (e.tags || []).some((t: string) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [events, filterSource, filterType, searchQuery]);

  /* ── Group by date ── */
  const groupedEvents = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const ev of filteredEvents) {
      const key = getDateKey(ev.started_at || ev.created_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredEvents]);

  /* ── Source counts ── */
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      const s = e.source || 'manual';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [events]);

  /* ── Active event types ── */
  const activeTypes = useMemo(() => {
    const types: Record<string, number> = {};
    for (const e of events) {
      const t = e.event_type || 'note';
      types[t] = (types[t] || 0) + 1;
    }
    return Object.entries(types)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
  }, [events]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try {
      const payload = {
        ...form,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : undefined,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        started_at: form.started_at || undefined,
      };
      await api.createEvent(payload);
      setForm(EMPTY_FORM);
      await fetchEvents();
      toast({ title: '事件创建成功', variant: 'success' });
    } catch (err: any) {
      toast({ title: '创建失败', description: err?.message || '请稍后重试', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteEvent(id);
      await fetchEvents();
      toast({ title: '事件已删除', variant: 'success' });
    } catch (err: any) {
      toast({ title: '删除失败', description: err?.message || '请稍后重试', variant: 'destructive' });
    }
  };

  // ── Edit ──
  const startEdit = (ev: any) => { setEditingId(ev.id); setEditForm(eventToForm(ev)); };
  const cancelEdit = () => { setEditingId(null); setEditForm(EMPTY_FORM); };
  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setEditForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };
  const saveEdit = async () => {
    if (!editingId || !editForm.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...editForm,
        duration_minutes: editForm.duration_minutes ? Number(editForm.duration_minutes) : undefined,
        tags: editForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
        started_at: editForm.started_at || undefined,
      };
      await api.updateEvent(editingId, payload);
      setEditingId(null);
      await fetchEvents();
      toast({ title: '事件已更新', variant: 'success' });
    } catch (err: any) {
      toast({ title: '更新失败', description: err?.message || '请稍后重试', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── History ──
  const toggleHistory = async (id: string) => {
    if (historyId === id) { setHistoryId(null); setHistoryData([]); return; }
    setHistoryId(id);
    setHistoryLoading(true);
    try {
      const data = await api.eventHistory(id);
      setHistoryData(data);
    } catch { setHistoryData([]); } finally {
      setHistoryLoading(false);
    }
  };

  // ── Expand/collapse ──
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <Calendar className="h-6 w-6" />
        Events
      </h1>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ---- Left: Create form (2 cols) ---- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>New Event</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="title">Title</label>
                <Input id="title" name="title" placeholder="Event title" value={form.title} onChange={handleChange} required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="event_type">Type</label>
                  <select id="event_type" name="event_type" className={selectClass} value={form.event_type} onChange={handleChange}>
                    {EVENT_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="event_layer">Layer</label>
                  <select id="event_layer" name="event_layer" className={selectClass} value={form.event_layer} onChange={handleChange}>
                    {EVENT_LAYERS.map((l) => (<option key={l} value={l}>{l}</option>))}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="source">Source</label>
                  <select id="source" name="source" className={selectClass} value={form.source} onChange={handleChange}>
                    {SOURCES.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="project">Project</label>
                  <Input id="project" name="project" placeholder="Project name" value={form.project} onChange={handleChange} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="duration_minutes">Duration (min)</label>
                  <Input id="duration_minutes" name="duration_minutes" type="number" min={0} placeholder="0" value={form.duration_minutes} onChange={handleChange} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="outcome">Outcome</label>
                  <select id="outcome" name="outcome" className={selectClass} value={form.outcome} onChange={handleChange}>
                    {OUTCOMES.map((o) => (<option key={o} value={o}>{o}</option>))}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="privacy_level">Privacy</label>
                  <select id="privacy_level" name="privacy_level" className={selectClass} value={form.privacy_level} onChange={handleChange}>
                    {PRIVACY_LEVELS.map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="started_at">Started At</label>
                  <Input id="started_at" name="started_at" type="datetime-local" value={form.started_at} onChange={handleChange} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="tags">Tags <span className="text-muted-foreground">(comma-separated)</span></label>
                <Input id="tags" name="tags" placeholder="react, debugging, api" value={form.tags} onChange={handleChange} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="content">Content</label>
                <Textarea id="content" name="content" placeholder="Event details..." value={form.content} onChange={handleChange} />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                {loading ? 'Creating...' : 'Create Event'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ---- Right: Event timeline (3 cols) ---- */}
        <Card className="lg:col-span-3">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                Event Timeline
                <Badge variant="secondary" className="text-xs">{filteredEvents.length}</Badge>
              </CardTitle>
              <div className="flex items-center gap-1">
                <a
                  href={api.exportEvents('json')}
                  download="events.json"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                  title="Export JSON"
                >
                  <Download className="h-3.5 w-3.5" />
                  JSON
                </a>
                <a
                  href={api.exportEvents('csv')}
                  download="events.csv"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                  title="Export CSV"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </a>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {/* Source filter */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <FilterPill label="All" active={filterSource === 'all'} count={events.length} onClick={() => setFilterSource('all')} />
              {Object.entries(sourceCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([src, count]) => (
                  <FilterPill
                    key={src}
                    label={src}
                    active={filterSource === src}
                    count={count}
                    onClick={() => setFilterSource(filterSource === src ? 'all' : src)}
                  />
                ))}
            </div>

            {/* Type filter */}
            {activeTypes.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterPill label="All Types" active={filterType === 'all'} onClick={() => setFilterType('all')} />
                {activeTypes.map(([type, count]) => (
                  <FilterPill
                    key={type}
                    label={type}
                    active={filterType === type}
                    count={count}
                    onClick={() => setFilterType(filterType === type ? 'all' : type)}
                  />
                ))}
              </div>
            )}
          </CardHeader>

          <CardContent>
            {filteredEvents.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {events.length === 0 ? 'No events yet.' : 'No events match your filters.'}
              </p>
            ) : (
              <div className="space-y-6 max-h-[700px] overflow-y-auto pr-1">
                {groupedEvents.map(([dateKey, dayEvents]) => (
                  <div key={dateKey}>
                    {/* Date header */}
                    <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 bg-card pb-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {formatDateLabel(dateKey)}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[10px] text-muted-foreground">{dayEvents.length} events</span>
                    </div>

                    {/* Events for this day */}
                    <div className="space-y-2">
                      {dayEvents.map((ev: any) => {
                        const isEditing = editingId === ev.id;
                        const showHistory = historyId === ev.id;
                        const isExpanded = expandedIds.has(ev.id);
                        const sourceColor = SOURCE_COLOR[ev.source] || '#6b7280';

                        return (
                          <div
                            key={ev.id}
                            className="relative rounded-lg border-l-[3px] border border-l-secondary p-3 transition-colors hover:bg-muted/40"
                            style={{ borderLeftColor: sourceColor }}
                          >
                            {isEditing ? (
                              /* ── Edit form ── */
                              <div className="space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold">Edit Event</span>
                                  <div className="flex gap-1">
                                    <Button size="icon" variant="ghost" onClick={saveEdit} disabled={saving}>
                                      {saving ? <span className="text-xs">...</span> : <Check className="h-4 w-4 text-green-600" />}
                                    </Button>
                                    <Button size="icon" variant="ghost" onClick={cancelEdit}>
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                                <Input name="title" placeholder="Title" value={editForm.title} onChange={handleEditChange} />
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <select name="event_type" className={selectClass} value={editForm.event_type} onChange={handleEditChange}>
                                    {EVENT_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                                  </select>
                                  <select name="event_layer" className={selectClass} value={editForm.event_layer} onChange={handleEditChange}>
                                    {EVENT_LAYERS.map((l) => (<option key={l} value={l}>{l}</option>))}
                                  </select>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <select name="source" className={selectClass} value={editForm.source} onChange={handleEditChange}>
                                    {SOURCES.map((s) => (<option key={s} value={s}>{s}</option>))}
                                  </select>
                                  <Input name="project" placeholder="Project" value={editForm.project} onChange={handleEditChange} />
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <Input name="duration_minutes" type="number" min={0} placeholder="Duration (min)" value={editForm.duration_minutes} onChange={handleEditChange} />
                                  <select name="outcome" className={selectClass} value={editForm.outcome} onChange={handleEditChange}>
                                    {OUTCOMES.map((o) => (<option key={o} value={o}>{o}</option>))}
                                  </select>
                                </div>
                                <Input name="started_at" type="datetime-local" value={editForm.started_at} onChange={handleEditChange} />
                                <Input name="tags" placeholder="Tags (comma-separated)" value={editForm.tags} onChange={handleEditChange} />
                                <Textarea name="content" placeholder="Content" value={editForm.content} onChange={handleEditChange} className="min-h-[80px]" />
                              </div>
                            ) : (
                              /* ── Compact display ── */
                              <>
                                {/* Row 1: title + action buttons */}
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <h3 className="font-medium text-sm truncate">{ev.title}</h3>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{ev.event_type}</Badge>
                                      {ev.event_layer && (
                                        <Badge variant={LAYER_VARIANT[ev.event_layer] ?? 'default'} className="text-[10px] px-1.5 py-0 h-4">
                                          {ev.event_layer}
                                        </Badge>
                                      )}
                                      {ev.outcome && ev.outcome !== 'resolved' && (
                                        <Badge variant={OUTCOME_VARIANT[ev.outcome] ?? 'default'} className="text-[10px] px-1.5 py-0 h-4">
                                          {ev.outcome}
                                        </Badge>
                                      )}
                                      {ev.source && (
                                        <span className="text-[10px] font-medium" style={{ color: sourceColor }}>{ev.source}</span>
                                      )}
                                      {ev.duration_minutes > 0 && (
                                        <span className="text-[10px] text-muted-foreground">{ev.duration_minutes}m</span>
                                      )}
                                      {ev.project && (
                                        <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{ev.project}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-0.5">
                                    <span className="text-[10px] text-muted-foreground mr-1">
                                      {ev.started_at ? new Date(ev.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                                    </span>
                                    {(ev.content || (Array.isArray(ev.tags) && ev.tags.length > 0)) && (
                                      <button type="button" onClick={() => toggleExpand(ev.id)} className="rounded p-1 text-muted-foreground hover:bg-secondary">
                                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                      </button>
                                    )}
                                    <button type="button" onClick={() => toggleHistory(ev.id)} className="relative rounded p-1 text-muted-foreground hover:bg-secondary" title="History">
                                      <History className="h-3 w-3" />
                                      {ev.revision_count > 0 && (
                                        <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-indigo-500 text-[8px] font-bold text-white">
                                          {ev.revision_count}
                                        </span>
                                      )}
                                    </button>
                                    <button type="button" onClick={() => startEdit(ev)} className="rounded p-1 text-muted-foreground hover:bg-secondary" title="Edit">
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button type="button" onClick={() => setDeleteConfirmId(ev.id)} className="rounded p-1 text-muted-foreground hover:text-destructive" title="Delete">
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* Expanded: tags + content */}
                                {isExpanded && (
                                  <div className="mt-2 space-y-1.5 pl-1">
                                    {Array.isArray(ev.tags) && ev.tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {ev.tags.map((tag: string) => (
                                          <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">{tag}</span>
                                        ))}
                                      </div>
                                    )}
                                    {ev.content && (
                                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ev.content}</p>
                                    )}
                                    <div className="flex gap-3 text-[10px] text-muted-foreground/60">
                                      <span>Created: {formatTime(ev.created_at)}</span>
                                      {ev.updated_at && ev.updated_at !== ev.created_at && (
                                        <span>Modified: {formatTime(ev.updated_at)}</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* History panel — Visual Timeline */}
                                {showHistory && (
                                  <div className="mt-3 rounded-lg border border-indigo-200/60 dark:border-indigo-800/30 bg-gradient-to-b from-indigo-50/50 to-transparent dark:from-indigo-950/20 p-3">
                                    <div className="flex items-center gap-2 mb-3">
                                      <GitCompare className="h-3.5 w-3.5 text-indigo-500" />
                                      <h4 className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                                        Modification History
                                      </h4>
                                      {historyData.length > 0 && (
                                        <Badge variant="secondary" className="text-[9px] h-4 px-1.5 ml-auto">
                                          {historyData.length} revision{historyData.length > 1 ? 's' : ''}
                                        </Badge>
                                      )}
                                    </div>
                                    {historyLoading ? (
                                      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                                        Loading history...
                                      </div>
                                    ) : historyData.length === 0 ? (
                                      <p className="py-2 text-[11px] text-muted-foreground italic">No modifications recorded.</p>
                                    ) : (
                                      <div className="relative ml-1.5">
                                        {/* Vertical timeline line */}
                                        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-indigo-200 dark:bg-indigo-800" />
                                        <div className="space-y-3">
                                          {historyData.map((rev: any, revIdx: number) => {
                                            const changeEntries = Object.entries(rev.changes || {});
                                            return (
                                              <div key={rev.id} className="relative pl-5">
                                                {/* Timeline dot */}
                                                <div className={`absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 ${
                                                  revIdx === 0
                                                    ? 'border-indigo-500 bg-indigo-100 dark:bg-indigo-900'
                                                    : 'border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900'
                                                }`} />

                                                {/* Header: time + summary */}
                                                <div className="flex items-center gap-2 mb-1">
                                                  <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 tabular-nums" title={rev.revised_at}>
                                                    {relativeTime(rev.revised_at)}
                                                  </span>
                                                  <span className="text-[10px] text-muted-foreground">
                                                    {changeEntries.length} field{changeEntries.length !== 1 ? 's' : ''} changed
                                                  </span>
                                                </div>

                                                {/* Diff entries */}
                                                <div className="space-y-1.5">
                                                  {changeEntries.map(([field, diff]: [string, any]) => (
                                                    <div key={field} className="rounded-md bg-card/80 px-2 py-1.5 border border-border/50">
                                                      <div className="flex items-center gap-1.5 mb-0.5">
                                                        <span className="text-[10px] font-semibold text-foreground">
                                                          {FIELD_LABELS[field] || field}
                                                        </span>
                                                      </div>
                                                      <DiffValue field={field} diff={diff} />
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {totalEvents > eventOffset && (
                  <div className="flex justify-center pt-2 pb-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchEvents(true)}
                      className="gap-2"
                    >
                      Load More
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                        {totalEvents - eventOffset} remaining
                      </Badge>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，确定要删除这个事件吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteConfirmId) { handleDelete(deleteConfirmId); setDeleteConfirmId(null); } }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
