import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search as SearchIcon, FileText, BookOpen, Zap } from 'lucide-react';
import { api } from '@/lib/api';

/* ---------- types ---------- */
interface SearchResult {
  id: string;
  result_type: 'event' | 'skill' | string;
  content: string;
  distance: number;
  tags?: string[];
  project?: string;
  event_type?: string;
  category?: string;
  [key: string]: unknown;
}

interface ExperienceResult {
  id: string;
  problem: string;
  result?: string;
  event_type?: string;
  project?: string;
  tags?: string[];
  distance: number;
  [key: string]: unknown;
}

/* ---------- helpers ---------- */
function snippet(text: string, maxLen = 200) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function badgeVariantFor(type: string) {
  switch (type) {
    case 'event':
      return 'secondary' as const;
    case 'skill':
      return 'success' as const;
    default:
      return 'outline' as const;
  }
}

function iconFor(type: string) {
  switch (type) {
    case 'event':
      return <FileText className="h-4 w-4 shrink-0" />;
    case 'skill':
      return <BookOpen className="h-4 w-4 shrink-0" />;
    default:
      return <FileText className="h-4 w-4 shrink-0" />;
  }
}

/* ---------- component ---------- */
export default function Search() {
  /* -- semantic search state -- */
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* -- experience search state -- */
  const [problemDesc, setProblemDesc] = useState('');
  const [expResults, setExpResults] = useState<ExperienceResult[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expError, setExpError] = useState<string | null>(null);

  /* -- handlers -- */
  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const scopeParam = scope === 'all' ? undefined : scope;
      const data = await api.search(query.trim(), 20, scopeParam);
      setResults(Array.isArray(data) ? data : data?.results ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleExperienceSearch() {
    if (!problemDesc.trim()) return;
    setExpLoading(true);
    setExpError(null);
    try {
      const data = await api.searchExperience(problemDesc.trim(), 10);
      setExpResults(Array.isArray(data) ? data : data?.results ?? []);
    } catch (err: any) {
      setExpError(err.message ?? 'Experience search failed');
      setExpResults([]);
    } finally {
      setExpLoading(false);
    }
  }

  function handleScopeChange(value: string) {
    setScope(value);
  }

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* ===== Semantic Search ===== */}
      <section className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Semantic Search</h1>

        {/* Search bar */}
        <div className="flex gap-2">
          <Input
            placeholder="Search events, skills, and more..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={loading || !query.trim()}>
            <SearchIcon className="mr-2 h-4 w-4" />
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </div>

        {/* Scope tabs */}
        <Tabs value={scope} onValueChange={handleScopeChange}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Results */}
        {!loading && results.length === 0 && query && !error && (
          <p className="text-sm text-muted-foreground">No results found.</p>
        )}

        <div className="space-y-3">
          {results.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex gap-4 p-4">
                {/* Icon */}
                <div className="mt-0.5">{iconFor(r.result_type)}</div>

                <div className="min-w-0 flex-1 space-y-2">
                  {/* Top row: badge + distance */}
                  <div className="flex items-center gap-2">
                    <Badge variant={badgeVariantFor(r.result_type)}>
                      {r.result_type}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      distance: {r.distance?.toFixed(4)}
                    </span>
                  </div>

                  {/* Content snippet */}
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {snippet(r.content)}
                  </p>

                  {/* Metadata */}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {r.project && (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        project: {r.project}
                      </span>
                    )}
                    {r.event_type && (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        event_type: {r.event_type}
                      </span>
                    )}
                    {r.category && (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        category: {r.category}
                      </span>
                    )}
                    {r.tags?.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ===== Experience Search ===== */}
      <section className="space-y-4 border-t pt-8">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-warning" />
          <h2 className="text-xl font-semibold">Experience Search</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Describe a problem you are facing and find relevant past experiences from problem/result layer events.
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="Describe your problem..."
            value={problemDesc}
            onChange={(e) => setProblemDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExperienceSearch()}
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={handleExperienceSearch}
            disabled={expLoading || !problemDesc.trim()}
          >
            <Zap className="mr-2 h-4 w-4" />
            {expLoading ? 'Searching...' : 'Find Experiences'}
          </Button>
        </div>

        {expError && (
          <p className="text-sm text-destructive">{expError}</p>
        )}

        {!expLoading && expResults.length === 0 && problemDesc && !expError && (
          <p className="text-sm text-muted-foreground">No matching experiences found.</p>
        )}

        <div className="space-y-3">
          {expResults.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-2 p-4">
                {/* Top row */}
                <div className="flex items-center gap-2">
                  <Badge variant="warning">experience</Badge>
                  {r.event_type && (
                    <Badge variant="outline">{r.event_type}</Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    distance: {r.distance?.toFixed(4)}
                  </span>
                </div>

                {/* Problem */}
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Problem: </span>
                  <span className="text-sm">{snippet(r.problem)}</span>
                </div>

                {/* Result (if present) */}
                {r.result && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">Result: </span>
                    <span className="text-sm">{snippet(r.result)}</span>
                  </div>
                )}

                {/* Metadata */}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {r.project && (
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      project: {r.project}
                    </span>
                  )}
                  {r.tags?.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
