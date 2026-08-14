import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Search as SearchIcon,
  FileText,
  BookOpen,
  Zap,
  X,
  Filter,
  TrendingUp,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '@/lib/api';

/* ---------- types ---------- */
interface SearchResult {
  id: string;
  result_type: 'event' | 'skill';
  title: string;
  content: string;
  score: number;
  fts_score: number | null;
  chroma_distance: number | null;
  source?: string;
  event_type?: string;
  event_layer?: string;
  project?: string;
  tags?: string[];
  outcome?: string;
  category?: string;
  started_at?: string | null;
  duration_minutes?: number;
  highlight?: string;
  trigger?: string;
  enabled?: boolean;
  usage_count?: number;
}

interface ExperienceResult {
  id: string;
  problem: string;
  result?: string;
  event_type?: string;
  project?: string;
  outcome?: string;
  tags?: string[];
  distance?: number;
}

interface HotTerms {
  projects: { term: string; count: number }[];
  tags: { term: string; count: number }[];
}

/* ---------- constants ---------- */
const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'events', label: 'Events' },
  { value: 'skills', label: 'Skills' },
];

const SOURCES = ['manual', 'git', 'shell', 'activitywatch', 'ide'];
const EVENT_TYPES = [
  'debug', 'coding', 'search', 'error', 'reading',
  'writing', 'planning', 'resolved', 'unresolved',
];

const SOURCE_COLORS: Record<string, string> = {
  git: '#22c55e',
  shell: '#8b5cf6',
  manual: '#3b82f6',
  ide: '#eab308',
  activitywatch: '#f97316',
};

/* ---------- word cloud ---------- */

// 稳定 hash：同一 term 每次得到相同值，保证乱序但不随 re-render 跳动
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 频率→颜色：冷(低频)→暖(高频) 色阶
function heatColor(ratio: number): string {
  // ratio 0→1  对应  冷蓝→青→绿→黄→橙→红
  const stops: [number, number, number][] = [
    [100, 180, 220],  // 0.0  淡蓝
    [60, 190, 200],   // 0.25 青
    [80, 180, 120],   // 0.5  绿
    [240, 180, 50],   // 0.75 金黄
    [220, 80, 60],    // 1.0  暖红
  ];
  const t = Math.max(0, Math.min(1, ratio));
  const seg = t * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const f = seg - i;
  const r = Math.round(stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f);
  const g = Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f);
  const b = Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f);
  return `rgb(${r},${g},${b})`;
}

function WordCloud({
  terms,
  onSearch,
  maxItems = 24,
}: {
  terms: { term: string; count: number }[];
  onSearch: (term: string) => void;
  maxItems?: number;
}) {
  const items = useMemo(() => {
    const sliced = terms.slice(0, maxItems);
    if (sliced.length === 0) return [];
    const maxCount = Math.max(...sliced.map(t => t.count));
    const minCount = Math.min(...sliced.map(t => t.count));
    const range = maxCount - minCount || 1;

    const shuffled = [...sliced].sort((a, b) => hashStr(a.term + 'x') % 97 - hashStr(b.term + 'x') % 97);

    return shuffled.map((t) => {
      const ratio = (t.count - minCount) / range;
      const h = hashStr(t.term);
      const fontSize = 13 + ratio * 26; // 13px ~ 39px

      // 随机旋转：大多数词微倾（-12°~+12°），少量词竖排（90°）
      const rotSeed = h % 100;
      let rotate: number;
      if (rotSeed < 8) rotate = 90;        // ~8% 竖排
      else if (rotSeed < 14) rotate = -90;  // ~6% 反向竖排
      else rotate = ((h % 25) - 12);        // -12° ~ +12°

      // 垂直位移打破行对齐（-8px ~ +8px）
      const jitterY = ((h >> 4) % 17) - 8;

      return {
        ...t,
        fontSize,
        ratio,
        color: heatColor(ratio),
        rotate,
        jitterY,
        delay: (h % 15) * 45,
      };
    });
  }, [terms, maxItems]);

  if (items.length === 0) return null;

  return (
    <div
      className="relative py-2"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2px 4px',  // 紧凑间距，让词挤在一起
        lineHeight: 1.1,
      }}
    >
      {items.map((item) => (
        <button
          key={item.term}
          onClick={() => onSearch(item.term)}
          className="group relative inline-block cursor-pointer whitespace-nowrap rounded px-1.5 py-0.5 transition-all duration-200 hover:scale-110 hover:!opacity-100"
          style={{
            fontSize: `${item.fontSize}px`,
            color: item.color,
            opacity: 0.45 + item.ratio * 0.55,
            fontWeight: item.fontSize > 30 ? 800 : item.fontSize > 22 ? 700 : item.fontSize > 16 ? 600 : 500,
            letterSpacing: item.fontSize > 24 ? '-0.03em' : '0',
            transform: `rotate(${item.rotate}deg) translateY(${item.jitterY}px)`,
            margin: `${item.jitterY > 0 ? 0 : Math.abs(item.jitterY)}px 2px`,
            animation: `cloudFadeIn 0.5s ease-out ${item.delay}ms both`,
            transformOrigin: 'center center',
          }}
          title={`${item.term} (${item.count})`}
        >
          {item.term}
          <span
            className="absolute -right-1 -top-1.5 hidden rounded-full bg-background px-1 py-px text-[9px] font-medium text-muted-foreground shadow-sm group-hover:inline-block"
          >
            {item.count}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------- helpers ---------- */
function renderHighlight(text: string) {
  if (!text) return null;
  const parts = text.split(/(<mark>.*?<\/mark>)/g);
  return parts.map((part, i) => {
    const match = part.match(/^<mark>(.*)<\/mark>$/);
    if (match) {
      return <mark key={i} className="rounded bg-yellow-200 px-0.5 text-yellow-900">{match[1]}</mark>;
    }
    return <span key={i}>{part}</span>;
  });
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/* ---------- component ---------- */
export default function Search() {
  /* -- search state -- */
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [source, setSource] = useState<string | null>(null);
  const [eventType, setEventType] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFts, setHasFts] = useState(false);
  const [hasChroma, setHasChroma] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searched, setSearched] = useState(false);

  /* -- experience state -- */
  const [problemDesc, setProblemDesc] = useState('');
  const [expResults, setExpResults] = useState<ExperienceResult[]>([]);
  const [expLoading, setExpLoading] = useState(false);

  /* -- hot terms -- */
  const [hotTerms, setHotTerms] = useState<HotTerms | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* -- load hot terms on mount -- */
  useEffect(() => {
    api.hotTerms().then(setHotTerms).catch(() => {});
  }, []);

  /* -- debounced search -- */
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const data = await api.search(q.trim(), {
        topK: 30,
        scope: scope === 'all' ? undefined : scope,
        source: source ?? undefined,
        eventType: eventType ?? undefined,
        project: project ?? undefined,
      });
      setResults(data?.results ?? []);
      setTotal(data?.total ?? 0);
      setHasFts(data?.has_fts ?? false);
      setHasChroma(data?.has_chroma ?? false);
    } catch (err: any) {
      setError(err.message ?? 'Search failed');
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [scope, source, eventType, project]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 350);
  }

  /* re-search when filters change */
  useEffect(() => {
    if (query.trim()) doSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, source, eventType, project]);

  /* -- experience search -- */
  async function handleExperienceSearch() {
    if (!problemDesc.trim()) return;
    setExpLoading(true);
    try {
      const data = await api.searchExperience(problemDesc.trim(), 10);
      setExpResults(data?.results ?? []);
    } catch {
      setExpResults([]);
    } finally {
      setExpLoading(false);
    }
  }

  /* -- quick search from hot terms -- */
  function quickSearch(term: string) {
    setQuery(term);
    doSearch(term);
    inputRef.current?.focus();
  }

  /* -- filter helpers -- */
  function clearFilters() {
    setSource(null);
    setEventType(null);
    setProject(null);
  }

  const activeFilterCount = [source, eventType, project].filter(Boolean).length;

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* ===== Search Header ===== */}
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>

        {/* Search bar */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search events, skills, problems, projects..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch(query)}
            className="w-full rounded-lg border bg-background py-3 pl-11 pr-10 text-base shadow-sm outline-none ring-primary/20 transition-shadow focus:ring-2"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); setTotal(0); setSearched(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Scope tabs */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-md border bg-muted/50 p-0.5">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                onClick={() => setScope(s.value)}
                className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                  scope === s.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
            {showFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {loading && (
            <span className="text-sm text-muted-foreground">Searching...</span>
          )}

          {!loading && searched && (
            <span className="ml-auto text-sm text-muted-foreground">
              {total} result{total !== 1 ? 's' : ''}
              {hasFts && hasChroma && <span className="ml-1 text-[10px] text-muted-foreground/60">(FTS5 + Chroma)</span>}
              {hasFts && !hasChroma && <span className="ml-1 text-[10px] text-muted-foreground/60">(FTS5)</span>}
              {!hasFts && hasChroma && <span className="ml-1 text-[10px] text-muted-foreground/60">(Chroma)</span>}
            </span>
          )}
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filters</span>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground">
                  Clear all
                </button>
              )}
            </div>

            {/* Source filter */}
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Source</span>
              <div className="flex flex-wrap gap-1.5">
                {SOURCES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSource(source === s ? null : s)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      source === s
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SOURCE_COLORS[s] ?? '#6b7280' }} />
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Event type filter */}
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Event Type</span>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setEventType(eventType === t ? null : t)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      eventType === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== Error ===== */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ===== Results ===== */}
      {searched && !loading && results.length === 0 && !error && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <SearchIcon className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No results found for "{query}"</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Try different keywords or remove filters</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {results.map((r) => (
          <Card key={r.id} className="overflow-hidden transition-shadow hover:shadow-md">
            <CardContent className="flex gap-4 p-4">
              {/* Left color bar */}
              <div
                className="w-1 shrink-0 rounded-full"
                style={{
                  backgroundColor: r.result_type === 'skill'
                    ? '#22c55e'
                    : SOURCE_COLORS[r.source ?? ''] ?? '#6b7280',
                }}
              />

              <div className="min-w-0 flex-1 space-y-2">
                {/* Header row */}
                <div className="flex items-center gap-2">
                  {r.result_type === 'event'
                    ? <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <BookOpen className="h-4 w-4 shrink-0 text-emerald-500" />
                  }
                  <span className="truncate text-sm font-semibold">{r.title || r.id}</span>
                  <Badge variant={r.result_type === 'skill' ? 'secondary' : 'outline'} className="shrink-0 text-[10px]">
                    {r.result_type}
                  </Badge>
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="tabular-nums">{(r.score * 100).toFixed(0)}%</span>
                  </span>
                </div>

                {/* Highlight snippet */}
                {r.highlight && (
                  <p className="text-sm leading-relaxed text-foreground/80">
                    {renderHighlight(r.highlight)}
                  </p>
                )}

                {/* Metadata row */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {r.source && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[r.source] ?? '#6b7280' }} />
                      {r.source}
                    </Badge>
                  )}
                  {r.event_type && <Badge variant="outline" className="text-[10px]">{r.event_type}</Badge>}
                  {r.project && <span className="rounded bg-muted px-1.5 py-0.5">{r.project}</span>}
                  {r.category && <span className="rounded bg-muted px-1.5 py-0.5">{r.category}</span>}
                  {r.outcome && (
                    <Badge variant={r.outcome === 'resolved' ? 'secondary' : 'outline'} className="text-[10px]">
                      {r.outcome}
                    </Badge>
                  )}
                  {r.duration_minutes ? <span>{r.duration_minutes}min</span> : null}
                  {r.started_at && <span>{timeAgo(r.started_at)}</span>}
                  {r.result_type === 'skill' && r.usage_count != null && (
                    <span>used {r.usage_count}x</span>
                  )}
                  {r.tags?.slice(0, 3).map((tag) => (
                    <button
                      key={tag}
                      onClick={() => quickSearch(tag)}
                      className="rounded bg-muted px-1.5 py-0.5 hover:bg-muted/80"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ===== Empty state with hot terms ===== */}
      {!searched && !loading && hotTerms && (
        <div className="space-y-4">
          {/* Inject animation keyframe */}
          <style>{`
            @keyframes cloudFadeIn {
              from { opacity: 0; transform: translateY(8px) scale(0.9); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>

          {/* Project word cloud */}
          {hotTerms.projects.length > 0 && (
            <Card className="overflow-hidden border-0 shadow-sm" style={{ background: 'linear-gradient(135deg, hsl(250,80%,98%) 0%, hsl(220,80%,97%) 100%)' }}>
              <CardContent className="py-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                    <TrendingUp className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: '#4338ca' }}>Projects</span>
                  <span className="text-[10px] text-muted-foreground">{hotTerms.projects.length} 个项目</span>
                </div>
                <WordCloud terms={hotTerms.projects} onSearch={quickSearch} maxItems={15} />
              </CardContent>
            </Card>
          )}

          {/* Tag word cloud */}
          {hotTerms.tags.length > 0 && (
            <Card className="overflow-hidden border-0 shadow-sm" style={{ background: 'linear-gradient(135deg, hsl(190,80%,97%) 0%, hsl(160,80%,97%) 100%)' }}>
              <CardContent className="py-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: 'linear-gradient(135deg, #0ea5e9, #14b8a6)' }}>
                    <Zap className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: '#0369a1' }}>Tags</span>
                  <span className="text-[10px] text-muted-foreground">{hotTerms.tags.length} 个标签</span>
                </div>
                <WordCloud terms={hotTerms.tags} onSearch={quickSearch} maxItems={20} />
              </CardContent>
            </Card>
          )}

          {/* Experience search hint */}
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span>点击下方「Experience Search」可按问题描述语义搜索历史经验</span>
          </div>
        </div>
      )}

      {/* ===== Experience Search Section ===== */}
      <section className="space-y-4 border-t pt-8">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-warning" />
          <h2 className="text-xl font-semibold">Experience Search</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Describe a problem to find similar past experiences from problem/result events.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Describe your problem..."
            value={problemDesc}
            onChange={(e) => setProblemDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExperienceSearch()}
            className="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm shadow-sm outline-none ring-primary/20 transition-shadow focus:ring-2"
          />
          <Button variant="secondary" onClick={handleExperienceSearch} disabled={expLoading || !problemDesc.trim()}>
            <Zap className="mr-2 h-4 w-4" />
            {expLoading ? 'Searching...' : 'Find'}
          </Button>
        </div>

        <div className="space-y-2">
          {expResults.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <Badge variant="warning">experience</Badge>
                  {r.event_type && <Badge variant="outline">{r.event_type}</Badge>}
                  {r.outcome && (
                    <Badge variant={r.outcome === 'resolved' ? 'secondary' : 'outline'}>{r.outcome}</Badge>
                  )}
                  {r.distance != null && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      distance: {r.distance.toFixed(4)}
                    </span>
                  )}
                </div>
                <p className="text-sm">{r.problem}</p>
                {r.project && (
                  <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {r.project}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
