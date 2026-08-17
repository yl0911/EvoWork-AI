import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from 'recharts';
import { TrendingUp, AlertTriangle, Target, Terminal, Clock, CalendarRange } from 'lucide-react';
import { api } from '@/lib/api';
import TimelineGantt from '@/components/TimelineGantt';

/* ---------- types ---------- */
interface HabitEntry {
  name: string;
  percentage: number;
  minutes: number;
}

interface RepeatedProblem {
  project: string;
  event_type: string;
  occurrences: number;
  total_minutes: number;
}

interface EfficiencyData {
  resolve_rate: number;
  outcomes: Record<string, any>;
}

interface ShellData {
  total_commands: number;
  top_commands: { command: string; count: number }[];
  type_distribution: Record<string, number>;
  error_rate: number;
  error_commands: { command: string; count: number }[];
}

interface PatternData {
  total_events: number;
  hourly_distribution: Record<number, number>;
  project_switches: number;
  active_days: number;
  daily_event_count: Record<string, number>;
}

/* ---------- constants ---------- */
const BAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4',
];

/* ---------- helpers ---------- */
interface TrendPoint {
  date: string;
  label: string;
  minutes: number;
  events: number;
}

function fmtTrendDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

function normalizeHabit(data: any): HabitEntry[] {
  if (data?.profile && typeof data.profile === 'object' && !Array.isArray(data.profile)) {
    return Object.entries(data.profile)
      .map(([name, val]: [string, any]) => ({
        name,
        percentage: val.percentage ?? 0,
        minutes: val.minutes ?? 0,
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }
  if (Array.isArray(data)) return data.map((d: any) => ({ name: d.event_type || d.name, percentage: d.percentage, minutes: d.minutes }));
  return [];
}

function normalizeProblems(data: any): RepeatedProblem[] {
  if (data?.repeated && Array.isArray(data.repeated)) return data.repeated;
  if (Array.isArray(data)) return data;
  return [];
}

function normalizeEfficiency(data: any): EfficiencyData {
  const byOutcome = data?.by_outcome ?? {};
  const outcomes: Record<string, number> = {};
  for (const [key, val] of Object.entries(byOutcome)) {
    outcomes[key] = (val as any)?.count ?? 0;
  }
  return {
    resolve_rate: data?.resolve_rate ?? 0,
    outcomes: Object.keys(outcomes).length > 0 ? outcomes : (data?.outcomes ?? {}),
  };
}

/* ---------- component ---------- */
interface AnalyticsProps {
  period: 'week' | 'month' | 'year';
}

export default function Analytics({ period }: AnalyticsProps) {
  const [habit, setHabit] = useState<HabitEntry[]>([]);
  const [problems, setProblems] = useState<RepeatedProblem[]>([]);
  const [efficiency, setEfficiency] = useState<EfficiencyData>({ resolve_rate: 0, outcomes: {} });
  const [shell, setShell] = useState<ShellData | null>(null);
  const [patterns, setPatterns] = useState<PatternData | null>(null);
  const [timelineData, setTimelineData] = useState<any>(null);
  const [timelineGroupBy, setTimelineGroupBy] = useState<'project' | 'event_type' | 'source'>('project');
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setLoading(true);
      setError(null);
      try {
        const [fullRes, timelineRes] = await Promise.allSettled([
          api.fullAnalysis(period),
          api.timeline(period, timelineGroupBy),
        ]);

        if (cancelled) return;

        if (fullRes.status === 'fulfilled') {
          const full = fullRes.value;
          setHabit(normalizeHabit(full.habit_profile));
          setProblems(normalizeProblems(full.repeated_problems));
          setEfficiency(normalizeEfficiency(full.efficiency_metrics));
          setShell(full.shell_commands ?? null);
          setPatterns(full.work_patterns ?? null);

          // Build daily trend data from daily_minutes and daily_event_count
          const dailyMinutes: Record<string, number> = full.daily_minutes ?? {};
          const dailyEvents: Record<string, number> = full.work_patterns?.daily_event_count ?? {};
          const allDates = new Set([...Object.keys(dailyMinutes), ...Object.keys(dailyEvents)]);
          const sorted = Array.from(allDates).sort();
          setTrendData(
            sorted.map((date) => ({
              date,
              label: fmtTrendDate(date),
              minutes: dailyMinutes[date] ?? 0,
              events: dailyEvents[date] ?? 0,
            })),
          );
        }

        setTimelineData(timelineRes.status === 'fulfilled' ? timelineRes.value : null);

        const errors: string[] = [];
        if (fullRes.status === 'rejected') errors.push(`Analysis: ${fullRes.reason}`);
        if (timelineRes.status === 'rejected') errors.push(`Timeline: ${timelineRes.reason}`);
        if (errors.length) setError(errors.join(' | '));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, [period, timelineGroupBy]);

  // Build hourly chart data
  const hourlyData = patterns?.hourly_distribution
    ? Array.from({ length: 24 }, (_, h) => ({
        hour: `${h}:00`,
        count: patterns.hourly_distribution[h] ?? 0,
      }))
    : [];

  // Build shell type chart data
  const shellTypeData = shell?.type_distribution
    ? Object.entries(shell.type_distribution).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Analytics Dashboard</h1>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading analytics...</p>}

      {/* ===== Daily Efficiency Trend ===== */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle>每日效率趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {trendData.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No trend data for this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                  label={{ value: 'Minutes', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#8b5cf6' } }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                  label={{ value: 'Events', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#3b82f6' } }}
                />
                <Tooltip
                  labelStyle={{ fontWeight: 600 }}
                  formatter={(value, name) =>
                    name === 'minutes' ? [`${value} min`, 'Time'] : [`${value}`, 'Events']
                  }
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="minutes"
                  stroke="#8b5cf6"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#8b5cf6' }}
                  activeDot={{ r: 5 }}
                  name="minutes"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="events"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#3b82f6' }}
                  activeDot={{ r: 5 }}
                  name="events"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ===== Timeline ===== */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <CalendarRange className="h-5 w-5 text-primary" />
          <CardTitle>Timeline</CardTitle>
          <div className="ml-auto flex items-center gap-1.5">
            {(['project', 'event_type', 'source'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setTimelineGroupBy(g)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  timelineGroupBy === g
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {g === 'project' ? 'Project' : g === 'event_type' ? 'Type' : 'Source'}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <TimelineGantt data={timelineData} loading={loading} />
        </CardContent>
      </Card>

      {/* ===== Habit Profile ===== */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle>Habit Profile</CardTitle>
        </CardHeader>
        <CardContent>
          {habit.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No event data for this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(habit.length * 40, 160)}>
              <BarChart data={habit} layout="vertical" margin={{ top: 4, right: 24, left: 80, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: any) => [`${Number(value).toFixed(1)}%`, 'Share']} labelStyle={{ fontWeight: 600 }} />
                <Bar dataKey="percentage" radius={[0, 4, 4, 0]} barSize={24}>
                  {habit.map((_, idx) => (
                    <Cell key={idx} fill={BAR_COLORS[idx % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ===== Two-column: Shell + Work Patterns ===== */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ===== Shell Insights ===== */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Terminal className="h-5 w-5 text-primary" />
            <CardTitle>Shell Insights</CardTitle>
            {shell && shell.total_commands > 0 && (
              <Badge variant="secondary" className="ml-auto">{shell.total_commands} commands</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!shell || shell.total_commands === 0 ? (
              <p className="text-sm text-muted-foreground">No shell data for this period.</p>
            ) : (
              <>
                {/* Error rate */}
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className="text-3xl font-bold tabular-nums" style={{ color: shell.error_rate > 10 ? '#ef4444' : '#22c55e' }}>
                      {shell.error_rate}%
                    </span>
                    <span className="text-xs text-muted-foreground">Error Rate</span>
                  </div>
                  {shellTypeData.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {shellTypeData.map((d, i) => (
                        <Badge key={d.name} variant="outline" className="text-[11px]">
                          {d.name}: {d.value}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Top commands */}
                {shell.top_commands.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Top Commands</p>
                    <div className="space-y-1">
                      {shell.top_commands.slice(0, 6).map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <code className="truncate text-xs font-mono">{c.command}</code>
                          <Badge variant="secondary" className="text-[10px] shrink-0 ml-2">{c.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error commands */}
                {shell.error_commands.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-red-500">Frequently Failed</p>
                    <div className="space-y-1">
                      {shell.error_commands.map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <code className="truncate text-xs font-mono text-red-600">{c.command}</code>
                          <Badge variant="destructive" className="text-[10px] shrink-0 ml-2">{c.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ===== Work Patterns ===== */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Clock className="h-5 w-5 text-primary" />
            <CardTitle>Work Patterns</CardTitle>
            {patterns && patterns.active_days > 0 && (
              <Badge variant="secondary" className="ml-auto">{patterns.active_days} active days</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!patterns || patterns.total_events === 0 ? (
              <p className="text-sm text-muted-foreground">No pattern data for this period.</p>
            ) : (
              <>
                {/* Key metrics */}
                <div className="flex gap-4">
                  <div className="flex flex-col items-center rounded-lg border px-4 py-2">
                    <span className="text-2xl font-bold tabular-nums">{patterns.active_days}</span>
                    <span className="text-xs text-muted-foreground">Active Days</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border px-4 py-2">
                    <span className="text-2xl font-bold tabular-nums">{patterns.project_switches}</span>
                    <span className="text-xs text-muted-foreground">Switches</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border px-4 py-2">
                    <span className="text-2xl font-bold tabular-nums">{patterns.total_events}</span>
                    <span className="text-xs text-muted-foreground">Events</span>
                  </div>
                </div>

                {/* Hourly distribution chart */}
                {hourlyData.some((d) => d.count > 0) && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Hourly Activity</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={3} />
                        <YAxis tick={{ fontSize: 9 }} width={24} />
                        <Tooltip labelStyle={{ fontWeight: 600 }} />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[2, 2, 0, 0]} barSize={8} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== Repeated Problems ===== */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <CardTitle>Repeated Problems</CardTitle>
        </CardHeader>
        <CardContent>
          {problems.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No repeated problems detected this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 text-left font-medium text-muted-foreground">Project</th>
                    <th className="py-2 pr-4 text-left font-medium text-muted-foreground">Event Type</th>
                    <th className="py-2 pr-4 text-right font-medium text-muted-foreground">Occurrences</th>
                    <th className="py-2 text-right font-medium text-muted-foreground">Total Minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((p, idx) => (
                    <tr key={idx} className="border-b last:border-b-0">
                      <td className="py-2.5 pr-4">{p.project || '-'}</td>
                      <td className="py-2.5 pr-4"><Badge variant="outline">{p.event_type}</Badge></td>
                      <td className="py-2.5 pr-4 text-right font-medium">{p.occurrences}</td>
                      <td className="py-2.5 text-right font-medium">{p.total_minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Efficiency Metrics ===== */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Target className="h-5 w-5 text-success" />
          <CardTitle>Efficiency Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-start gap-8">
            <div className="flex flex-col items-center">
              <span className="text-5xl font-bold tabular-nums text-primary">
                {Math.round(efficiency.resolve_rate)}
                <span className="text-2xl text-muted-foreground">%</span>
              </span>
              <span className="mt-1 text-sm text-muted-foreground">Resolve Rate</span>
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Outcome Breakdown</p>
              {Object.keys(efficiency.outcomes).length === 0 && !loading ? (
                <p className="text-sm text-muted-foreground">No outcome data available.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {Object.entries(efficiency.outcomes).map(([key, value]) => (
                    <div key={key} className="flex items-baseline gap-1.5 rounded-md border px-3 py-2">
                      <span className="text-lg font-semibold tabular-nums">{value as number}</span>
                      <Badge variant="secondary" className="text-[11px] capitalize">{key.replace(/_/g, ' ')}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
