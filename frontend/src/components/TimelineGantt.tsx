import { useState, useMemo, useRef, useCallback, useEffect } from 'react';

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

type ZoomLevel = 'day' | '3day' | 'week' | 'month';

/* ── Constants ──────────────────────────────────────── */

const ROW_HEIGHT = 36;
const BAR_HEIGHT = 22;
const LABEL_WIDTH = 140;
const HEADER_HEIGHT = 32;
const MIN_CHART_WIDTH = 600;

const ZOOM_MS: Record<ZoomLevel, number> = {
  day: 24 * 60 * 60 * 1000,
  '3day': 3 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  day: '1D',
  '3day': '3D',
  week: '1W',
  month: '1M',
};

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
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [hoveredEvent, setHoveredEvent] = useState<{ event: TimelineEvent; x: number; y: number } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [containerWidth, setContainerWidth] = useState(800);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Responsive width via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(Math.max(w, MIN_CHART_WIDTH));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Initialize enabled groups when data changes
  useEffect(() => {
    if (data?.groups) {
      setEnabledGroups(new Set(data.groups.map((g) => g.name)));
    }
  }, [data]);

  // Compute full time range from data
  const { dataStart, dataEnd } = useMemo(() => {
    if (!data || !data.start_date || !data.end_date) {
      return { dataStart: 0, dataEnd: 0 };
    }
    const start = parseDate(data.start_date);
    const end = parseDate(data.end_date);
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(end);
    dayEnd.setHours(23, 59, 59, 999);
    return { dataStart: dayStart.getTime(), dataEnd: dayEnd.getTime() };
  }, [data]);

  // Compute visible time window based on zoom
  const { timeStart, timeEnd, totalMs, timeMarkers } = useMemo(() => {
    if (!dataStart || !dataEnd) {
      return { timeStart: 0, timeEnd: 0, totalMs: 0, timeMarkers: [] };
    }

    const zoomMs = ZOOM_MS[zoom];
    const dataRange = dataEnd - dataStart;
    let tStart: number, tEnd: number;

    if (zoomMs >= dataRange) {
      // Zoom covers all data — show everything
      tStart = dataStart;
      tEnd = dataEnd;
    } else {
      // Show the last zoomMs of data
      tEnd = dataEnd;
      tStart = dataEnd - zoomMs;
    }

    const total = tEnd - tStart;

    // Choose marker interval based on zoom level
    let intervalMs: number;
    if (zoom === 'day') intervalMs = 60 * 60 * 1000;        // 1 hour
    else if (zoom === '3day') intervalMs = 6 * 60 * 60 * 1000; // 6 hours
    else if (zoom === 'week') intervalMs = 24 * 60 * 60 * 1000; // 1 day
    else intervalMs = 3 * 24 * 60 * 60 * 1000;               // 3 days

    const markers: { label: string; offset: number }[] = [];
    const firstMark = Math.ceil(tStart / intervalMs) * intervalMs;

    for (let t = firstMark; t <= tEnd; t += intervalMs) {
      const d = new Date(t);
      let label: string;
      if (zoom === 'day') {
        label = `${String(d.getHours()).padStart(2, '0')}:00`;
      } else if (zoom === '3day') {
        label = `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}h`;
      } else if (zoom === 'week') {
        label = formatDate(d);
      } else {
        label = formatDate(d);
      }
      markers.push({ label, offset: (t - tStart) / total });
    }

    return { timeStart: tStart, timeEnd: tEnd, totalMs: total, timeMarkers: markers };
  }, [dataStart, dataEnd, zoom]);

  // Filtered & limited groups
  const visibleGroups = useMemo(() => {
    if (!data) return [];
    return data.groups
      .filter((g) => enabledGroups.has(g.name))
      .slice(0, 20);
  }, [data, enabledGroups]);

  const chartWidth = containerWidth;
  const chartContentWidth = chartWidth - LABEL_WIDTH;
  const chartHeight = HEADER_HEIGHT + visibleGroups.length * ROW_HEIGHT + 8;

  // Summary statistics
  const summary = useMemo(() => {
    if (!visibleGroups.length) return null;
    let totalEvents = 0;
    let totalMinutes = 0;
    let busiestGroup = '';
    let busiestMinutes = 0;

    for (const group of visibleGroups) {
      totalEvents += group.events.length;
      const groupMin = group.events.reduce((s, e) => s + e.duration_minutes, 0);
      totalMinutes += groupMin;
      if (groupMin > busiestMinutes) {
        busiestMinutes = groupMin;
        busiestGroup = group.name;
      }
    }

    return { totalEvents, totalMinutes, busiestGroup };
  }, [visibleGroups]);

  const getBarX = useCallback(
    (startedAt: string) => {
      const t = parseDate(startedAt).getTime();
      return LABEL_WIDTH + ((t - timeStart) / totalMs) * chartContentWidth;
    },
    [timeStart, totalMs, chartContentWidth],
  );

  const getBarWidth = useCallback(
    (durationMinutes: number) => {
      const durationMs = durationMinutes * 60 * 1000;
      const w = (durationMs / totalMs) * chartContentWidth;
      return Math.max(w, 3);
    },
    [totalMs, chartContentWidth],
  );

  const handleBarHover = useCallback(
    (event: TimelineEvent | null, e?: React.MouseEvent) => {
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
    },
    [],
  );

  const handleBarClick = useCallback((event: TimelineEvent) => {
    setSelectedEvent((prev) => (prev?.id === event.id ? null : event));
  }, []);

  const toggleGroup = useCallback((name: string) => {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAllGroups = useCallback(() => {
    if (!data) return;
    const allNames = data.groups.map((g) => g.name);
    setEnabledGroups((prev) => (prev.size === allNames.length ? new Set() : new Set(allNames)));
  }, [data]);

  // ── Render guards ──

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Loading timeline...
      </div>
    );
  }

  if (!data || !data.groups.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No events in this period.
      </div>
    );
  }

  // Legend items
  const legendItems =
    colorBy === 'event_type'
      ? Object.entries(EVENT_COLORS).filter(([key]) =>
          data.groups.some((g) => g.events.some((e) => e.event_type === key)),
        )
      : Object.entries(SOURCE_COLORS).filter(([key]) =>
          data.groups.some((g) => g.events.some((e) => e.source === key)),
        );

  const allGroupNames = data.groups.map((g) => g.name);
  const allSelected = enabledGroups.size === allGroupNames.length;

  return (
    <div className="space-y-3">
      {/* ── Controls Row ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Color toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Color:</span>
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

        {/* Zoom */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Zoom:</span>
          {(['day', '3day', 'week', 'month'] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`rounded px-2 py-0.5 text-xs font-medium tabular-nums transition-colors ${
                zoom === z
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {ZOOM_LABELS[z]}
            </button>
          ))}
        </div>

        {/* Filter toggle */}
        {data.groups.length > 1 && (
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              showFilters
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Filter ({enabledGroups.size}/{allGroupNames.length})
          </button>
        )}

        {/* Legend */}
        <div className="ml-auto flex flex-wrap gap-2">
          {legendItems.map(([name, color]) => (
            <span key={name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* ── Summary Stats ── */}
      {summary && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
            <span className="text-lg font-bold tabular-nums">{summary.totalEvents}</span>
            <span className="text-xs text-muted-foreground">events</span>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
            <span className="text-lg font-bold tabular-nums">{formatDuration(summary.totalMinutes)}</span>
            <span className="text-xs text-muted-foreground">total</span>
          </div>
          {summary.busiestGroup && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
              <span className="text-sm font-semibold truncate max-w-[140px]">{summary.busiestGroup}</span>
              <span className="text-xs text-muted-foreground">busiest</span>
            </div>
          )}
        </div>
      )}

      {/* ── Group Filters ── */}
      {showFilters && data.groups.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/20 p-2">
          <button
            onClick={toggleAllGroups}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              allSelected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          <span className="h-3 w-px bg-border" />
          {allGroupNames.map((name) => {
            const active = enabledGroups.has(name);
            return (
              <button
                key={name}
                onClick={() => toggleGroup(name)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? 'bg-primary/90 text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground line-through hover:text-foreground'
                }`}
              >
                {name.length > 20 ? name.slice(0, 18) + '..' : name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Chart ── */}
      <div ref={containerRef} className="overflow-x-auto">
        <svg
          ref={svgRef}
          width={chartWidth}
          height={chartHeight}
          className="select-none"
          onMouseLeave={() => setHoveredEvent(null)}
        >
          {/* Time grid lines and labels */}
          {timeMarkers.map((marker, i) => {
            const x = LABEL_WIDTH + marker.offset * chartContentWidth;
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={HEADER_HEIGHT - 4}
                  x2={x}
                  y2={chartHeight}
                  stroke="hsl(var(--border))"
                  strokeWidth={0.5}
                  strokeDasharray="4 2"
                />
                <text
                  x={x + 4}
                  y={HEADER_HEIGHT - 8}
                  className="fill-muted-foreground"
                  fontSize={10}
                  fontFamily="system-ui"
                >
                  {marker.label}
                </text>
              </g>
            );
          })}

          {/* Row backgrounds, labels, and event bars */}
          {visibleGroups.map((group, rowIdx) => {
            const rowY = HEADER_HEIGHT + rowIdx * ROW_HEIGHT;
            const totalMinutes = group.events.reduce((s, e) => s + e.duration_minutes, 0);

            return (
              <g key={group.name}>
                <rect
                  x={0}
                  y={rowY}
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
                  const isSelected = selectedEvent?.id === event.id;

                  return (
                    <rect
                      key={event.id}
                      x={barX}
                      y={barY}
                      width={barW}
                      height={BAR_HEIGHT}
                      rx={3}
                      fill={getBarColor(event, colorBy)}
                      opacity={isSelected ? 1 : 0.85}
                      stroke={isSelected ? 'hsl(var(--foreground))' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                      className="cursor-pointer transition-opacity hover:opacity-100"
                      onMouseEnter={(e) => handleBarHover(event, e)}
                      onMouseMove={(e) => handleBarHover(event, e)}
                      onMouseLeave={() => handleBarHover(null)}
                      onClick={() => handleBarClick(event)}
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
                {hoveredEvent.event.event_type} · {hoveredEvent.event.source} ·{' '}
                {formatDuration(hoveredEvent.event.duration_minutes)}
              </text>
              <text
                x={Math.min(hoveredEvent.x + 20, chartWidth - 212)}
                y={Math.max(hoveredEvent.y - 10, 52)}
                fontSize={10}
                className="fill-muted-foreground"
                fontFamily="system-ui"
              >
                {formatTime(parseDate(hoveredEvent.event.started_at))} ·{' '}
                {hoveredEvent.event.outcome || '—'}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* ── Selected Event Detail ── */}
      {selectedEvent && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-semibold leading-snug">{selectedEvent.title}</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {selectedEvent.event_type}
                </span>
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {selectedEvent.source}
                </span>
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                  {formatDuration(selectedEvent.duration_minutes)}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>{formatTime(parseDate(selectedEvent.started_at))} · {formatDate(parseDate(selectedEvent.started_at))}</span>
                {selectedEvent.outcome && <span>Outcome: {selectedEvent.outcome}</span>}
              </div>
            </div>
            <button
              onClick={() => setSelectedEvent(null)}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
