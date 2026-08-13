import { useState, useEffect, useRef, useCallback } from 'react';
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
        <Card className="border-dashed">
          <CardContent className="space-y-5 py-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">Popular Searches</span>
            </div>

            {hotTerms.projects.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Projects</span>
                <div className="flex flex-wrap gap-2">
                  {hotTerms.projects.slice(0, 10).map((p) => (
                    <button
                      key={p.term}
                      onClick={() => quickSearch(p.term)}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      {p.term}
                      <span className="text-[10px] text-muted-foreground">{p.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hotTerms.tags.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Tags</span>
                <div className="flex flex-wrap gap-2">
                  {hotTerms.tags.slice(0, 12).map((t) => (
                    <button
                      key={t.term}
                      onClick={() => quickSearch(t.term)}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      {t.term}
                      <span className="text-[10px] text-muted-foreground">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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
