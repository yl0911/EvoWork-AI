import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Trash2, Plus, Calendar, Pencil, X, Check, History, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

const EVENT_TYPES = [
  'search', 'debug', 'coding', 'reading', 'writing',
  'design', 'error', 'planning', 'summary', 'note',
  'app_usage', 'browser', 'context_switch',
] as const;

const EVENT_LAYERS = ['habit', 'problem', 'result'] as const;
const SOURCES = ['manual', 'browser', 'ide', 'git', 'ai_chat', 'document'] as const;
const OUTCOMES = ['resolved', 'partial', 'unresolved'] as const;
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

export default function Events() {
  const [events, setEvents] = useState<any[]>([]);
  const [form, setForm] = useState<EventFormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EventFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // History state
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await api.listEvents();
      setEvents(data);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
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
    } catch {
      /* retry */
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteEvent(id);
      await fetchEvents();
    } catch {
      /* ignore */
    }
  };

  // ── Edit ──
  const startEdit = (ev: any) => {
    setEditingId(ev.id);
    setEditForm(eventToForm(ev));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const handleEditChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
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
    } catch {
      /* keep form */
    } finally {
      setSaving(false);
    }
  };

  // ── History ──
  const toggleHistory = async (id: string) => {
    if (historyId === id) {
      setHistoryId(null);
      setHistoryData([]);
      return;
    }
    setHistoryId(id);
    setHistoryLoading(true);
    try {
      const data = await api.eventHistory(id);
      setHistoryData(data);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <Calendar className="h-6 w-6" />
        Events
      </h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- Left: Create form ---- */}
        <Card>
          <CardHeader>
            <CardTitle>New Event</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="title">Title</label>
                <Input id="title" name="title" placeholder="Event title" value={form.title} onChange={handleChange} required />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="event_type">Event Type</label>
                  <select id="event_type" name="event_type" className={selectClass} value={form.event_type} onChange={handleChange}>
                    {EVENT_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="event_layer">Event Layer</label>
                  <select id="event_layer" name="event_layer" className={selectClass} value={form.event_layer} onChange={handleChange}>
                    {EVENT_LAYERS.map((l) => (<option key={l} value={l}>{l}</option>))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="grid gap-4 sm:grid-cols-2">
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

        {/* ---- Right: Event timeline ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Event Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <ul className="space-y-4">
                {events.map((ev) => {
                  const isEditing = editingId === ev.id;
                  const showHistory = historyId === ev.id;

                  return (
                    <li key={ev.id} className="relative rounded-lg border p-4 transition-colors hover:bg-muted/50">
                      {isEditing ? (
                        /* ── Edit form ── */
                        <div className="space-y-3">
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
                        /* ── Display mode ── */
                        <>
                          {/* Action buttons */}
                          <div className="absolute right-3 top-3 flex gap-1">
                            <button type="button" onClick={() => toggleHistory(ev.id)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" title="History">
                              <History className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => startEdit(ev)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => handleDelete(ev.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* Title */}
                          <h3 className="mb-2 pr-20 font-semibold">{ev.title}</h3>

                          {/* Badges */}
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            {ev.event_type && <Badge variant="outline">{ev.event_type}</Badge>}
                            {ev.source && <Badge variant="outline">{ev.source}</Badge>}
                            {ev.event_layer && <Badge variant={LAYER_VARIANT[ev.event_layer] ?? 'default'}>{ev.event_layer}</Badge>}
                            {ev.outcome && <Badge variant={OUTCOME_VARIANT[ev.outcome] ?? 'default'}>{ev.outcome}</Badge>}
                          </div>

                          {/* Meta row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {ev.duration_minutes != null && <span>{ev.duration_minutes} min</span>}
                            {ev.project && <span>Project: {ev.project}</span>}
                          </div>

                          {/* Timestamps */}
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground/70">
                            <span title="Event time">Occurred: {formatTime(ev.started_at)}</span>
                            <span title="Created">Created: {formatTime(ev.created_at)}</span>
                            {ev.updated_at && ev.updated_at !== ev.created_at && (
                              <span title="Last modified">Modified: {formatTime(ev.updated_at)}</span>
                            )}
                          </div>

                          {/* Tags */}
                          {Array.isArray(ev.tags) && ev.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {ev.tags.map((tag: string) => (
                                <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{tag}</span>
                              ))}
                            </div>
                          )}

                          {/* Content preview */}
                          {ev.content && (
                            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{ev.content}</p>
                          )}

                          {/* History panel */}
                          {showHistory && (
                            <div className="mt-3 rounded-lg border bg-secondary/30 p-3">
                              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Modification History</h4>
                              {historyLoading ? (
                                <p className="text-xs text-muted-foreground">Loading...</p>
                              ) : historyData.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No modifications recorded.</p>
                              ) : (
                                <ul className="space-y-2">
                                  {historyData.map((rev: any) => (
                                    <li key={rev.id} className="text-xs">
                                      <div className="flex items-center gap-2 text-muted-foreground">
                                        <span>{formatTime(rev.revised_at)}</span>
                                        <span className="text-foreground">{rev.summary}</span>
                                      </div>
                                      <div className="mt-1 ml-4 space-y-0.5">
                                        {Object.entries(rev.changes).map(([field, diff]: [string, any]) => (
                                          <div key={field} className="flex gap-1 text-muted-foreground">
                                            <span className="font-medium text-foreground">{field}:</span>
                                            <span className="line-through opacity-60">{String(diff.old ?? '—')}</span>
                                            <span>→</span>
                                            <span className="text-green-700 dark:text-green-400">{String(diff.new ?? '—')}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
