import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Database, Cpu, Layers, HardDrive, CheckCircle, XCircle, RefreshCw, Radio } from 'lucide-react';
import { api } from '@/lib/api';

export default function Config() {
  const [config, setConfig] = useState<any>(null);
  const [llm, setLlm] = useState<any>(null);
  const [db, setDb] = useState<any>(null);
  const [vector, setVector] = useState<any>(null);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [c, l, d, v, col] = await Promise.all([
        api.config(), api.llmHealth(), api.dbHealth(), api.vectorHealth(),
        api.collectorStatus(),
      ]);
      setConfig(c); setLlm(l); setDb(d); setVector(v);
      setCollectors(col?.collectors ?? []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const StatusBadge = ({ ok }: { ok: boolean }) =>
    ok ? <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" />Connected</Badge>
       : <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Disconnected</Badge>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">System Connections</h2>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LLM */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-primary" />
              <CardTitle>LLM Gateway</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge ok={llm?.configured ?? false} />
            </div>
            {llm && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>{llm.provider}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="font-mono text-xs">{llm.model}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Base URL</span><span className="font-mono text-xs truncate max-w-[200px]">{llm.base_url}</span></div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Database */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              <CardTitle>Database</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge ok={db?.status === 'ok'} />
            </div>
            {db && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>{db.provider}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">URL</span><span className="font-mono text-xs truncate max-w-[200px]">{config?.database?.url}</span></div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Vector Store */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" />
              <CardTitle>Vector Store</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge ok={vector?.status === 'ok'} />
            </div>
            {vector && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>{vector.provider}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Events Indexed</span><Badge variant="secondary">{vector.events_indexed ?? 0}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Skills Indexed</span><Badge variant="secondary">{vector.skills_indexed ?? 0}</Badge></div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Storage */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-primary" />
              <CardTitle>Storage</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {config?.storage && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{config.storage.type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Path</span><span className="font-mono text-xs">{config.storage.path}</span></div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Collectors */}
      <h3 className="mt-8 mb-3 flex items-center gap-2 text-lg font-semibold">
        <Radio className="w-5 h-5 text-primary" />
        Collectors
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {collectors.map((col: any) => (
          <Card key={col.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm capitalize">{col.name}</CardTitle>
                {col.status === 'active'
                  ? <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>
                  : <Badge variant="outline">Planned</Badge>
                }
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-muted-foreground">{col.description}</p>
              {col.endpoint && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Endpoint</span>
                  <span className="font-mono text-xs">{col.endpoint}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
