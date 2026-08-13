import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, AreaChart, Area,
} from 'recharts';
import {
  Activity, Clock, Brain, Terminal, CalendarDays,
  ArrowUpRight, ArrowDownRight, Target,
  Sparkles, Lightbulb, ChevronDown, ChevronUp, Loader2,
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

function fmtDelta(cur: number, prev: number): { text: string; positive: boolean } {
  if (prev === 0) return cur > 0 ? { text: '+new', positive: true } : { text: '—', positive: true };
  const pct = Math.round(((cur - prev) / prev) * 100);
  return {
    text: pct >= 0 ? `+${pct}%` : `${pct}%`,
    positive: pct >= 0,
  };
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

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      // Reset AI results on period change so they'll be re-generated
      setReviewResult(null);
      setReviewOpen(false);
      setDraftResult(null);
      setDraftOpen(false);
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

  /* ── derive metrics ── */
  const totalEvents   = insights?.total_events   ?? 0;
  const totalMinutes  = insights?.total_minutes  ?? 0;
  const skillCount    = insights?.skill_count    ?? 0;
  const activeDays    = patterns?.active_days    ?? 0;
  const projSwitches  = patterns?.project_switches ?? 0;

  /* ── delta vs broader period ── */
  const prevEvents  = prevInsights?.total_events  ?? 0;
  const prevMinutes = prevInsights?.total_minutes ?? 0;
  const evDelta     = fmtDelta(totalEvents, prevEvents);
  const minDelta    = fmtDelta(totalMinutes, prevMinutes);

  /* ── chart data ── */
  const sourceData     = toChartData(insights?.source_minutes);
  const eventTypeData  = toChartData(insights?.event_type_minutes);
  const projectData    = toChartData(insights?.project_minutes).slice(0, 8);
  const dailyTimeData  = toChartData(insights?.daily_minutes).map(d => ({ ...d, label: fmtDate(d.name) }));
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
                {evDelta.text} {prevLabel[period]}
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
                {minDelta.text} {prevLabel[period]}
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

      {/* ─── AI Quick Actions ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Period Review */}
        <Card className="border-dashed">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-medium">AI {periodLabel[period]}复盘</CardTitle>
            </div>
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
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
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
            </div>
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
                <div className={`max-h-[400px] overflow-y-auto rounded-md bg-secondary/30 p-3 text-sm ${draftResult.error ? 'text-muted-foreground italic' : ''}`}>
                  {draftResult.error ? (
                    draftResult.content
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{draftResult.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          )}
        </Card>
      </div>

      {/* ─── Row 2: Daily trend (full width) ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Time Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyTimeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailyTimeData.map(d => ({ ...d, value: Math.max(d.value, 1) }))} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradPurple" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PRIMARY} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={PRIMARY} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis scale="log" domain={[1, 'auto']} tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={(val) => [`${val} min`, 'Time']} />
                <Area type="natural" dataKey="value" stroke={PRIMARY} fill="url(#gradPurple)" strokeWidth={2.5} name="minutes" dot={{ r: 3, fill: PRIMARY }} activeDot={{ r: 5 }} />
              </AreaChart>
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
        {/* Source pie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 sm:flex-row">
            {sourceData.length > 0 ? (
              <>
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie
                      data={sourceData}
                      cx="50%" cy="50%"
                      outerRadius={85}
                      dataKey="value"
                    >
                      {sourceData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-2">
                  {sourceData.map((d, i) => (
                    <Badge key={d.name} variant="outline" className="gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      {d.name} <span className="text-muted-foreground">{d.value}m</span>
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-48 w-full items-center justify-center text-sm text-muted-foreground">
                {loading ? <Skeleton className="h-full w-full" /> : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Project ranking */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Ranking</CardTitle>
          </CardHeader>
          <CardContent>
            {projectData.length > 0 ? (
              <div className="space-y-2.5">
                {projectData.map((p, i) => {
                  const maxVal = projectData[0].value || 1;
                  return (
                    <div key={p.name} className="flex items-center gap-3">
                      <span className="w-5 text-right text-xs font-medium text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="mb-0.5 flex items-center justify-between text-sm">
                          <span className="truncate">{p.name}</span>
                          <span className="ml-2 shrink-0 text-muted-foreground">{p.value}m</span>
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

      {/* ─── Row 4: Event type + Hourly distribution ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Event type bar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Type Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {eventTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, eventTypeData.length * 36)}>
                <BarChart data={eventTypeData} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {eventTypeData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {loading ? <Skeleton className="h-full w-full" /> : 'No data available'}
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

      {/* ─── Row 5: Shell stats + Insight notes ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Shell stats */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Shell Activity</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {shellTotal > 0 ? (
              <div className="space-y-4">
                {/* KPI row */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className="text-lg font-bold">{shellTotal}</p>
                    <p className="text-[11px] text-muted-foreground">Commands</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className={`text-lg font-bold ${shellError > 10 ? 'text-red-500' : 'text-green-600'}`}>
                      {shellError}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">Error Rate</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className="text-lg font-bold">{resolveRate}%</p>
                    <p className="text-[11px] text-muted-foreground">Resolve Rate</p>
                  </div>
                </div>
                {/* Top commands */}
                {shellTop.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Top Commands</p>
                    <div className="space-y-1">
                      {shellTop.map((cmd: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <code className="max-w-[200px] truncate rounded bg-secondary px-1.5 py-0.5 text-xs">
                            {cmd.command}
                          </code>
                          <span className="text-xs text-muted-foreground">{cmd.count}x</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                {loading ? <Skeleton className="h-full w-full" /> : 'No shell data'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Insight notes */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Insight Notes</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {(insights?.insight_notes ?? []).length > 0 ? (
              <ul className="space-y-2">
                {insights.insight_notes.map((note: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="secondary" className="mt-0.5 shrink-0">{i + 1}</Badge>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                {loading ? <Skeleton className="h-full w-full" /> : 'No insight notes'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
