import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Trash2, Plus, Calendar, Pencil, X, Check, History, ChevronDown, ChevronUp, Filter, Search, GitCompare, RotateCcw, Download, Sparkles, Loader2, Lightbulb, ChevronRight, FileUp, FolderOpen } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
const SOURCES = ['manual', 'manual_note', 'browser', 'ide', 'git', 'shell', 'ai_chat', 'document'] as const;
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

const ACTIVITY_TYPES = ['编码开发', '调试修复', '问题排查', '学习调研', '部署运维', '文档写作', '浏览阅读'] as const;
const ACTIVITY_COLORS: Record<string, string> = {
  '编码开发': '#22c55e', '调试修复': '#ef4444', '问题排查': '#f59e0b',
  '学习调研': '#3b82f6', '部署运维': '#8b5cf6', '文档写作': '#06b6d4',
  '浏览阅读': '#64748b', '其他': '#94a3b8',
};
const RESULT_LABELS: Record<string, string> = {
  resolved: '已解决', partial: '部分完成', unresolved: '未解决', abandoned: '已放弃',
};

interface AnalyzedTask {
  id: string; title: string; problem_description: string;
  actions_taken: string[]; solution: string | null;
  result: string; result_detail: string | null;
  reference_theory: string | null; efficiency_score: number | null;
  activity_type: string; project: string | null;
  tags: string[]; sources: string[]; created_at: string;
}

/* Source color mapping */
const SOURCE_COLOR: Record<string, string> = {
  git: '#22c55e',
  shell: '#a855f7',
  manual: '#3b82f6',
  manual_note: '#10b981',
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

export default function Events({ period }: { period: 'week' | 'month' | 'year' }) {
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

  // ── Note Import ──
  const [noteInboxStatus, setNoteInboxStatus] = useState<any>(null);
  const [noteScanning, setNoteScanning] = useState(false);
  const [noteUploading, setNoteUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingInboxPath, setEditingInboxPath] = useState(false);
  const [inboxPathDraft, setInboxPathDraft] = useState('');

  const fetchInboxStatus = useCallback(async () => {
    try {
      const status = await api.notesInboxStatus();
      setNoteInboxStatus(status);
    } catch { /* swallow */ }
  }, []);

  const handleNoteScan = async () => {
    setNoteScanning(true);
    try {
      const res = await api.notesScan();
      const msg = `处理 ${res.total} 个文件，创建 ${res.created} 个事件`;
      toast({
        title: '笔记导入完成',
        description: res.errors > 0 ? `${msg}，${res.errors} 个失败` : msg,
        variant: res.errors > 0 ? 'destructive' : 'success',
      });
      await fetchInboxStatus();
      await fetchEvents();
    } catch (err: any) {
      toast({ title: '扫描失败', description: err?.message || '请稍后重试', variant: 'destructive' });
    }
    setNoteScanning(false);
  };

  const handleNoteUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setNoteUploading(true);
    try {
      for (const file of Array.from(files)) {
        const res = await api.notesUpload(file);
        toast({
          title: `${file.name} 导入${res.status === 'completed' ? '成功' : '失败'}`,
          description: res.events_created > 0 ? `创建了 ${res.events_created} 个事件` : undefined,
          variant: res.status === 'completed' ? 'success' : 'destructive',
        });
      }
      await fetchInboxStatus();
      await fetchEvents();
    } catch (err: any) {
      toast({ title: '上传失败', description: err?.message || '请稍后重试', variant: 'destructive' });
    }
    setNoteUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startEditInboxPath = () => {
    setInboxPathDraft(noteInboxStatus?.inbox_path ?? '');
    setEditingInboxPath(true);
  };

  const saveInboxPath = async () => {
    const trimmed = inboxPathDraft.trim();
    if (!trimmed || trimmed === noteInboxStatus?.inbox_path) {
      setEditingInboxPath(false);
      return;
    }
    try {
      await api.updateConfig({ notes_inbox_dir: trimmed });
      toast({ title: 'Inbox 目录已更新', description: trimmed, variant: 'success' });
      setEditingInboxPath(false);
      await fetchInboxStatus();
    } catch (err: any) {
      toast({ title: '更新失败', description: err?.message || '请稍后重试', variant: 'destructive' });
    }
  };

  const openInboxFolder = async () => {
    try {
      const res = await api.notesOpenInbox();
      if (!res.ok) {
        toast({ title: '无法打开目录', description: res.error || '请检查路径是否存在', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: '打开失败', description: err?.message || '', variant: 'destructive' });
    }
  };

  useEffect(() => {
    fetchInboxStatus();
  }, [fetchInboxStatus]);

  // ── AI Analyzed Tasks ──
  const [activeTab, setActiveTab] = useState<string>('analyzed');
  const [analyzedTasks, setAnalyzedTasks] = useState<AnalyzedTask[]>([]);
  const [analyzedTotal, setAnalyzedTotal] = useState(0);
  const [analyzedLoading, setAnalyzedLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [scheduleConfig, setScheduleConfig] = useState<any>(null);

  const fetchAnalyzedTasks = useCallback(async () => {
    setAnalyzedLoading(true);
    try {
      const res = await api.analyzedTasks(period, 100);
      setAnalyzedTasks(res.tasks ?? []);
      setAnalyzedTotal(res.total ?? 0);
    } catch { /* swallow */ }
    setAnalyzedLoading(false);
  }, [period]);

  const fetchScheduleConfig = useCallback(async () => {
    try {
      const cfg = await api.scheduleConfig();
      setScheduleConfig(cfg);
    } catch { /* swallow */ }
  }, []);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await api.analyzeEvents(period);
      const periodLabel = { week: '本周', month: '本月', year: '本年' }[period];

      // 检测是否发生了回退（实际分析的 period_start 与当前周期不同）
      const actualStart = new Date(res.period_start);
      const currentStart = periodStart;
      const isFallback = actualStart < currentStart;

      let title = `${periodLabel}分析完成`;
      let description = `识别了 ${res.tasks_identified} 个任务 (共 ${res.total_events_seen} 个事件, 过滤 ${res.noise_events_count} 个噪声)`;

      if (isFallback) {
        const startStr = `${actualStart.getMonth() + 1}/${actualStart.getDate()}`;
        const endStr = `${new Date(res.period_end).getMonth() + 1}/${new Date(res.period_end).getDate()}`;
        title = `${periodLabel}暂无数据，已回退分析`;
        description = `分析了 ${startStr}~${endStr} 的数据，识别了 ${res.tasks_identified} 个任务`;
      }

      toast({ title, description, variant: 'success' });
      await fetchAnalyzedTasks();
    } catch (err: any) {
      toast({ title: '分析失败', description: err?.message || '请稍后重试', variant: 'destructive' });
    }
    setAnalyzing(false);
  };

  const toggleTaskExpand = (id: string) => {
    setExpandedTaskIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [expandedTasksPerProject, setExpandedTasksPerProject] = useState<Record<string, boolean>>({});
  const [showAllProjects, setShowAllProjects] = useState(false);

  const toggleProjectCollapse = (project: string) => {
    setCollapsedProjects(prev => {
      const next = new Set(prev);
      next.has(project) ? next.delete(project) : next.add(project);
      return next;
    });
  };

  // 按项目分组
  const groupedByProject = useMemo(() => {
    const groups: Record<string, { tasks: AnalyzedTask[]; avgEfficiency: number; types: Record<string, number>; results: Record<string, number> }> = {};
    for (const t of analyzedTasks) {
      const key = t.project || '未归属';
      if (!groups[key]) groups[key] = { tasks: [], avgEfficiency: 0, types: {}, results: {} };
      groups[key].tasks.push(t);
      groups[key].types[t.activity_type] = (groups[key].types[t.activity_type] || 0) + 1;
      groups[key].results[t.result] = (groups[key].results[t.result] || 0) + 1;
    }
    // 计算平均效率
    for (const g of Object.values(groups)) {
      const scored = g.tasks.filter(t => t.efficiency_score != null);
      g.avgEfficiency = scored.length > 0
        ? Math.round(scored.reduce((s, t) => s + (t.efficiency_score || 0), 0) / scored.length * 10) / 10
        : 0;
    }
    return Object.entries(groups).sort(([, a], [, b]) => b.tasks.length - a.tasks.length);
  }, [analyzedTasks]);

  // 默认折叠所有项目
  useEffect(() => {
    const allProjects = new Set(groupedByProject.map(([p]) => p));
    setCollapsedProjects(allProjects);
    setExpandedTasksPerProject({});
  }, [groupedByProject]);

  useEffect(() => {
    fetchAnalyzedTasks();
    fetchScheduleConfig();
  }, [fetchAnalyzedTasks, fetchScheduleConfig]);

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

  /* ── Period start date ── */
  const periodStart = useMemo(() => {
    const now = new Date();
    if (period === 'week') {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday = 0
      const monday = new Date(now);
      monday.setDate(now.getDate() - diff);
      monday.setHours(0, 0, 0, 0);
      return monday;
    } else if (period === 'month') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      return new Date(now.getFullYear(), 0, 1);
    }
  }, [period]);

  /* ── Filtering ── */
  const filteredEvents = useMemo(() => {
    let result = events;
    // Period filter
    result = result.filter((e) => {
      const d = new Date(e.started_at || e.created_at);
      return d >= periodStart;
    });
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
  }, [events, filterSource, filterType, searchQuery, periodStart]);

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

      {/* ── AI Analyzed Tasks Section ── */}
      <Card className="mb-6 border-dashed border-primary/30">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: 'hsl(262, 83%, 58%)' }} />
            <CardTitle className="text-base">AI 事件分析</CardTitle>
            {analyzedTotal > 0 && (
              <Badge variant="secondary" className="text-xs">{analyzedTotal} 个任务</Badge>
            )}
            {scheduleConfig && scheduleConfig.mode !== 'manual' && (
              <Badge variant="outline" className="text-[10px]">
                {scheduleConfig.mode === 'daily' ? `每日 ${String(scheduleConfig.hour).padStart(2, '0')}:${String(scheduleConfig.minute).padStart(2, '0')}` : scheduleConfig.mode === 'biweekly' ? `周三+周日 ${String(scheduleConfig.hour).padStart(2, '0')}:${String(scheduleConfig.minute).padStart(2, '0')}` : `每 ${scheduleConfig.interval_hours}h`}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAnalyze}
            disabled={analyzing}
          >
            {analyzing ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 分析中…</>
            ) : (
              <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> 立即分析</>
            )}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {analyzedLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-secondary/50" />
              ))}
            </div>
          ) : analyzedTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Lightbulb className="mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm">暂无分析结果</p>
              {filteredEvents.length === 0 ? (
                <p className="text-xs">当前{period === 'week' ? '本周' : period === 'month' ? '本月' : '本年'}暂无事件数据，无法进行分析</p>
              ) : (
                <p className="text-xs">点击「立即分析」让 AI 分析你的工作事件，生成结构化任务记录</p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {(showAllProjects ? groupedByProject : groupedByProject.slice(0, 8)).map(([project, group]) => {
                const isProjectCollapsed = collapsedProjects.has(project);
                const typeEntries = Object.entries(group.types).sort(([, a], [, b]) => b - a);
                const resolvedCount = group.results['resolved'] || 0;
                const showAllTasks = expandedTasksPerProject[project];
                const visibleTasks = showAllTasks ? group.tasks : group.tasks.slice(0, 5);
                return (
                  <div key={project} className="rounded-lg border bg-card">
                    {/* Project Header */}
                    <div
                      className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-secondary/30"
                      onClick={() => toggleProjectCollapse(project)}
                    >
                      <div className="flex items-center gap-2.5">
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isProjectCollapsed ? '' : 'rotate-90'}`} />
                        <h3 className="text-sm font-semibold" style={{ color: 'hsl(224, 71%, 4%)' }}>{project}</h3>
                        <Badge variant="secondary" className="text-[10px]">{group.tasks.length} 个任务</Badge>
                        {group.avgEfficiency > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            平均 {'★'.repeat(Math.round(group.avgEfficiency))}{'☆'.repeat(5 - Math.round(group.avgEfficiency))}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Type distribution mini-badges */}
                        {typeEntries.slice(0, 4).map(([type, count]) => {
                          const color = ACTIVITY_COLORS[type] || '#94a3b8';
                          return (
                            <Badge key={type} variant="outline" className="text-[9px] px-1 py-0" style={{ borderColor: `${color}40`, color }}>
                              {type} {count}
                            </Badge>
                          );
                        })}
                        {resolvedCount > 0 && (
                          <span className="text-[10px] text-green-600">{resolvedCount}/{group.tasks.length} 已解决</span>
                        )}
                      </div>
                    </div>
                    {/* Task Cards */}
                    {!isProjectCollapsed && (
                      <div className="border-t px-4 py-3">
                        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                          {visibleTasks.map(task => {
                          const isExpanded = expandedTaskIds.has(task.id);
                          const color = ACTIVITY_COLORS[task.activity_type] || '#94a3b8';
                          return (
                            <div
                              key={task.id}
                              className="group cursor-pointer rounded-lg border bg-background p-3 transition-all hover:border-primary/30 hover:shadow-sm"
                              onClick={() => toggleTaskExpand(task.id)}
                            >
                              {/* Task Header */}
                              <div className="mb-1.5 flex items-start justify-between gap-2">
                                <h4 className="text-sm font-semibold leading-tight" style={{ color: 'hsl(224, 71%, 4%)' }}>
                                  {task.title}
                                </h4>
                                <div className="flex shrink-0 items-center gap-1">
                                  {task.efficiency_score && (
                                    <span className="text-[10px] font-medium text-muted-foreground">
                                      {'★'.repeat(task.efficiency_score)}{'☆'.repeat(5 - task.efficiency_score)}
                                    </span>
                                  )}
                                  <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                </div>
                              </div>
                              {/* Badges */}
                              <div className="mb-1.5 flex flex-wrap gap-1">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0" style={{ borderColor: `${color}60`, color }}>
                                  {task.activity_type}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0"
                                  style={{
                                    borderColor: task.result === 'resolved' ? '#22c55e60' : task.result === 'unresolved' ? '#ef444460' : '#f59e0b60',
                                    color: task.result === 'resolved' ? '#22c55e' : task.result === 'unresolved' ? '#ef4444' : '#f59e0b',
                                  }}
                                >
                                  {RESULT_LABELS[task.result] || task.result}
                                </Badge>
                              </div>
                              {/* Problem */}
                              <p className="text-xs text-muted-foreground line-clamp-2">{task.problem_description}</p>
                              {/* Expanded content */}
                              {isExpanded && (
                                <div className="mt-2 space-y-2 border-t pt-2">
                                  {task.solution && (
                                    <div>
                                      <p className="text-[10px] font-semibold text-foreground">方案</p>
                                      <p className="text-xs text-muted-foreground">{task.solution}</p>
                                    </div>
                                  )}
                                  {task.reference_theory && (
                                    <div className="rounded-md border-l-3 border-purple-500 bg-purple-50 px-2.5 py-1.5 dark:bg-purple-950/20">
                                      <p className="text-[10px] font-semibold text-purple-700 dark:text-purple-300">知识点</p>
                                      <p className="text-xs text-purple-600 dark:text-purple-400">{task.reference_theory}</p>
                                    </div>
                                  )}
                                  {task.actions_taken.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-semibold text-foreground">动作</p>
                                      <div className="flex flex-wrap gap-1">
                                        {task.actions_taken.map((a, i) => (
                                          <span key={i} className="inline-block rounded bg-secondary px-1.5 py-0.5 text-[10px]">{a}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {task.result_detail && (
                                    <p className="text-xs text-muted-foreground">{task.result_detail}</p>
                                  )}
                                  <div className="flex flex-wrap gap-1">
                                    {task.sources.map(s => (
                                      <Badge key={s} variant="secondary" className="text-[9px] px-1 py-0">{s}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        </div>
                        {group.tasks.length > 5 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedTasksPerProject(prev => ({ ...prev, [project]: !prev[project] }));
                            }}
                            className="mt-2 flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                          >
                            {showAllTasks ? (
                              <>收起 <ChevronUp className="h-3 w-3" /></>
                            ) : (
                              <>查看更多 ({group.tasks.length - 5} 个隐藏) <ChevronDown className="h-3 w-3" /></>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {groupedByProject.length > 8 && (
                <button
                  onClick={() => setShowAllProjects(!showAllProjects)}
                  className="flex w-full items-center justify-center gap-1 rounded-md py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  {showAllProjects ? (
                    <>收起项目 <ChevronUp className="h-3 w-3" /></>
                  ) : (
                    <>展开全部 ({groupedByProject.length} 个项目) <ChevronDown className="h-3 w-3" /></>
                  )}
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ---- Left: Note Import + Create form (2 cols) ---- */}
        <div className="space-y-6 lg:col-span-2">
          {/* Note Import Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderOpen className="h-4 w-4" style={{ color: 'hsl(142, 71%, 45%)' }} />
                笔记导入
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {/* Inbox directory path */}
              {noteInboxStatus && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0">Inbox 目录:</span>
                    {editingInboxPath ? (
                      <div className="flex flex-1 items-center gap-1">
                        <Input
                          value={inboxPathDraft}
                          onChange={(e) => setInboxPathDraft(e.target.value)}
                          className="h-7 text-xs font-mono"
                          onKeyDown={(e) => { if (e.key === 'Enter') saveInboxPath(); if (e.key === 'Escape') setEditingInboxPath(false); }}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={saveInboxPath}>
                          <Check className="h-3 w-3 text-green-600" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEditingInboxPath(false)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-1 items-center gap-1 min-w-0">
                        <code className="truncate rounded bg-secondary px-1.5 py-0.5 text-[11px]" title={noteInboxStatus.inbox_path}>
                          {noteInboxStatus.inbox_path}
                        </code>
                        <button
                          type="button"
                          onClick={openInboxFolder}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          title="打开目录"
                        >
                          <FolderOpen className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={startEditInboxPath}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          title="修改目录"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">
                      {noteInboxStatus.total_files} 个待处理文件
                    </span>
                    {noteInboxStatus.total_files > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {Object.entries(noteInboxStatus.by_type).map(([ext, count]) => (
                          <Badge key={ext} variant="outline" className="text-[9px] px-1 py-0">
                            {ext} {count as number}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleNoteScan}
                  disabled={noteScanning}
                >
                  {noteScanning ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 扫描中…</>
                  ) : (
                    <><FolderOpen className="mr-1.5 h-3.5 w-3.5" /> 扫描 Inbox</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={noteUploading}
                >
                  {noteUploading ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 上传中…</>
                  ) : (
                    <><FileUp className="mr-1.5 h-3.5 w-3.5" /> 上传文件</>
                  )}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt,.docx,.pdf,.xlsx"
                  multiple
                  className="hidden"
                  onChange={handleNoteUpload}
                />
              </div>

              {/* Help text */}
              <p className="text-[11px] text-muted-foreground">
                支持 .md / .txt / .docx / .pdf / .xlsx，AI 自动拆分为工作事件。
                点击上方目录路径可修改 Inbox 目录位置。
              </p>
            </CardContent>
          </Card>

          {/* New Event Card */}
          <Card>
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
        </div>

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
                {events.length === 0
                  ? '暂无事件数据'
                  : events.some(e => new Date(e.started_at || e.created_at) >= periodStart)
                    ? '没有匹配筛选条件的事件'
                    : `当前${period === 'week' ? '本周' : period === 'month' ? '本月' : '本年'}暂无事件`}
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
