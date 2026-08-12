import { useState, useMemo, useRef, useCallback } from 'react';

/* ── Types ──────────────────────────────────────────── */

interface TimelineEvent {
  id: string;
  title: string;
  event_type: string;
  source: string;
  outcome: string;
  duration_minutes: number;
  started_at: string;
}

interface TimelineGroup {
  name: string;
  events: TimelineEvent[];
}

interface TimelineData {
  period: string;
  group_by: string;
  start_date: string;
  end_date: string;
  groups: TimelineGroup[];
}

interface Props {
  data: TimelineData | null;
  loading: boolean;
}

/* ── Constants ──────────────────────────────────────── */

const ROW_HEIGHT = 36;
const BAR_HEIGHT = 22;
const LABEL_WIDTH = 140;
const HEADER_HEIGHT = 32;

const EVENT_COLORS: Record<string, string> = {
  coding: '#6366f1',
  debug: '#ef4444',
  writing: '#22c55e',
  research: '#f59e0b',
  learning: '#06b6d4',
  browser: '#3b82f6',
  communication: '#8b5cf6',
  design: '#ec4899',
  ops: '#f97316',
  setup: '#64748b',
};

const SOURCE_COLORS: Record<string, string> = {
  git: '#22c55e',
  shell: '#a855f7',
  activitywatch: '#6366f1',
  manual: '#64748b',
  ide: '#eab308',
  browser: '#3b82f6',
};

function getBarColor(event: TimelineEvent, colorBy: 'event_type' | 'source'): string {
  if (colorBy === 'source') return SOURCE_COLORS[event.source] || '#94a3b8';
  return EVENT_COLORS[event.event_type] || '#94a3b8';
}

/* ── Helpers ────────────────────────────────────────── */

function parseDate(iso: string): Date {
  return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
}

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

/* ── Component ──────────────────────────────────────── */

export default function TimelineGantt({ data, loading }: Props) {
  const [colorBy, setColorBy] = useState<'event_type' | 'source'>('event_type');
  const [hoveredEvent, setHoveredEvent] = useState<{ event: TimelineEvent; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Compute time range and day markers
  const { timeStart, timeEnd, dayMarkers, totalMs } = useMemo(() => {
    if (!data || !data.start_date || !data.end_date) {
      return { timeStart: 0, timeEnd: 0, dayMarkers: [], totalMs: 0 };
    }

    const start = parseDate(data.start_date);
    const end = parseDate(data.end_date);

    // Round to day boundaries
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(end);
    dayEnd.setHours(23, 59, 59, 999);

    const totalMs = dayEnd.getTime() - dayStart.getTime();

    // Generate day markers
    const markers: { date: Date; label: string; offset: number }[] = [];
    const cursor = new Date(dayStart);
    while (cursor <= dayEnd) {
      const offset = (cursor.getTime() - dayStart.getTime()) / totalMs;
      markers.push({ date: new Date(cursor), label: formatDate(cursor), offset });
      cursor.setDate(cursor.getDate() + 1);
    }

    return { timeStart: dayStart.getTime(), timeEnd: dayEnd.getTime(), dayMarkers: markers, totalMs };
  }, [data]);

  // Visible groups (limit to top 15 for readability)
  const visibleGroups = useMemo(() => {
    if (!data) return [];
    return data.groups.slice(0, 15);
  }, [data]);

  const chartWidth = 800;
  const chartContentWidth = chartWidth - LABEL_WIDTH;
  const chartHeight = HEADER_HEIGHT + visibleGroups.length * ROW_HEIGHT + 8;

  const getBarX = useCallback((startedAt: string) => {
    const t = parseDate(startedAt).getTime();
    return LABEL_WIDTH + ((t - timeStart) / totalMs) * chartContentWidth;
  }, [timeStart, totalMs, chartContentWidth]);

  const getBarWidth = useCallback((durationMinutes: number) => {
    const durationMs = durationMinutes * 60 * 1000;
    const w = (durationMs / totalMs) * chartContentWidth;
    return Math.max(w, 3); // minimum 3px for visibility
  }, [totalMs, chartContentWidth]);

  const handleBarHover = useCallback((event: TimelineEvent | null, e?: React.MouseEvent) => {
    if (!event || !e || !svgRef.current) {
      setHoveredEvent(null);
      return;
    }
    const rect = svgRef.current.getBoundingClientRect();
    setHoveredEvent({
      event,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  if (loading) {
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading timeline...</div>;
  }

  if (!data || !data.groups.length) {
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No events in this period.</div>;
  }

  // Collect legend items
  const legendItems = colorBy === 'event_type'
    ? Object.entries(EVENT_COLORS).filter(([key]) => data.groups.some(g => g.events.some(e => e.event_type === key)))
    : Object.entries(SOURCE_COLORS).filter(([key]) => data.groups.some(g => g.events.some(e => e.source === key)));

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Color by:</span>
          {(['event_type', 'source'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setColorBy(mode)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                colorBy === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode === 'event_type' ? 'Type' : 'Source'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {legendItems.map(([name, color]) => (
            <span key={name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          width={chartWidth}
          height={chartHeight}
          className="select-none"
          onMouseLeave={() => setHoveredEvent(null)}
        >
          {/* Day grid lines and labels */}
          {dayMarkers.map((marker, i) => {
            const x = LABEL_WIDTH + marker.offset * chartContentWidth;
            return (
              <g key={i}>
                <line
                  x1={x} y1={HEADER_HEIGHT - 4}
                  x2={x} y2={chartHeight}
                  stroke="hsl(var(--border))"
                  strokeWidth={0.5}
                  strokeDasharray="4 2"
                />
                <text
                  x={x + 4} y={HEADER_HEIGHT - 8}
                  className="fill-muted-foreground"
                  fontSize={10}
                  fontFamily="system-ui"
                >
                  {marker.label}
                </text>
              </g>
            );
          })}

          {/* Row backgrounds and bars */}
          {visibleGroups.map((group, rowIdx) => {
            const rowY = HEADER_HEIGHT + rowIdx * ROW_HEIGHT;
            const totalMinutes = group.events.reduce((sum, e) => sum + e.duration_minutes, 0);

            return (
              <g key={group.name}>
                {/* Row background */}
                <rect
                  x={0} y={rowY}
                  width={chartWidth}
                  height={ROW_HEIGHT}
                  fill={rowIdx % 2 === 0 ? 'transparent' : 'hsl(var(--muted) / 0.3)'}
                />

                {/* Group label */}
                <text
                  x={8}
                  y={rowY + ROW_HEIGHT / 2 + 4}
                  className="fill-foreground"
                  fontSize={11}
                  fontFamily="system-ui"
                  fontWeight={500}
                >
                  {group.name.length > 18 ? group.name.slice(0, 16) + '..' : group.name}
                </text>
                <text
                  x={LABEL_WIDTH - 8}
                  y={rowY + ROW_HEIGHT / 2 + 4}
                  className="fill-muted-foreground"
                  fontSize={9}
                  fontFamily="system-ui"
                  textAnchor="end"
                >
                  {formatDuration(totalMinutes)}
                </text>

                {/* Event bars */}
                {group.events.map((event) => {
                  const barX = getBarX(event.started_at);
                  const barW = getBarWidth(event.duration_minutes);
                  const barY = rowY + (ROW_HEIGHT - BAR_HEIGHT) / 2;

                  return (
                    <rect
                      key={event.id}
                      x={barX}
                      y={barY}
                      width={barW}
                      height={BAR_HEIGHT}
                      rx={3}
                      fill={getBarColor(event, colorBy)}
                      opacity={0.85}
                      className="cursor-pointer transition-opacity hover:opacity-100"
                      onMouseEnter={(e) => handleBarHover(event, e)}
                      onMouseMove={(e) => handleBarHover(event, e)}
                      onMouseLeave={() => handleBarHover(null)}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Tooltip */}
          {hoveredEvent && (
            <g>
              <rect
                x={Math.min(hoveredEvent.x + 12, chartWidth - 220)}
                y={Math.max(hoveredEvent.y - 60, 4)}
                width={210}
                height={72}
                rx={6}
                fill="hsl(var(--popover))"
                stroke="hsl(var(--border))"
                strokeWidth={1}
                filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
              />
              <text
                x={Math.min(hoveredEvent.x + 20, chartWidth - 212)}
                y={Math.max(hoveredEvent.y - 42, 20)}
                fontSize={11}
                fontWeight={600}
                className="fill-foreground"
                fontFamily="system-ui"
              >
                {hoveredEvent.event.title.length > 30
                  ? hoveredEvent.event.title.slice(0, 28) + '..'
                  : hoveredEvent.event.title}
              </text>
              <text
                x={Math.min(hoveredEvent.x + 20, chartWidth - 212)}
                y={Math.max(hoveredEvent.y - 26, 36)}
                fontSize={10}
                className="fill-muted-foreground"
                fontFamily="system-ui"
              >
                {hoveredEvent.event.event_type} · {hoveredEvent.event.source} · {formatDuration(hoveredEvent.event.duration_minutes)}
              </text>
              <text
                x={Math.min(hoveredEvent.x + 20, chartWidth - 212)}
                y={Math.max(hoveredEvent.y - 10, 52)}
                fontSize={10}
                className="fill-muted-foreground"
                fontFamily="system-ui"
              >
                {formatTime(parseDate(hoveredEvent.event.started_at))} · {hoveredEvent.event.outcome || '—'}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
