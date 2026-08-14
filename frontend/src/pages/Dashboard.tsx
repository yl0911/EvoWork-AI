import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie, AreaChart, Area, ComposedChart,
} from 'recharts';
import {
  Activity, Clock, Brain, Terminal, CalendarDays,
  ArrowUpRight, ArrowDownRight, Target,
  Sparkles, Lightbulb, ChevronDown, ChevronUp, ChevronRight, Loader2, RefreshCw, Check, Plus, Zap, TrendingUp,
} from 'lucide-react';
import { api } from '@/lib/api';

type Period = 'week' | 'month' | 'year';

interface DashboardProps {
  period: Period;
}

const PRIMARY = 'hsl(262, 83%, 58%)';

const PIE_COLORS = [
  'hsl(262, 83%, 58%)', 'hsl(200, 80%, 55%)', 'hsl(142, 60%, 45%)',
  'hsl(38, 90%, 55%)',  'hsl(350, 75%, 55%)', 'hsl(280, 60%, 65%)',
  'hsl(170, 60%, 45%)', 'hsl(20, 80%, 55%)',
];

const BAR_COLORS = [
  'hsl(262, 83%, 58%)', 'hsl(262, 83%, 68%)', 'hsl(262, 83%, 78%)',
  'hsl(262, 60%, 65%)', 'hsl(262, 50%, 72%)', 'hsl(262, 40%, 78%)',
];

/* ── helpers ────────────────────────────────────────────────────── */

const toChartData = (dict: Record<string, number> | undefined) =>
  dict ? Object.entries(dict).map(([name, value]) => ({ name, value })) : [];

function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

function fmtDelta(cur: number, prev: number): { text: string; positive: boolean; prev: number } {
  if (prev === 0) return cur > 0 ? { text: '+new', positive: true, prev: 0 } : { text: '—', positive: true, prev: 0 };
  const pct = Math.round(((cur - prev) / prev) * 100);
  return {
    text: pct >= 0 ? `+${pct}%` : `${pct}%`,
    positive: pct >= 0,
    prev,
  };
}

/* ── Skill 草稿解析 ────────────────────────────────────────────── */

interface ParsedSkill {
  name: string;
  category: string;
  trigger: string;
  steps: string[];
  inputs: string[];
  outputs: string[];
  success_criteria: string;
  failure_fallback: string;
  agent_assistable_parts: string[];
  raw: string;
}

function parseSkillDrafts(markdown: string): ParsedSkill[] {
  // 按 ## Skill 分节
  const sections = markdown.split(/(?=^## Skill \d+[:：])/m);
  const drafts: ParsedSkill[] = [];

  for (const section of sections) {
    const headerMatch = section.match(/^## Skill \d+[:：]\s*(.+)/);
    if (!headerMatch) continue;

    const name = headerMatch[1].trim().replace(/^\[|\]$/g, '');

    // 提取 **字段**: 值 模式
    const extract = (label: string): string => {
      const patterns = [
        new RegExp(`\\*\\*${label}\\*\\*[:：]\\s*(.+?)(?=\\n\\*\\*|\\n##|$)`, 's'),
        new RegExp(`${label}[:：]\\s*(.+?)(?=\\n\\*\\*|\\n##|\\n$)`, 's'),
      ];
      for (const p of patterns) {
        const m = section.match(p);
        if (m) return m[1].trim();
      }
      return '';
    };

    // 提取步骤列表
    const extractSteps = (): string[] => {
      const stepsSection = section.match(/\*\*方法论步骤\*\*[:：]\s*\n([\s\S]*?)(?=\n\*\*|$)/);
      if (!stepsSection) return [];
      return stepsSection[1]
        .split('\n')
        .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(l => l && !l.startsWith('（') && !l.startsWith('('));
    };

    // 提取逗号/顿号分隔的列表
    const extractList = (label: string): string[] => {
      const raw = extract(label);
      if (!raw || raw === '待补充' || raw === '无') return [];
      return raw.split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
    };

    // 映射 category
    const catRaw = extract('Skill 类型');
    let category = 'thinking';
    if (/可复用|reusable/i.test(catRaw)) category = 'reusable';
    else if (/开源|open.?source/i.test(catRaw)) category = 'open_source';

    drafts.push({
      name,
      category,
      trigger: extract('触发条件'),
      steps: extractSteps(),
      inputs: extractList('需要输入'),
      outputs: extractList('输出产物'),
      success_criteria: extract('成功判断'),
      failure_fallback: extract('失败回退'),
      agent_assistable_parts: extractList('可由 Agent 辅助的部分'),
      raw: section.trim(),
    });
  }

  return drafts;
}

/* ── component ──────────────────────────────────────────────────── */

export default function Dashboard({ period }: DashboardProps) {
  const [insights, setInsights] = useState<any>(null);
  const [shell, setShell] = useState<any>(null);
  const [patterns, setPatterns] = useState<any>(null);
  const [prevInsights, setPrevInsights] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  /* ── AI quick actions ── */
  const [reviewResult, setReviewResult] = useState<any>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draftResult, setDraftResult] = useState<any>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [publishedSkills, setPublishedSkills] = useState<Set<string>>(new Set());
  const [publishingSkill, setPublishingSkill] = useState<string | null>(null);
  const [analyzedTasks, setAnalyzedTasks] = useState<any[]>([]);
  const [analyzedLoading, setAnalyzedLoading] = useState(false);
  const [expandedAnalysisProjects, setExpandedAnalysisProjects] = useState<Set<string>>(new Set());
  const [showAllProjects, setShowAllProjects] = useState(false);

  /* ── analyzed task metrics ── */
  const analysisMetrics = useMemo(() => {
    const tasks = analyzedTasks;
    const total = tasks.length;
    const scored = tasks.filter(t => t.efficiency_score != null);
    const avgEfficiency = scored.length > 0
      ? Math.round(scored.reduce((s, t) => s + (t.efficiency_score || 0), 0) / scored.length * 10) / 10
      : 0;
    const resolved = tasks.filter(t => t.result === 'resolved').length;
    const resolveRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    const typeDist: Record<string, number> = {};
    for (const t of tasks) typeDist[t.activity_type] = (typeDist[t.activity_type] || 0) + 1;
    const typeData = Object.entries(typeDist)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }));

    // Single-pass project grouping: accumulate count, resolved, effSum, effCount
    const projMap: Record<string, { count: number; resolved: number; effSum: number; effCount: number }> = {};
    for (const t of tasks) {
      const key = t.project || '未归属';
      if (!projMap[key]) projMap[key] = { count: 0, resolved: 0, effSum: 0, effCount: 0 };
      projMap[key].count++;
      if (t.result === 'resolved') projMap[key].resolved++;
      if (t.efficiency_score != null) {
        projMap[key].effSum += t.efficiency_score;
        projMap[key].effCount++;
      }
    }
    const projectData: [string, { count: number; avgEff: number; resolved: number }][] =
      Object.entries(projMap)
        .map(([name, d]) => [name, {
          count: d.count,
          avgEff: d.effCount > 0 ? Math.round(d.effSum / d.effCount * 10) / 10 : 0,
          resolved: d.resolved,
        }] as [string, { count: number; avgEff: number; resolved: number }])
        .sort(([, a], [, b]) => b.count - a.count);

    const theoryHighlights = tasks
      .filter(t => t.reference_theory)
      .map(t => ({ title: t.title, theory: t.reference_theory }))
      .slice(0, 3);

    return { total, avgEfficiency, resolveRate, resolved, typeData, projectData, theoryHighlights };
  }, [analyzedTasks]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      // Reset AI results on period change so they'll be re-generated
      setReviewResult(null);
      setReviewOpen(false);
      setDraftResult(null);
      setDraftOpen(false);
      setPublishedSkills(new Set());
      setAnalyzedTasks([]);
      try {
        const [ins, sh, pat, prev] = await Promise.all([
          api.insightsSummary(period),
          api.shellAnalysis(period).catch(() => null),
          api.workPatterns(period).catch(() => null),
          // "上一周期"：用同长度时间窗口，但这里简化为同 period 对比
          // 实际可用 month 数据截取前/后半月；这里仅拉取同周期作参照
          api.insightsSummary(period === 'week' ? 'month' : period === 'month' ? 'year' : 'year')
            .catch(() => null),
        ]);
        if (!cancelled) {
          setInsights(ins);
          setShell(sh);
          setPatterns(pat);
          setPrevInsights(prev);
        }
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [period]);

  useEffect(() => {
    async function fetchAnalyzed() {
      setAnalyzedLoading(true);
      try {
        const res = await api.analyzedTasks(period, 100);
        setAnalyzedTasks(res.tasks ?? []);
      } catch { /* swallow */ }
      setAnalyzedLoading(false);
    }
    fetchAnalyzed();
  }, [period]);

  /* ── AI quick action handlers ── */
  async function handlePeriodReview() {
    if (reviewResult) { setReviewOpen(v => !v); return; }
    setReviewLoading(true);
    setReviewOpen(true);
    try {
      const res = await api.periodReview(period);
      setReviewResult(res);
    } catch (err) {
      console.error('Period review error:', err);
      setReviewResult({ content: 'AI 服务暂不可用，请稍后重试。', error: true });
    } finally {
      setReviewLoading(false);
    }
  }

  async function handlePeriodRefresh() {
    setReviewLoading(true);
    setReviewOpen(true);
    try {
      const res = await api.periodReview(period, true);
      setReviewResult(res);
    } catch (err) {
      console.error('Period review error:', err);
      setReviewResult({ content: 'AI 服务暂不可用，请稍后重试。', error: true });
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleSkillDraft() {
    if (draftResult) { setDraftOpen(v => !v); return; }
    setDraftLoading(true);
    setDraftOpen(true);
    try {
      const res = await api.skillDraft(period);
      setDraftResult(res);
    } catch (err) {
      console.error('Skill draft error:', err);
      setDraftResult({ content: 'AI 服务暂不可用，请稍后重试。', error: true });
    } finally {
      setDraftLoading(false);
    }
  }

  async function handleDraftRefresh() {
    setDraftLoading(true);
    setDraftOpen(true);
    try {
      const res = await api.skillDraft(period, undefined, true);
      setDraftResult(res);
    } catch (err) {
      console.error('Skill draft error:', err);
      setDraftResult({ content: 'AI 服务暂不可用，请稍后重试。', error: true });
    } finally {
      setDraftLoading(false);
    }
  }

  async function publishSkill(skill: ParsedSkill) {
    setPublishingSkill(skill.name);
    try {
      await api.createSkill({
        name: skill.name,
        category: skill.category,
        trigger: skill.trigger || null,
        content: skill.raw,
        steps: skill.steps,
        inputs: skill.inputs,
        outputs: skill.outputs,
        source: 'ai_generated',
        success_criteria: skill.success_criteria || null,
        failure_fallback: skill.failure_fallback || null,
        agent_assistable: skill.agent_assistable_parts.length > 0,
        agent_assistable_parts: skill.agent_assistable_parts.length > 0 ? skill.agent_assistable_parts : null,
      });
      setPublishedSkills(prev => new Set(prev).add(skill.name));
    } catch (err) {
      console.error('Publish skill error:', err);
    } finally {
      setPublishingSkill(null);
    }
  }

  /* ── derive metrics ── */
  const totalEvents   = insights?.total_events   ?? 0;
  const totalMinutes  = insights?.total_minutes  ?? 0;
  const skillCount    = insights?.skill_count    ?? 0;
  const activeDays    = patterns?.active_days    ?? 0;
  const projSwitches  = patterns?.project_switches ?? 0;

  /* ── delta vs broader period ── */
  const prevEvents  = prevInsights?.total_events  ?? 0;
  const prevMinutes = prevInsights?.total_minutes ?? 0;
  const prevSkills  = prevInsights?.skill_count   ?? 0;
  const evDelta     = fmtDelta(totalEvents, prevEvents);
  const minDelta    = fmtDelta(totalMinutes, prevMinutes);
  const skillDelta  = fmtDelta(skillCount, prevSkills);

  /* ── chart data ── */
  const sourceData     = toChartData(insights?.source_minutes);
  const eventTypeData  = toChartData(insights?.event_type_minutes);
  const projectData    = toChartData(insights?.project_minutes).slice(0, 8);
  const dailyEventMap  = new Map(toChartData(patterns?.daily_event_count).map(d => [d.name, d.value]));
  const dailyTimeData  = toChartData(insights?.daily_minutes).map(d => ({ ...d, label: fmtDate(d.name), events: dailyEventMap.get(d.name) ?? 0 }));
  const hourlyData     = toChartData(patterns?.hourly_distribution).map(d => ({ name: `${d.name}:00`, value: d.value }));

  /* ── shell stats ── */
  const shellTotal  = shell?.total_commands ?? 0;
  const shellError  = shell?.error_rate     ?? 0;
  const shellTop    = (shell?.top_commands ?? []).slice(0, 5);

  /* ── outcome ── */
  const outcomes = insights?.outcomes ?? {};
  const resolved = outcomes.resolved ?? 0;
  const totalOutcomes = Object.values(outcomes).reduce((a: number, b: any) => a + (b as number), 0);
  const resolveRate = totalOutcomes > 0 ? Math.round((resolved / totalOutcomes) * 100) : 0;

  const periodLabel: Record<string, string> = { week: '本周', month: '本月', year: '今年' };
  const prevLabel: Record<string, string>   = { week: 'vs 本月', month: 'vs 今年', year: '' };

  /* ── auto-generated smart insights ── */
  const smartInsights = useMemo(() => {
    const result: { type: 'positive' | 'warning' | 'info'; title: string; desc: string }[] = [];
    try {
      const dailyData = toChartData(insights?.daily_minutes);
      if (dailyData.length > 0) {
        const topDay = dailyData.reduce((a, b) => a.value > b.value ? a : b);
        const avgMin = Math.round(dailyData.reduce((s, d) => s + d.value, 0) / dailyData.length);
        result.push({ type: 'info', title: '最高产出日', desc: `${fmtDate(topDay.name)} 记录了 ${topDay.value} 分钟（日均 ${avgMin} 分钟）` });
      }
      if (analysisMetrics.typeData.length > 0) {
        const top = analysisMetrics.typeData[0];
        const pct = Math.round((top.value / analysisMetrics.total) * 100);
        result.push({ type: 'info', title: '主要活动', desc: `${top.name} 占任务的 ${pct}%（${top.value}/${analysisMetrics.total} 个任务）` });
      }
      if (analysisMetrics.avgEfficiency > 0) {
        const eff = analysisMetrics.avgEfficiency;
        result.push({
          type: eff >= 3.5 ? 'positive' : eff >= 2.5 ? 'info' : 'warning',
          title: '效率评估',
          desc: eff >= 3.5 ? `平均效率 ${eff.toFixed(1)}/5，工作流程较为高效` : eff >= 2.5 ? `平均效率 ${eff.toFixed(1)}/5，仍有提升空间` : `平均效率 ${eff.toFixed(1)}/5，建议关注瓶颈环节`,
        });
      }
      if (prevInsights && totalEvents > 0) {
        const prevEv = prevInsights.total_events || 0;
        if (prevEv > 0) {
          const change = Math.round(((totalEvents - prevEv) / prevEv) * 100);
          if (Math.abs(change) >= 10) {
            result.push({
              type: change > 0 ? 'positive' : 'warning',
              title: change > 0 ? '活跃度增长' : '活跃度下降',
              desc: change > 0 ? `事件数较上期增长 ${change}%（${prevEv} → ${totalEvents}）` : `事件数较上期下降 ${Math.abs(change)}%（${prevEv} → ${totalEvents}）`,
            });
          }
        }
      }
      if (projectData.length > 0) {
        const totalProjMin = projectData.reduce((s, p) => s + p.value, 0);
        if (totalProjMin > 0) {
          const topPct = Math.round((projectData[0].value / totalProjMin) * 100);
          if (topPct >= 40) result.push({ type: 'info', title: '项目聚焦', desc: `${projectData[0].name} 占总时间的 ${topPct}%` });
          else if (projectData.length >= 3 && topPct < 30) result.push({ type: 'warning', title: '注意力分散', desc: `Top 项目仅占 ${topPct}% 时间，${projectData.length} 个项目并行` });
        }
      }
      const hourly = toChartData(patterns?.hourly_distribution);
      if (hourly.length > 0) {
        const peakHour = hourly.reduce((a, b) => a.value > b.value ? a : b);
        result.push({ type: 'info', title: '活跃高峰', desc: `${peakHour.name}:00 是最高活跃时段` });
      }
    } catch { /* keep as is */ }
    return result;
  }, [insights, prevInsights, patterns, totalEvents, analysisMetrics, projectData]);

  return (
    <div className="space-y-6 p-6">
      {/* ─── Row 1: KPI cards ─── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEvents}</div>
            {prevInsights && (
              <p className={`mt-1 flex items-center text-xs ${evDelta.positive ? 'text-green-600' : 'text-red-500'}`}>
                {evDelta.positive ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
                {evDelta.text} {prevLabel[period]}{evDelta.prev > 0 ? ` (prev: ${evDelta.prev})` : ''}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Minutes</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMinutes}</div>
            {prevInsights && (
              <p className={`mt-1 flex items-center text-xs ${minDelta.positive ? 'text-green-600' : 'text-red-500'}`}>
                {minDelta.positive ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
                {minDelta.text} {prevLabel[period]}{minDelta.prev > 0 ? ` (prev: ${minDelta.prev})` : ''}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Skills</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{skillCount}</div>
            {prevInsights && (
              <p className={`mt-1 flex items-center text-xs ${skillDelta.positive ? 'text-green-600' : 'text-red-500'}`}>
                {skillDelta.positive ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
                {skillDelta.text} {prevLabel[period]}{skillDelta.prev > 0 ? ` (prev: ${skillDelta.prev})` : ''}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Days</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeDays}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {projSwitches} project switches
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Smart Insights ─── */}
      {smartInsights.length > 0 && !loading && (
        <Card className="border-dashed border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: PRIMARY }} />
              <CardTitle className="text-sm font-medium">数据洞察</CardTitle>
              <Badge variant="secondary" className="text-[10px]">自动生成</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {smartInsights.map((insight, i) => {
                const iconCls = insight.type === 'positive' ? 'text-green-500' : insight.type === 'warning' ? 'text-amber-500' : '';
                const icon = insight.type === 'positive' ? <Check className="h-3.5 w-3.5" /> : insight.type === 'warning' ? <Activity className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />;
                const bgCls = insight.type === 'positive' ? 'bg-green-50/60 dark:bg-green-950/15' : insight.type === 'warning' ? 'bg-amber-50/60 dark:bg-amber-950/15' : 'bg-purple-50/60 dark:bg-purple-950/15';
                return (
                  <div key={i} className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 ${bgCls}`}>
                    <div className={`mt-0.5 shrink-0 ${iconCls}`}>{icon}</div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold" style={{ color: 'hsl(224, 71%, 4%)' }}>{insight.title}</p>
                      <p className="text-[11px] text-muted-foreground">{insight.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── AI Quick Actions ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Period Review */}
        <Card className="border-dashed">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-medium">AI {periodLabel[period]}复盘</CardTitle>
              {reviewResult?.cached && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">缓存</Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {reviewResult && !reviewResult.error && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={handlePeriodRefresh}
                  disabled={reviewLoading}
                  title="重新生成"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${reviewLoading ? 'animate-spin' : ''}`} />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handlePeriodReview}
                disabled={reviewLoading}
              >
                {reviewLoading ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 生成中…</>
                ) : reviewResult ? (
                  <>{reviewOpen ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                    {reviewOpen ? '收起' : '展开'}</>
                ) : (
                  <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> 生成</>
                )}
              </Button>
            </div>
          </CardHeader>
          {reviewOpen && (
            <CardContent className="pt-0">
              {reviewLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              ) : reviewResult ? (
                <div className={`max-h-[400px] overflow-y-auto rounded-md bg-secondary/30 p-3 text-sm ${reviewResult.error ? 'text-muted-foreground italic' : ''}`}>
                  {reviewResult.error ? (
                    reviewResult.content
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5" style={{ color: 'hsl(224, 71%, 4%)' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewResult.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          )}
        </Card>

        {/* Skill Draft */}
        <Card className="border-dashed">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-medium">AI Skill 草稿</CardTitle>
              {draftResult?.cached && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">缓存</Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {draftResult && !draftResult.error && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={handleDraftRefresh}
                  disabled={draftLoading}
                  title="重新生成"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${draftLoading ? 'animate-spin' : ''}`} />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSkillDraft}
                disabled={draftLoading}
              >
                {draftLoading ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 生成中…</>
                ) : draftResult ? (
                  <>{draftOpen ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                    {draftOpen ? '收起' : '展开'}</>
                ) : (
                  <><Lightbulb className="mr-1.5 h-3.5 w-3.5" /> 生成</>
                )}
              </Button>
            </div>
          </CardHeader>
          {draftOpen && (
            <CardContent className="pt-0">
              {draftLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              ) : draftResult ? (
                <div className="max-h-[500px] overflow-y-auto space-y-2">
                  {draftResult.error ? (
                    <div className="rounded-md bg-secondary/30 p-3 text-sm text-muted-foreground italic">
                      {draftResult.content}
                    </div>
                  ) : (() => {
                    const parsed = parseSkillDrafts(draftResult.content);
                    if (parsed.length === 0) {
                      // 解析失败，回退显示原始 markdown
                      return (
                        <div className="rounded-md bg-secondary/30 p-3 text-sm">
                          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5" style={{ color: 'hsl(224, 71%, 4%)' }}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draftResult.content}</ReactMarkdown>
                          </div>
                        </div>
                      );
                    }
                    return parsed.map((skill) => {
                      const isPublished = publishedSkills.has(skill.name);
                      const isPublishing = publishingSkill === skill.name;
                      return (
                        <div key={skill.name} className="rounded-md border bg-card p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold" style={{ color: 'hsl(224, 71%, 4%)' }}>{skill.name}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {skill.category === 'reusable' ? '可复用型' : skill.category === 'open_source' ? '开源候选' : '思路型'}
                              </Badge>
                            </div>
                            <Button
                              size="sm"
                              variant={isPublished ? 'secondary' : 'default'}
                              className="h-7 text-xs px-2.5"
                              disabled={isPublished || isPublishing}
                              onClick={() => publishSkill(skill)}
                            >
                              {isPublishing ? (
                                <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> 发布中</>
                              ) : isPublished ? (
                                <><Check className="mr-1 h-3 w-3" /> 已发布</>
                              ) : (
                                <><Plus className="mr-1 h-3 w-3" /> 发布为 Skill</>
                              )}
                            </Button>
                          </div>
                          {skill.trigger && (
                            <p className="text-xs text-muted-foreground mb-1">触发: {skill.trigger}</p>
                          )}
                          {skill.steps.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              步骤: {skill.steps.slice(0, 3).join(' → ')}{skill.steps.length > 3 ? ` (+${skill.steps.length - 3})` : ''}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : null}
            </CardContent>
          )}
        </Card>
      </div>

      {/* ─── Analysis Insights ─── */}
      {analysisMetrics.total > 0 && (
        <>
          {/* Mini KPI row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="bg-gradient-to-br from-purple-50 to-transparent dark:from-purple-950/10">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <Target className="h-4 w-4" style={{ color: PRIMARY }} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">分析任务</p>
                  <p className="text-xl font-bold">{analysisMetrics.total}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-amber-50 to-transparent dark:from-amber-950/10">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Zap className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">平均效率</p>
                  <p className="text-xl font-bold">
                    {analysisMetrics.avgEfficiency > 0 ? analysisMetrics.avgEfficiency.toFixed(1) : '—'}
                    <span className="ml-1 text-xs font-normal text-amber-500">
                      {analysisMetrics.avgEfficiency > 0 ? '★'.repeat(Math.round(analysisMetrics.avgEfficiency)) : ''}
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-50 to-transparent dark:from-green-950/10">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <Check className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">解决率</p>
                  <p className="text-xl font-bold text-green-600">{analysisMetrics.resolveRate}%</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-blue-50 to-transparent dark:from-blue-950/10">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Activity className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">涉及项目</p>
                  <p className="text-xl font-bold">{analysisMetrics.projectData.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Activity type distribution + Theory highlights */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">活动类型分布</CardTitle>
              </CardHeader>
              <CardContent>
                {analysisMetrics.typeData.length > 0 ? (
                  <div className="space-y-2">
                    {analysisMetrics.typeData.map(({ name, value }) => {
                      const maxVal = analysisMetrics.typeData[0].value || 1;
                      const color = ({ '编码开发': '#22c55e', '调试修复': '#ef4444', '问题排查': '#f59e0b', '学习调研': '#3b82f6', '部署运维': '#8b5cf6', '文档写作': '#06b6d4', '浏览阅读': '#64748b' } as Record<string, string>)[name] || '#94a3b8';
                      const pct = Math.round((value / analysisMetrics.total) * 100);
                      return (
                        <div key={name} className="flex items-center gap-2.5">
                          <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">{name}</span>
                          <div className="flex-1">
                            <div className="h-5 w-full overflow-hidden rounded bg-secondary/50">
                              <div
                                className="flex h-full items-center rounded px-1.5 text-[10px] font-medium text-white transition-all"
                                style={{ width: `${Math.max((value / maxVal) * 100, 10)}%`, backgroundColor: color }}
                              >
                                {value}
                              </div>
                            </div>
                          </div>
                          <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
                )}
              </CardContent>
            </Card>

            {/* Theory highlights */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">知识点速览</CardTitle>
              </CardHeader>
              <CardContent>
                {analysisMetrics.theoryHighlights.length > 0 ? (
                  <div className="space-y-2.5">
                    {analysisMetrics.theoryHighlights.map((item, i) => (
                      <div key={i} className="rounded-lg border-l-3 border-purple-400 bg-purple-50/60 px-3 py-2 dark:bg-purple-950/15">
                        <p className="mb-0.5 text-xs font-semibold truncate" style={{ color: 'hsl(224, 71%, 4%)' }}>{item.title}</p>
                        <p className="text-[11px] text-purple-600 dark:text-purple-400 line-clamp-2">{item.theory}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-32 flex-col items-center justify-center text-sm text-muted-foreground">
                    <Lightbulb className="mb-1.5 h-5 w-5 opacity-30" />
                    <p className="text-xs">分析任务后将展示关联知识点</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Project-grouped analyzed tasks */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-medium">分析任务 · 按项目</CardTitle>
                <Badge variant="secondary" className="text-xs">{analysisMetrics.total}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {analysisMetrics.projectData.slice(0, 4).map(([project, stats]) => {
                const projectTasks = analyzedTasks.filter(t => (t.project || '未归属') === project);
                const isExpanded = expandedAnalysisProjects.has(project);
                return (
                  <div key={project} className="rounded-lg border">
                    <div
                      className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-secondary/30 transition-colors"
                      onClick={() => setExpandedAnalysisProjects(prev => {
                        const next = new Set(prev);
                        next.has(project) ? next.delete(project) : next.add(project);
                        return next;
                      })}
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        <span className="text-sm font-medium" style={{ color: 'hsl(224, 71%, 4%)' }}>{project}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{stats.count}</Badge>
                      </div>
                      <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                        {stats.avgEff > 0 && (
                          <span className="text-amber-500">{'★'.repeat(Math.round(stats.avgEff))}{'☆'.repeat(5 - Math.round(stats.avgEff))}</span>
                        )}
                        {stats.resolved > 0 && (
                          <span className="text-green-600">{stats.resolved}/{stats.count} 已解决</span>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t px-3 py-2 space-y-1.5">
                        {projectTasks.slice(0, 5).map(task => {
                          const color = ({ '编码开发': '#22c55e', '调试修复': '#ef4444', '问题排查': '#f59e0b', '学习调研': '#3b82f6', '部署运维': '#8b5cf6', '文档写作': '#06b6d4' } as Record<string, string>)[task.activity_type] || '#94a3b8';
                          return (
                            <div key={task.id} className="rounded-md bg-secondary/20 px-3 py-2">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium truncate flex-1" style={{ color: 'hsl(224, 71%, 4%)' }}>{task.title}</span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0" style={{ borderColor: `${color}60`, color }}>{task.activity_type}</Badge>
                                <span className="text-[9px] shrink-0" style={{ color: task.result === 'resolved' ? '#22c55e' : '#f59e0b' }}>
                                  {task.result === 'resolved' ? '✓' : task.result === 'unresolved' ? '✗' : '◐'}
                                </span>
                                {task.efficiency_score && (
                                  <span className="text-[9px] text-amber-500 shrink-0">{'★'.repeat(task.efficiency_score)}</span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-1">{task.problem_description}</p>
                              {task.reference_theory && (
                                <p className="mt-0.5 text-[10px] text-purple-500 dark:text-purple-400 truncate">💡 {task.reference_theory}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      {/* ─── Daily trend (dual axis: minutes + events) ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">每日工作趋势</CardTitle>
              {dailyTimeData.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  共 {dailyTimeData.length} 天 · 日均 {Math.round(dailyTimeData.reduce((s, d) => s + d.value, 0) / dailyTimeData.length)} 分钟 · 日均 {Math.round(dailyTimeData.reduce((s, d) => s + d.events, 0) / dailyTimeData.length)} 个事件
                </p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {dailyTimeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={dailyTimeData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradPurple" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PRIMARY} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PRIMARY} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(val: any, name: any) =>
                    name === 'minutes' ? [`${val} min`, '工作时长'] : [`${val} 个`, '事件数']
                  }
                />
                <Legend formatter={(v) => v === 'minutes' ? '工作时长 (min)' : '事件数'} />
                <Area yAxisId="left" type="natural" dataKey="value" stroke={PRIMARY} fill="url(#gradPurple)" strokeWidth={2.5} name="minutes" dot={{ r: 3, fill: PRIMARY }} activeDot={{ r: 5 }} />
                <Bar yAxisId="right" dataKey="events" fill="hsl(200, 80%, 55%)" radius={[3, 3, 0, 0]} barSize={18} name="events" fillOpacity={0.7} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              {loading ? <Skeleton className="h-full w-full" /> : 'No data available'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Row 3: Source pie + Project ranking ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Source pie with enhanced details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">数据来源分布</CardTitle>
            {sourceData.length > 0 && (
              <p className="text-xs text-muted-foreground">
                总计 {sourceData.reduce((s, d) => s + d.value, 0)} 分钟 · {sourceData.length} 个来源
              </p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 sm:flex-row">
            {sourceData.length > 0 ? (
              <>
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={sourceData}
                      cx="50%" cy="50%"
                      innerRadius={45}
                      outerRadius={80}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {sourceData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val: any) => [`${val} min`, '']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1.5 flex-1">
                  {sourceData.map((d, i) => {
                    const totalMin = sourceData.reduce((s, x) => s + x.value, 0);
                    const pct = totalMin > 0 ? Math.round((d.value / totalMin) * 100) : 0;
                    return (
                      <div key={d.name} className="flex items-center gap-2 text-xs">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="w-16 shrink-0 truncate">{d.name}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        </div>
                        <span className="w-10 text-right text-muted-foreground shrink-0">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex h-48 w-full items-center justify-center text-sm text-muted-foreground">
                {loading ? <Skeleton className="h-full w-full" /> : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Project ranking with efficiency badges */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">项目时间排行</CardTitle>
            {projectData.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Top 项目占总时间 {Math.round((projectData[0].value / projectData.reduce((s, p) => s + p.value, 0)) * 100)}%
              </p>
            )}
          </CardHeader>
          <CardContent>
            {projectData.length > 0 ? (
              <div className="space-y-2.5">
                {projectData.map((p, i) => {
                  const maxVal = projectData[0].value || 1;
                  // Find matching analyzed task project for efficiency badge
                  const matchedProject = analysisMetrics.projectData.find(([name]) => name === p.name);
                  const avgEff = matchedProject ? matchedProject[1].avgEff : 0;
                  return (
                    <div key={p.name} className="flex items-center gap-3">
                      <span className="w-5 text-right text-xs font-medium text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="mb-0.5 flex items-center justify-between text-sm">
                          <span className="truncate">{p.name}</span>
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            {avgEff > 0 && (
                              <span className="text-[10px] text-amber-500">{avgEff.toFixed(1)}★</span>
                            )}
                            <span className="text-muted-foreground">{p.value}m</span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(p.value / maxVal) * 100}%`,
                              backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {loading ? <Skeleton className="h-full w-full" /> : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Row 4: Project efficiency + Hourly distribution ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Project efficiency from analyzed tasks */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" style={{ color: PRIMARY }} />
              <CardTitle className="text-base">项目效率对比</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {analysisMetrics.projectData.length > 0 ? (
              <div className="space-y-3">
                {(showAllProjects ? analysisMetrics.projectData : analysisMetrics.projectData.slice(0, 8)).map(([project, stats]) => {
                  const maxCount = analysisMetrics.projectData[0][1].count || 1;
                  const effColor = stats.avgEff >= 4 ? '#22c55e' : stats.avgEff >= 3 ? '#f59e0b' : stats.avgEff > 0 ? '#ef4444' : '#94a3b8';
                  const resolvePct = stats.count > 0 ? Math.round((stats.resolved / stats.count) * 100) : 0;
                  return (
                    <div key={project}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="truncate font-medium">{project}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {stats.avgEff > 0 && (
                            <span className="text-xs font-medium" style={{ color: effColor }}>
                              {stats.avgEff.toFixed(1)} ★
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">{stats.count} 任务</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-3 w-full overflow-hidden rounded-full bg-secondary/50">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${(stats.count / maxCount) * 100}%`,
                              backgroundColor: effColor,
                              opacity: 0.8,
                            }}
                          />
                        </div>
                        {resolvePct > 0 && (
                          <span className="w-10 text-right text-[10px] text-green-600 shrink-0">{resolvePct}%✓</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {analysisMetrics.projectData.length > 8 && (
                  <button
                    onClick={() => setShowAllProjects(!showAllProjects)}
                    className="flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                  >
                    {showAllProjects ? (
                      <>收起 <ChevronUp className="h-3 w-3" /></>
                    ) : (
                      <>展开全部 ({analysisMetrics.projectData.length} 个项目) <ChevronDown className="h-3 w-3" /></>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center text-sm text-muted-foreground">
                <Target className="mb-1.5 h-5 w-5 opacity-30" />
                <p className="text-xs">分析事件后展示项目效率</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hourly distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hourly Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {hourlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={hourlyData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill={PRIMARY} radius={[4, 4, 0, 0]} name="events" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {loading ? <Skeleton className="h-full w-full" /> : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Row 5: Shell + Work summary ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Shell stats enhanced */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" style={{ color: PRIMARY }} />
                <CardTitle className="text-base">终端活动</CardTitle>
              </div>
              {shellTotal > 0 && activeDays > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  日均 {Math.round(shellTotal / activeDays)} 条命令
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {shellTotal > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className="text-lg font-bold">{shellTotal}</p>
                    <p className="text-[11px] text-muted-foreground">总命令数</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className={`text-lg font-bold ${shellError > 10 ? 'text-red-500' : 'text-green-600'}`}>
                      {shellError}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">错误率</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className="text-lg font-bold">{resolveRate}%</p>
                    <p className="text-[11px] text-muted-foreground">事件解决率</p>
                  </div>
                </div>
                {shellTop.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">高频命令</p>
                    <div className="space-y-1">
                      {shellTop.map((cmd: any, i: number) => {
                        const maxCmdCount = shellTop[0]?.count || 1;
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <code className="w-28 shrink-0 truncate rounded bg-secondary px-1.5 py-0.5 text-[11px]">
                              {cmd.command}
                            </code>
                            <div className="flex-1 h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(cmd.count / maxCmdCount) * 100}%`, backgroundColor: PRIMARY, opacity: 0.6 }} />
                            </div>
                            <span className="w-6 text-right text-[10px] text-muted-foreground shrink-0">{cmd.count}x</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center text-sm text-muted-foreground">
                <Terminal className="mb-1.5 h-5 w-5 opacity-30" />
                <p className="text-xs">暂无终端数据，安装 Shell Hook 后自动采集</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Period summary */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4" style={{ color: PRIMARY }} />
              <CardTitle className="text-base">{periodLabel[period]}工作摘要</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Time overview */}
              <div className="rounded-lg bg-secondary/30 p-3">
                <p className="mb-1.5 text-xs font-semibold" style={{ color: 'hsl(224, 71%, 4%)' }}>时间投入</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-sm font-bold">{totalMinutes}</p>
                    <p className="text-[10px] text-muted-foreground">总分钟</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold">{activeDays}</p>
                    <p className="text-[10px] text-muted-foreground">活跃天</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold">{activeDays > 0 ? Math.round(totalMinutes / activeDays) : 0}</p>
                    <p className="text-[10px] text-muted-foreground">日均分钟</p>
                  </div>
                </div>
              </div>

              {/* Task overview */}
              {analysisMetrics.total > 0 && (
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="mb-1.5 text-xs font-semibold" style={{ color: 'hsl(224, 71%, 4%)' }}>任务完成</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-sm font-bold">{analysisMetrics.total}</p>
                      <p className="text-[10px] text-muted-foreground">分析任务</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-green-600">{analysisMetrics.resolved}</p>
                      <p className="text-[10px] text-muted-foreground">已解决</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold">
                        {analysisMetrics.avgEfficiency > 0 ? analysisMetrics.avgEfficiency.toFixed(1) : '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground">效率分</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Repeated tags insight */}
              {(insights?.repeated_tags ?? []).length > 0 && (
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="mb-1.5 text-xs font-semibold" style={{ color: 'hsl(224, 71%, 4%)' }}>高频标签</p>
                  <div className="flex flex-wrap gap-1">
                    {insights.repeated_tags.slice(0, 6).map((t: any) => (
                      <Badge key={t.tag} variant="outline" className="text-[10px] gap-0.5">
                        {t.tag} <span className="text-muted-foreground">×{t.count}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Insight notes from backend */}
              {(insights?.insight_notes ?? []).length > 0 && (
                <div className="space-y-1.5">
                  {insights.insight_notes.map((note: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-0.5 shrink-0 text-primary">💡</span>
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}

              {analysisMetrics.total === 0 && !(insights?.insight_notes?.length) && !(insights?.repeated_tags?.length) && (
                <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
                  <Sparkles className="mb-1.5 h-5 w-5 opacity-30" />
                  <p className="text-xs">运行 AI 分析后将展示更丰富的摘要</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
