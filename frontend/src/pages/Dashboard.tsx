import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Activity, Clock, Brain, Repeat } from 'lucide-react';
import { api } from '@/lib/api';

type Period = 'week' | 'month' | 'year';

interface DashboardProps {
  period: Period;
}

const PRIMARY_COLOR = 'hsl(262, 83%, 58%)';
const BAR_COLORS = [
  'hsl(262, 83%, 58%)',
  'hsl(262, 83%, 68%)',
  'hsl(262, 83%, 78%)',
  'hsl(262, 60%, 65%)',
  'hsl(262, 50%, 72%)',
  'hsl(262, 40%, 78%)',
];

export default function Dashboard({ period }: DashboardProps) {
  const [insights, setInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setInsightsLoading(true);
      try {
        const data = await api.insightsSummary(period);
        if (!cancelled) setInsights(data);
      } catch (err) {
        console.error('Failed to fetch insights summary:', err);
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [period]);

  // API 返回 snake_case，前端做映射转换
  const totalEvents = insights?.total_events ?? 0;
  const totalMinutes = insights?.total_minutes ?? 0;
  const skillCount = insights?.skill_count ?? 0;
  const repeatedTagsCount = (insights?.repeated_tags ?? []).length;

  // dict → [{name, value}] 格式供 Recharts 使用
  const toChartData = (dict: Record<string, number> | undefined) =>
    dict ? Object.entries(dict).map(([name, value]) => ({ name, value })) : [];

  const eventTypeData = toChartData(insights?.event_type_minutes);
  const sourceData = toChartData(insights?.source_minutes);
  const dailyTimeData = toChartData(insights?.daily_minutes);
  const insightNotes = insights?.insight_notes ?? [];

  return (
    <div className="space-y-6 p-6">
      {/* Top metrics row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEvents}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Minutes</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMinutes}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Skill Count</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{skillCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Repeated Tags</CardTitle>
            <Repeat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{repeatedTagsCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row: event type + source distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Event type distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Type Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {eventTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, eventTypeData.length * 40)}>
                <BarChart data={eventTypeData} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {eventTypeData.map((_: any, index: number) => (
                      <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {insightsLoading ? 'Loading...' : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Source distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, sourceData.length * 40)}>
                <BarChart data={sourceData} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {sourceData.map((_: any, index: number) => (
                      <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {insightsLoading ? 'Loading...' : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily time distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Time Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyTimeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyTimeData} margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill={PRIMARY_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              {insightsLoading ? 'Loading...' : 'No data available'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insight notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Insight Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {insightNotes.length > 0 ? (
            <ul className="space-y-2">
              {insightNotes.map((note: string, index: number) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <Badge variant="secondary" className="mt-0.5 shrink-0">{index + 1}</Badge>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-muted-foreground">
              {insightsLoading ? 'Loading...' : 'No insight notes available'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
