import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, AlertTriangle, Target } from 'lucide-react';
import { api } from '@/lib/api';

/* ---------- types ---------- */
interface HabitEntry {
  event_type: string;
  count: number;
  percentage: number;
}

interface RepeatedProblem {
  project: string;
  event_type: string;
  occurrences: number;
  total_minutes: number;
}

interface EfficiencyData {
  resolve_rate: number;
  outcomes: Record<string, number>;
}

/* ---------- constants ---------- */
const PERIODS = ['week', 'month', 'year'] as const;
type Period = (typeof PERIODS)[number];

const BAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4',
];

/* ---------- helpers ---------- */
function normalizeHabit(data: any): HabitEntry[] {
  if (Array.isArray(data)) return data;
  if (data?.profile && Array.isArray(data.profile)) return data.profile;
  if (data?.results && Array.isArray(data.results)) return data.results;
  return [];
}

function normalizeProblems(data: any): RepeatedProblem[] {
  if (Array.isArray(data)) return data;
  if (data?.problems && Array.isArray(data.problems)) return data.problems;
  if (data?.results && Array.isArray(data.results)) return data.results;
  return [];
}

function normalizeEfficiency(data: any): EfficiencyData {
  return {
    resolve_rate: data?.resolve_rate ?? data?.resolveRate ?? 0,
    outcomes: data?.outcomes ?? data?.outcome_breakdown ?? {},
  };
}

/* ---------- component ---------- */
export default function Analytics() {
  const [period, setPeriod] = useState<Period>('week');

  const [habit, setHabit] = useState<HabitEntry[]>([]);
  const [problems, setProblems] = useState<RepeatedProblem[]>([]);
  const [efficiency, setEfficiency] = useState<EfficiencyData>({ resolve_rate: 0, outcomes: {} });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* -- fetch all sections whenever period changes -- */
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setLoading(true);
      setError(null);
      try {
        const [habitRes, problemsRes, effRes] = await Promise.allSettled([
          api.habitProfile(period),
          api.repeatedProblems(period, 2),
          api.efficiencyMetrics(period),
        ]);

        if (cancelled) return;

        setHabit(
          habitRes.status === 'fulfilled' ? normalizeHabit(habitRes.value) : []
        );
        setProblems(
          problemsRes.status === 'fulfilled' ? normalizeProblems(problemsRes.value) : []
        );
        setEfficiency(
          effRes.status === 'fulfilled' ? normalizeEfficiency(effRes.value) : { resolve_rate: 0, outcomes: {} }
        );

        const errors: string[] = [];
        if (habitRes.status === 'rejected') errors.push(`Habit: ${habitRes.reason}`);
        if (problemsRes.status === 'rejected') errors.push(`Problems: ${problemsRes.reason}`);
        if (effRes.status === 'rejected') errors.push(`Efficiency: ${effRes.reason}`);
        if (errors.length) setError(errors.join(' | '));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, [period]);

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Analytics Dashboard</h1>

        {/* Period selector */}
        <div className="inline-flex items-center rounded-md border bg-muted/50 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                period === p
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {loading && (
        <p className="text-sm text-muted-foreground">Loading analytics...</p>
      )}

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
              <BarChart
                data={habit}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 80, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis
                  type="category"
                  dataKey="event_type"
                  width={80}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value: any) => [`${Number(value).toFixed(1)}%`, 'Share']}
                  labelStyle={{ fontWeight: 600 }}
                />
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
                      <td className="py-2.5 pr-4">
                        <Badge variant="outline">{p.event_type}</Badge>
                      </td>
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
            {/* Resolve rate big number */}
            <div className="flex flex-col items-center">
              <span className="text-5xl font-bold tabular-nums text-primary">
                {(efficiency.resolve_rate * 100).toFixed(0)}
                <span className="text-2xl text-muted-foreground">%</span>
              </span>
              <span className="mt-1 text-sm text-muted-foreground">Resolve Rate</span>
            </div>

            {/* Outcome breakdown */}
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Outcome Breakdown</p>
              {Object.keys(efficiency.outcomes).length === 0 && !loading ? (
                <p className="text-sm text-muted-foreground">No outcome data available.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {Object.entries(efficiency.outcomes).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-baseline gap-1.5 rounded-md border px-3 py-2"
                    >
                      <span className="text-lg font-semibold tabular-nums">{value}</span>
                      <Badge variant="secondary" className="text-[11px] capitalize">
                        {key.replace(/_/g, ' ')}
                      </Badge>
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
