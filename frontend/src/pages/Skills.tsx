import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Trash2, Plus, BookOpen, Lightbulb, Recycle, Globe, Settings, Pencil,
  ChevronDown, ChevronUp, Sparkles, Link2, RefreshCw, BarChart3, Clock,
  Play, Activity, ThumbsUp, ThumbsDown, Minus, Download,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

/* ── Types ─────────────────────────────────────────── */

type SkillCategory = 'thinking' | 'reusable' | 'open_source';
type SkillSource = 'user_generated' | 'ai_generated' | 'open_source' | 'mined' | 'system';

interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  trigger: string;
  content?: string;
  steps: string[];
  source: SkillSource;
  methods?: string[];
  success_criteria?: string;
  failure_fallback?: string;
  agent_assistable?: boolean;
  usage_count: number;
  avg_effectiveness: number;
  system_skill?: boolean;
  enabled?: boolean;
  created_at?: string;
}

interface SkillForm {
  name: string;
  category: SkillCategory;
  trigger: string;
  content: string;
  steps: string;
  source: SkillSource;
  methods: string;
  success_criteria: string;
  failure_fallback: string;
  agent_assistable: boolean;
}

interface Recommendation {
  skill_id: string;
  skill_name: string;
  category: string;
  score: number;
  reasons: string[];
  usage_count: number;
  avg_effectiveness: number;
  trigger: string;
}

interface LinkedEvent {
  id: string;
  title: string;
  event_type: string;
  source: string;
  project: string | null;
  outcome: string;
  duration_minutes: number | null;
  started_at: string | null;
}

interface LinkedStats {
  total: number;
  total_minutes: number;
  by_type: Record<string, number>;
  by_outcome: Record<string, number>;
  by_project: Record<string, number>;
}

/* ── Constants ─────────────────────────────────────── */

const initialForm: SkillForm = {
  name: '',
  category: 'thinking',
  trigger: '',
  content: '',
  steps: '',
  source: 'user_generated',
  methods: '',
  success_criteria: '',
  failure_fallback: '',
  agent_assistable: false,
};

const categoryBadgeMap: Record<SkillCategory, { variant: 'secondary' | 'default' | 'outline'; icon: React.ElementType; label: string }> = {
  thinking: { variant: 'secondary', icon: Lightbulb, label: 'Thinking' },
  reusable: { variant: 'default', icon: Recycle, label: 'Reusable' },
  open_source: { variant: 'outline', icon: Globe, label: 'Open Source' },
};

const categoryTabs = [
  { value: 'all', label: 'All' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'reusable', label: 'Reusable' },
  { value: 'open_source', label: 'Open Source' },
  { value: 'system', label: 'System' },
];

const sourceColorMap: Record<string, string> = {
  git: 'bg-green-500',
  shell: 'bg-purple-500',
  manual: 'bg-blue-500',
  ide: 'bg-yellow-500',
  activitywatch: 'bg-orange-500',
  import: 'bg-gray-500',
};

/* ── Component ─────────────────────────────────────── */

export default function Skills() {
  // Skill library state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [form, setForm] = useState<SkillForm>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Recommendation state
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);

  // Linked events state (per-card expansion)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkedData, setLinkedData] = useState<Record<string, { events: LinkedEvent[]; stats: LinkedStats }>>({});
  const [linkedLoading, setLinkedLoading] = useState<string | null>(null);

  // Usage tracking state
  const [usageRecordId, setUsageRecordId] = useState<string | null>(null);
  const [usageExpandedId, setUsageExpandedId] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<Record<string, any>>({});
  const [usageLoading, setUsageLoading] = useState<string | null>(null);

  // Backfill state
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  // Mining state
  const [miningPatterns, setMiningPatterns] = useState<any[]>([]);
  const [miningCandidates, setMiningCandidates] = useState<any[]>([]);
  const [miningLoading, setMiningLoading] = useState(false);
  const [expandedCandidate, setExpandedCandidate] = useState<number | null>(null);
  const [confirmingIdx, setConfirmingIdx] = useState<number | null>(null);
  const [miningMessage, setMiningMessage] = useState<string | null>(null);

  // Toast + confirm
  const { toast } = useToast();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  /* ── Mining functions ──────────────────────────────── */

  const handleDetectPatterns = useCallback(async () => {
    try {
      setMiningLoading(true);
      setMiningMessage(null);
      setExpandedCandidate(null);
      const res = await api.minePatterns(30, 3);
      setMiningPatterns(res.patterns ?? []);
      setMiningCandidates([]);
      if (res.patterns?.length) {
        setMiningMessage(`Detected ${res.patterns.length} recurring patterns`);
      } else {
        setMiningMessage('No recurring patterns found (need 3+ events per pattern)');
      }
    } catch (err) {
      console.error('Pattern detection failed:', err);
      setMiningMessage('Pattern detection failed');
    } finally {
      setMiningLoading(false);
    }
  }, []);

  const handleMineWithLLM = useCallback(async () => {
    try {
      setMiningLoading(true);
      setMiningMessage(null);
      setExpandedCandidate(null);
      const res = await api.mineSkills(30, 5, true);
      setMiningCandidates(res.candidates ?? []);
      setMiningPatterns(res.candidates?.map((c: any) => c.pattern) ?? []);
      if (res.candidates?.length) {
        setMiningMessage(`Generated ${res.candidates.length} skill drafts`);
      } else {
        setMiningMessage('No new patterns to mine (existing skills already cover your activity)');
      }
    } catch (err) {
      console.error('Mining failed:', err);
      setMiningMessage('Mining failed — check LLM connection');
    } finally {
      setMiningLoading(false);
    }
  }, []);

  const handleConfirmCandidate = async (idx: number, candidate: any) => {
    try {
      setConfirmingIdx(idx);
      const draftContent = candidate.draft?.content || '';
      const res = await api.confirmMinedSkill({
        draft_content: draftContent,
        name: candidate.pattern?.primary_tag
          ? `${candidate.pattern.primary_tag.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} Skill`
          : `${candidate.pattern?.event_type || 'Untitled'} Skill`,
        category: 'reusable',
        trigger: `When encountering ${candidate.pattern?.event_type} tasks related to "${candidate.pattern?.primary_tag || candidate.pattern?.event_type}"`,
        content: draftContent.substring(0, 500),
        steps: ['Identify the problem context', 'Apply the established pattern', 'Verify the result'],
      });
      setMiningMessage(`Created skill: ${res.name}`);
      // Remove confirmed candidate from list
      setMiningCandidates((prev) => prev.filter((_, i) => i !== idx));
      setExpandedCandidate(null);
      await fetchSkills();
    } catch (err) {
      console.error('Confirm failed:', err);
      setMiningMessage('Failed to create skill');
    } finally {
      setConfirmingIdx(null);
    }
  };

  /* ── Fetch skills ──────────────────────────────────── */

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      let data: any[];
      if (activeTab === 'system') {
        data = await api.listSkills(undefined, true);
      } else {
        const category = activeTab === 'all' ? undefined : activeTab;
        data = await api.listSkills(category, false);
      }
      setSkills(data);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  /* ── Fetch recommendations ─────────────────────────── */

  const fetchRecs = useCallback(async () => {
    try {
      setRecsLoading(true);
      const res = await api.skillRecommendations(8);
      setRecs(res.recommendations ?? []);
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
    } finally {
      setRecsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    fetchRecs();
  }, [fetchRecs]);

  /* ── Linked events ─────────────────────────────────── */

  const toggleLinkedEvents = async (skillId: string) => {
    if (expandedId === skillId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(skillId);
    if (linkedData[skillId]) return; // already loaded

    try {
      setLinkedLoading(skillId);
      const res = await api.skillLinkedEvents(skillId, 30);
      setLinkedData((prev) => ({ ...prev, [skillId]: res }));
    } catch (err) {
      console.error('Failed to fetch linked events:', err);
    } finally {
      setLinkedLoading(null);
    }
  };

  /* ── Usage tracking ───────────────────────────────── */

  const toggleUsageHistory = async (skillId: string) => {
    if (usageExpandedId === skillId) {
      setUsageExpandedId(null);
      setUsageRecordId(null);
      return;
    }
    setUsageExpandedId(skillId);
    setUsageRecordId(null);
    if (usageData[skillId]) return;

    try {
      setUsageLoading(skillId);
      const res = await api.skillUsageLogs(skillId, 20);
      setUsageData((prev) => ({ ...prev, [skillId]: res }));
    } catch (err) {
      console.error('Failed to fetch usage logs:', err);
    } finally {
      setUsageLoading(null);
    }
  };

  const handleRecordUse = async (skillId: string, outcome: string) => {
    try {
      const res = await api.useSkill(skillId, { outcome, time_saved_minutes: 0 });
      toast({ title: `记录成功: ${outcome}`, variant: 'success' });
      setUsageRecordId(null);
      // Update skill's usage_count and avg_effectiveness in the list
      setSkills((prev) => prev.map((s) =>
        s.id === skillId
          ? { ...s, usage_count: res.usage_count, avg_effectiveness: res.avg_effectiveness }
          : s
      ));
      // Refresh usage data if expanded
      if (usageExpandedId === skillId) {
        const refreshed = await api.skillUsageLogs(skillId, 20);
        setUsageData((prev) => ({ ...prev, [skillId]: refreshed }));
      }
    } catch (err) {
      toast({ title: '记录失败', description: String((err as any)?.message || err), variant: 'destructive' });
    }
  };

  /* ── Backfill ──────────────────────────────────────── */

  const handleBackfill = async () => {
    try {
      setBackfilling(true);
      setBackfillResult(null);
      const res = await api.backfillSkillLinks();
      setBackfillResult(`Linked ${res.updated} events`);
      toast({ title: `已关联 ${res.updated} 个事件`, variant: 'success' });
      setLinkedData({});
      setExpandedId(null);
    } catch (err) {
      toast({ title: 'Backfill 失败', description: String((err as any)?.message || err), variant: 'destructive' });
      setBackfillResult('Backfill failed');
    } finally {
      setBackfilling(false);
    }
  };

  /* ── Skill CRUD handlers ───────────────────────────── */

  const handleToggle = async (id: string) => {
    try {
      const updated = await api.toggleSkill(id);
      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: updated.enabled } : s)));
    } catch (err) {
      toast({ title: '切换失败', description: String((err as any)?.message || err), variant: 'destructive' });
    }
  };

  const updateField = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const buildPayload = (): Partial<Skill> => {
    const payload: any = {
      name: form.name,
      category: form.category,
      trigger: form.trigger,
      content: form.content,
      steps: form.steps.split('\n').map((s) => s.trim()).filter(Boolean),
      source: form.source,
    };
    if (form.category === 'thinking') {
      payload.methods = form.methods.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    if (form.category === 'reusable') {
      payload.success_criteria = form.success_criteria;
      payload.failure_fallback = form.failure_fallback;
      payload.agent_assistable = form.agent_assistable;
    }
    return payload;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.trigger.trim()) return;
    try {
      setSubmitting(true);
      if (editingId) {
        await api.updateSkill(editingId, buildPayload());
        toast({ title: 'Skill 已更新', variant: 'success' });
        setEditingId(null);
      } else {
        await api.createSkill(buildPayload());
        toast({ title: 'Skill 创建成功', variant: 'success' });
      }
      setForm(initialForm);
      await fetchSkills();
      fetchRecs();
    } catch (err) {
      const action = editingId ? '更新' : '创建';
      toast({ title: `${action}失败`, description: String((err as any)?.message || err), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (skill: Skill) => {
    setEditingId(skill.id);
    setForm({
      name: skill.name,
      category: skill.category,
      trigger: skill.trigger,
      content: skill.content || '',
      steps: (skill.steps || []).join('\n'),
      source: skill.source,
      methods: (skill.methods || []).join('\n'),
      success_criteria: skill.success_criteria || '',
      failure_fallback: skill.failure_fallback || '',
      agent_assistable: skill.agent_assistable || false,
    });
    // Scroll to form
    document.querySelector('form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(initialForm);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
      toast({ title: 'Skill 已删除', variant: 'success' });
    } catch (err) {
      toast({ title: '删除失败', description: String((err as any)?.message || err), variant: 'destructive' });
    }
  };

  /* ── Render helpers ────────────────────────────────── */

  const scoreColor = (score: number) => {
    if (score >= 0.7) return 'text-green-600';
    if (score >= 0.4) return 'text-yellow-600';
    return 'text-muted-foreground';
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  /* ── Render ────────────────────────────────────────── */

  return (
    <div className="min-h-screen p-6 bg-background">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Skills Management</h1>
          </div>
          <div className="flex items-center gap-3">
            {backfillResult && (
              <span className="text-xs text-muted-foreground">{backfillResult}</span>
            )}
            <a
              href={api.exportSkills('json')}
              download
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              JSON
            </a>
            <a
              href={api.exportSkills('csv')}
              download
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackfill}
              disabled={backfilling}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${backfilling ? 'animate-spin' : ''}`} />
              {backfilling ? 'Linking...' : 'Backfill Links'}
            </Button>
          </div>
        </div>

        {/* Recommendations Section */}
        {recs.length > 0 && (
          <Card className="mb-6 border-amber-200/60 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Recommended Skills
                <span className="text-xs font-normal text-muted-foreground">
                  Based on your recent activity
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {recs.map((rec) => (
                  <div
                    key={rec.skill_id}
                    className="rounded-lg border bg-card p-3 transition-colors hover:bg-accent/30"
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-medium truncate flex-1">{rec.skill_name}</span>
                      <span className={`text-xs font-mono font-semibold ml-2 ${scoreColor(rec.score)}`}>
                        {Math.round(rec.score * 100)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                      {rec.trigger}
                    </p>
                    <div className="space-y-1">
                      {rec.reasons.slice(0, 2).map((reason, i) => (
                        <div key={i} className="flex items-start gap-1 text-[11px] text-muted-foreground">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                          <span className="line-clamp-1">{reason}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>Used {rec.usage_count}x</span>
                      {rec.avg_effectiveness != null && (
                        <span>{Math.round(rec.avg_effectiveness * 100)}% eff.</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {recsLoading && !recs.length && (
          <div className="mb-6 text-center text-xs text-muted-foreground py-4">
            Analyzing activity patterns...
          </div>
        )}

        {/* Skill Mining Section */}
        <Card className="mb-6 border-indigo-200/60 bg-indigo-50/30 dark:border-indigo-900/40 dark:bg-indigo-950/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                Skill Mining
                <span className="text-xs font-normal text-muted-foreground">
                  Detect recurring patterns and auto-generate skills
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDetectPatterns}
                  disabled={miningLoading}
                  className="gap-1.5 text-xs"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  {miningLoading ? 'Analyzing...' : 'Detect Patterns'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleMineWithLLM}
                  disabled={miningLoading}
                  className="gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {miningLoading ? 'Mining...' : 'Mine with AI'}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {miningMessage && (
              <div className="mb-3 text-xs text-indigo-600 dark:text-indigo-400">{miningMessage}</div>
            )}

            {miningPatterns.length === 0 && !miningLoading && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Click "Detect Patterns" to find recurring activity themes, or "Mine with AI" to generate skill drafts.
              </div>
            )}

            {miningPatterns.length > 0 && (
              <div className="space-y-2">
                {miningCandidates.length > 0
                  ? miningCandidates.map((candidate, idx) => {
                      const p = candidate.pattern;
                      const isExpanded = expandedCandidate === idx;
                      return (
                        <div
                          key={p.key}
                          className="rounded-lg border bg-card transition-colors hover:bg-accent/20"
                        >
                          <button
                            type="button"
                            onClick={() => setExpandedCandidate(isExpanded ? null : idx)}
                            className="flex w-full items-center gap-3 p-3 text-left"
                          >
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.count >= 10 ? 'bg-green-500' : p.count >= 5 ? 'bg-yellow-500' : 'bg-indigo-400'}`} />
                            <span className="min-w-0 flex-1">
                              <span className="text-sm font-medium">
                                {p.primary_tag ? p.primary_tag.replace(/[-_]/g, ' ') : p.event_type}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {p.count} events · {p.total_minutes} min
                              </span>
                            </span>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {p.event_type}
                            </Badge>
                            {candidate.draft?.provider === 'fallback' ? (
                              <Badge variant="secondary" className="text-[10px] shrink-0">rule-based</Badge>
                            ) : (
                              <Badge variant="default" className="text-[10px] shrink-0 bg-indigo-500">AI draft</Badge>
                            )}
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          </button>

                          {isExpanded && (
                            <div className="border-t px-3 pb-3 pt-2">
                              <div className="mb-2 flex flex-wrap gap-1.5">
                                {p.sample_titles.slice(0, 5).map((t: string, i: number) => (
                                  <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground line-clamp-1">
                                    {t}
                                  </span>
                                ))}
                              </div>
                              {candidate.draft?.content && (
                                <pre className="mb-3 max-h-[200px] overflow-y-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed whitespace-pre-wrap font-sans">
                                  {candidate.draft.content}
                                </pre>
                              )}
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleConfirmCandidate(idx, candidate)}
                                  disabled={confirmingIdx === idx}
                                  className="gap-1.5 text-xs bg-indigo-500 hover:bg-indigo-600"
                                >
                                  <Plus className="h-3 w-3" />
                                  {confirmingIdx === idx ? 'Creating...' : 'Create Skill'}
                                </Button>
                                <span className="text-[11px] text-muted-foreground">
                                  source: mined
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  : miningPatterns.map((p, idx) => (
                      <div
                        key={p.key}
                        className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/20"
                      >
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.count >= 10 ? 'bg-green-500' : p.count >= 5 ? 'bg-yellow-500' : 'bg-indigo-400'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-medium">
                            {p.primary_tag ? p.primary_tag.replace(/[-_]/g, ' ') : p.event_type}
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {p.count} events · {p.total_minutes} min
                          </span>
                        </span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {p.event_type}
                        </Badge>
                        {p.project && (
                          <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                            {p.project}
                          </span>
                        )}
                      </div>
                    ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left Panel: Create/Edit Skill Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {editingId ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                {editingId ? '编辑 Skill' : 'Create New Skill'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    placeholder="Skill name"
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Category</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.category}
                    onChange={(e) => updateField('category', e.target.value as SkillCategory)}
                  >
                    <option value="thinking">Thinking</option>
                    <option value="reusable">Reusable</option>
                    <option value="open_source">Open Source</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Trigger</label>
                  <Textarea
                    placeholder="Describe when this skill should be triggered"
                    value={form.trigger}
                    onChange={(e) => updateField('trigger', e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Content</label>
                  <Textarea
                    placeholder="Skill content / description"
                    value={form.content}
                    onChange={(e) => updateField('content', e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Steps (one per line)</label>
                  <Textarea
                    placeholder="Step 1: Do something&#10;Step 2: Do something else"
                    value={form.steps}
                    onChange={(e) => updateField('steps', e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Source</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.source}
                    onChange={(e) => updateField('source', e.target.value as SkillSource)}
                  >
                    <option value="user_generated">User Generated</option>
                    <option value="ai_generated">AI Generated</option>
                    <option value="open_source">Open Source</option>
                    <option value="mined">Mined</option>
                  </select>
                </div>

                {form.category === 'thinking' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Methods (one per line)</label>
                    <Textarea
                      placeholder="Method 1&#10;Method 2"
                      value={form.methods}
                      onChange={(e) => updateField('methods', e.target.value)}
                    />
                  </div>
                )}

                {form.category === 'reusable' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Success Criteria</label>
                      <Textarea
                        placeholder="Define what success looks like"
                        value={form.success_criteria}
                        onChange={(e) => updateField('success_criteria', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Failure Fallback</label>
                      <Textarea
                        placeholder="What to do if this skill fails"
                        value={form.failure_fallback}
                        onChange={(e) => updateField('failure_fallback', e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="agent_assistable"
                        checked={form.agent_assistable}
                        onChange={(e) => updateField('agent_assistable', e.target.checked)}
                        className="h-4 w-4 rounded border border-input accent-primary"
                      />
                      <label htmlFor="agent_assistable" className="text-sm font-medium">
                        Agent Assistable
                      </label>
                    </div>
                  </>
                )}

                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting
                      ? (editingId ? 'Saving...' : 'Creating...')
                      : (editingId ? '保存修改' : 'Create Skill')}
                  </Button>
                  {editingId && (
                    <Button type="button" variant="outline" onClick={cancelEdit} disabled={submitting}>
                      取消
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Right Panel: Skill Library */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Skill Library
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4 w-full">
                  {categoryTabs.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Loading skills...
                </div>
              ) : skills.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No skills found.
                </div>
              ) : (
                <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
                  {skills.map((skill) => {
                    const isSystem = !!skill.system_skill;
                    const badge = categoryBadgeMap[skill.category];
                    const Icon = badge ? badge.icon : BookOpen;
                    const isExpanded = expandedId === skill.id;
                    const linked = linkedData[skill.id];
                    const isLoadingLinked = linkedLoading === skill.id;

                    return (
                      <Card
                        key={skill.id}
                        className={`${isSystem && !skill.enabled ? 'opacity-50' : ''} transition-shadow ${isExpanded ? 'shadow-md' : ''}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1.5 flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">{skill.name}</span>
                                {isSystem && (
                                  <Badge variant="outline" className="shrink-0 border-blue-400 text-blue-600 text-[10px] px-1.5">
                                    <Settings className="h-3 w-3 mr-0.5" />
                                    System
                                  </Badge>
                                )}
                                {!isSystem && badge && (
                                  <Badge variant={badge.variant} className="gap-1 shrink-0">
                                    <Icon className="h-3 w-3" />
                                    {badge.label}
                                  </Badge>
                                )}
                                {isSystem && (
                                  <Badge
                                    variant={skill.enabled ? 'default' : 'secondary'}
                                    className="text-[10px] px-1.5 shrink-0"
                                  >
                                    {skill.enabled ? 'Active' : 'Disabled'}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                                {isSystem ? (skill.content || skill.trigger) : skill.trigger}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                {!isSystem && <span>{skill.steps?.length ?? 0} steps</span>}
                                <span>Used {skill.usage_count ?? 0} times</span>
                                {!isSystem && (
                                  <span>
                                    Effectiveness:{' '}
                                    {skill.avg_effectiveness != null
                                      ? `${Math.round(skill.avg_effectiveness * 100)}%`
                                      : 'N/A'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {/* Linked events expand button */}
                              <button
                                type="button"
                                onClick={() => toggleLinkedEvents(skill.id)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                title="View linked events"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                {linked && (
                                  <span className="font-mono">{linked.stats.total}</span>
                                )}
                                {isLoadingLinked ? (
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                ) : isExpanded ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                              </button>
                              {/* Record use button */}
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setUsageRecordId(usageRecordId === skill.id ? null : skill.id)}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                  title="Record skill usage"
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </button>
                                {usageRecordId === skill.id && (
                                  <div className="absolute right-0 top-full z-10 mt-1 flex gap-1 rounded-lg border bg-popover p-1.5 shadow-md">
                                    <button
                                      type="button"
                                      onClick={() => handleRecordUse(skill.id, 'effective')}
                                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 transition-colors"
                                      title="Effective"
                                    >
                                      <ThumbsUp className="h-3 w-3" />
                                      <span>Effective</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRecordUse(skill.id, 'partial')}
                                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                                      title="Partial"
                                    >
                                      <Minus className="h-3 w-3" />
                                      <span>Partial</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRecordUse(skill.id, 'ineffective')}
                                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                      title="Ineffective"
                                    >
                                      <ThumbsDown className="h-3 w-3" />
                                      <span>Low</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                              {/* Usage history button */}
                              <button
                                type="button"
                                onClick={() => toggleUsageHistory(skill.id)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                title="Usage history"
                              >
                                <Activity className="h-3.5 w-3.5" />
                                {usageExpandedId === skill.id ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                              </button>
                              {isSystem ? (
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={!!skill.enabled}
                                  onClick={() => handleToggle(skill.id)}
                                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                    skill.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
                                      skill.enabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => startEdit(skill)}
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                    title="编辑"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setDeleteConfirmId(skill.id)}
                                    className="shrink-0 text-muted-foreground hover:text-destructive"
                                    title="删除"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Expanded: Linked Events */}
                          {isExpanded && (
                            <div className="mt-3 border-t pt-3">
                              {isLoadingLinked ? (
                                <div className="py-4 text-center text-xs text-muted-foreground">
                                  Loading linked events...
                                </div>
                              ) : linked && linked.stats.total > 0 ? (
                                <>
                                  {/* Stats row */}
                                  <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                      <BarChart3 className="h-3 w-3" />
                                      {linked.stats.total} events
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {linked.stats.total_minutes} min
                                    </span>
                                    {Object.entries(linked.stats.by_outcome).map(([outcome, count]) => (
                                      <Badge
                                        key={outcome}
                                        variant="outline"
                                        className={`text-[10px] px-1.5 ${
                                          outcome === 'effective' ? 'border-green-400 text-green-600' :
                                          outcome === 'failed' || outcome === 'error-exit' ? 'border-red-400 text-red-600' :
                                          'border-gray-300'
                                        }`}
                                      >
                                        {outcome}: {count}
                                      </Badge>
                                    ))}
                                  </div>
                                  {/* By-project breakdown */}
                                  {Object.keys(linked.stats.by_project).length > 0 && (
                                    <div className="mb-3 flex flex-wrap gap-1.5">
                                      {Object.entries(linked.stats.by_project).map(([proj, count]) => (
                                        <span key={proj} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                          {proj} ({count})
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {/* Event list */}
                                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                                    {linked.events.slice(0, 15).map((ev) => (
                                      <div
                                        key={ev.id}
                                        className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors"
                                      >
                                        <span className={`h-2 w-2 shrink-0 rounded-full ${sourceColorMap[ev.source] || 'bg-gray-400'}`} />
                                        <span className="truncate flex-1">{ev.title}</span>
                                        <Badge variant="outline" className="text-[10px] px-1 shrink-0">
                                          {ev.event_type}
                                        </Badge>
                                        {ev.duration_minutes != null && (
                                          <span className="text-[10px] text-muted-foreground shrink-0">
                                            {ev.duration_minutes}m
                                          </span>
                                        )}
                                        <span className="text-[10px] text-muted-foreground shrink-0 w-16 text-right">
                                          {formatDate(ev.started_at)}
                                        </span>
                                      </div>
                                    ))}
                                    {linked.events.length > 15 && (
                                      <div className="text-center text-[11px] text-muted-foreground py-1">
                                        +{linked.events.length - 15} more events
                                      </div>
                                    )}
                                  </div>
                                </>
                              ) : linked ? (
                                <div className="py-4 text-center text-xs text-muted-foreground">
                                  No events linked to this skill yet.
                                </div>
                              ) : null}
                            </div>
                          )}

                          {/* Expanded: Usage History */}
                          {usageExpandedId === skill.id && (
                            <div className="mt-3 border-t pt-3">
                              {usageLoading === skill.id ? (
                                <div className="py-4 text-center text-xs text-muted-foreground">
                                  Loading usage history...
                                </div>
                              ) : usageData[skill.id] ? (
                                (() => {
                                  const ud = usageData[skill.id];
                                  const outcomeColors: Record<string, string> = {
                                    effective: 'border-green-400 text-green-600',
                                    partial: 'border-amber-400 text-amber-600',
                                    ineffective: 'border-red-400 text-red-600',
                                  };
                                  return (
                                    <>
                                      {/* Stats row */}
                                      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                                          <BarChart3 className="h-3 w-3" />
                                          {ud.total} uses
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                                          <Clock className="h-3 w-3" />
                                          {ud.total_time_saved} min saved
                                        </span>
                                        {ud.effective_count > 0 && (
                                          <Badge variant="outline" className="text-[10px] px-1.5 border-green-400 text-green-600">
                                            Effective: {ud.effective_count}
                                          </Badge>
                                        )}
                                        {ud.partial_count > 0 && (
                                          <Badge variant="outline" className="text-[10px] px-1.5 border-amber-400 text-amber-600">
                                            Partial: {ud.partial_count}
                                          </Badge>
                                        )}
                                        {ud.ineffective_count > 0 && (
                                          <Badge variant="outline" className="text-[10px] px-1.5 border-red-400 text-red-600">
                                            Ineffective: {ud.ineffective_count}
                                          </Badge>
                                        )}
                                      </div>
                                      {/* Effectiveness bar */}
                                      {ud.total > 0 && (
                                        <div className="mb-3">
                                          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                                            <div className="bg-green-500" style={{ width: `${(ud.effective_count / ud.total) * 100}%` }} />
                                            <div className="bg-amber-400" style={{ width: `${(ud.partial_count / ud.total) * 100}%` }} />
                                            <div className="bg-red-400" style={{ width: `${(ud.ineffective_count / ud.total) * 100}%` }} />
                                          </div>
                                          <div className="mt-1 text-right text-[10px] text-muted-foreground">
                                            Avg effectiveness: {Math.round(ud.avg_effectiveness * 100)}%
                                          </div>
                                        </div>
                                      )}
                                      {/* Log list */}
                                      {ud.logs.length > 0 ? (
                                        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                                          {ud.logs.map((log: any) => (
                                            <div
                                              key={log.id}
                                              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors"
                                            >
                                              <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 shrink-0 ${outcomeColors[log.outcome] || ''}`}
                                              >
                                                {log.outcome}
                                              </Badge>
                                              {log.time_saved_minutes > 0 && (
                                                <span className="text-[10px] text-muted-foreground shrink-0">
                                                  +{log.time_saved_minutes}m
                                                </span>
                                              )}
                                              {log.notes && (
                                                <span className="truncate flex-1 text-muted-foreground">{log.notes}</span>
                                              )}
                                              <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                                                {log.used_at ? formatDate(log.used_at) : ''}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="py-4 text-center text-xs text-muted-foreground">
                                          No usage records yet. Click the Play button to record a use.
                                        </div>
                                      )}
                                    </>
                                  );
                                })()
                              ) : null}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除 Skill</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，确定要删除这个 Skill 吗？
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
