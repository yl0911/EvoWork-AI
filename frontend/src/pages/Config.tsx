import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Database, Cpu, Layers, HardDrive, CheckCircle, XCircle, RefreshCw,
  Radio, GitBranch, Terminal, Monitor, Globe, Code2, UserCircle,
  ChevronDown, ChevronUp, Copy, Check, Upload, Clock,
} from 'lucide-react';
import { api } from '@/lib/api';

const PRIMARY = 'hsl(262, 83%, 58%)';

/* ── Helpers ─────────────────────────────────────────── */

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

const COLLECTOR_ICONS: Record<string, typeof GitBranch> = {
  git: GitBranch,
  shell: Terminal,
  shell_batch: Terminal,
  activitywatch: Monitor,
  import: Upload,
  browser: Globe,
  ide: Code2,
  manual: UserCircle,
};

const COLLECTOR_COLORS: Record<string, string> = {
  git: '#22c55e',
  shell: '#a855f7',
  shell_batch: '#a855f7',
  activitywatch: '#6366f1',
  import: '#f59e0b',
  browser: '#3b82f6',
  ide: '#eab308',
  manual: '#64748b',
};

/* ── Setup Guides ────────────────────────────────────── */

interface SetupStep {
  title: string;
  command?: string;
  description: string;
}

const SETUP_GUIDES: Record<string, { title: string; steps: SetupStep[] }> = {
  git: {
    title: 'Git Hook 安装',
    steps: [
      {
        title: '1. 安装 post-commit hook',
        command: 'python scripts/install_git_hook.py --repo /path/to/your/repo',
        description: '将 hook 脚本复制到目标仓库的 .git/hooks/post-commit',
      },
      {
        title: '2. 验证 hook 已安装',
        command: 'cat .git/hooks/post-commit',
        description: '确认文件中包含 evowork 相关的 curl 命令',
      },
      {
        title: '3. 测试提交',
        command: 'git commit --allow-empty -m "test: verify evowork hook"',
        description: '提交后检查 EvoWork Events 页面是否出现新事件',
      },
    ],
  },
  shell: {
    title: 'Shell Hook 安装',
    steps: [
      {
        title: '1. 自动安装（推荐）',
        command: 'python scripts/install_shell_hook.py',
        description: '自动向 ~/.bashrc 或 ~/.zshrc 追加 source 行',
      },
      {
        title: '2. 手动安装',
        command: 'echo "source $(pwd)/scripts/shell_hook.sh" >> ~/.bashrc && source ~/.bashrc',
        description: '手动将 hook 脚本添加到 shell 配置文件',
      },
      {
        title: '3. 回溯历史命令',
        command: 'python scripts/parse_shell_history.py --hours 48',
        description: '从 ~/.bash_history / ~/.zsh_history 批量导入历史命令',
      },
    ],
  },
  activitywatch: {
    title: 'ActivityWatch 导入',
    steps: [
      {
        title: '1. 确保 ActivityWatch 正在运行',
        command: 'curl http://localhost:5600/api/0/buckets',
        description: '检查 ActivityWatch REST API 是否可访问',
      },
      {
        title: '2. 导入最近 24 小时数据',
        command: 'python scripts/activitywatch_import.py --hours 24',
        description: '从 ActivityWatch 获取窗口活动并推送到 EvoWork',
      },
      {
        title: '3. 定时导入（可选）',
        command: 'crontab: 0 */6 * * * python scripts/activitywatch_import.py --hours 6',
        description: '设置 cron 每 6 小时自动增量导入',
      },
    ],
  },
};

/* ── Copy Button ─────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-2 flex-shrink-0 rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/* ── Status Badge ────────────────────────────────────── */

function StatusBadge({ ok }: { ok: boolean }) {
  return ok
    ? <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"><CheckCircle className="mr-1 h-3 w-3" />Connected</Badge>
    : <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Disconnected</Badge>;
}

/* ── Main Component ──────────────────────────────────── */

export default function Config() {
  const [config, setConfig] = useState<any>(null);
  const [llm, setLlm] = useState<any>(null);
  const [db, setDb] = useState<any>(null);
  const [vector, setVector] = useState<any>(null);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);

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

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">系统连接</h2>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* Infrastructure Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* LLM */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4" style={{ color: PRIMARY }} />
              <CardTitle className="text-sm">LLM</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">状态</span>
              <StatusBadge ok={llm?.configured ?? false} />
            </div>
            {llm && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">模型</span><span className="font-mono">{llm.model}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>{llm.provider}</span></div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Database */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" style={{ color: PRIMARY }} />
              <CardTitle className="text-sm">数据库</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">状态</span>
              <StatusBadge ok={db?.status === 'ok'} />
            </div>
            {db && (
              <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>{db.provider}</span></div>
            )}
          </CardContent>
        </Card>

        {/* Vector */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4" style={{ color: PRIMARY }} />
              <CardTitle className="text-sm">向量库</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">状态</span>
              <StatusBadge ok={vector?.status === 'ok'} />
            </div>
            {vector && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">事件索引</span><Badge variant="secondary">{vector.events_indexed ?? 0}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Skill 索引</span><Badge variant="secondary">{vector.skills_indexed ?? 0}</Badge></div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Storage */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" style={{ color: PRIMARY }} />
              <CardTitle className="text-sm">存储</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            {config?.storage && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">类型</span><span>{config.storage.type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">路径</span><span className="max-w-[160px] truncate font-mono">{config.storage.path}</span></div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Collectors Section */}
      <div className="mt-8">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Radio className="h-5 w-5" style={{ color: PRIMARY }} />
          数据采集器
        </h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {collectors.map((col: any) => {
            const Icon = COLLECTOR_ICONS[col.name] || Radio;
            const color = COLLECTOR_COLORS[col.name] || '#64748b';
            const linkedSkill = col.linked_skill;
            const isActive = col.status === 'active';
            const skillEnabled = linkedSkill?.enabled ?? true;
            const guide = SETUP_GUIDES[col.name];
            const isGuideOpen = expandedGuide === col.name;

            const handleToggle = async () => {
              if (!linkedSkill?.skill_id) return;
              try {
                await api.toggleSkill(linkedSkill.skill_id);
                const updated = await api.collectorStatus();
                setCollectors(updated?.collectors ?? []);
              } catch (e) {
                console.error('Failed to toggle:', e);
              }
            };

            return (
              <Card
                key={col.name}
                className={`overflow-hidden transition-opacity ${!isActive || !skillEnabled ? 'opacity-60' : ''}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${color}18` }}
                      >
                        <Icon className="h-4.5 w-4.5" style={{ color }} />
                      </div>
                      <div>
                        <CardTitle className="text-sm capitalize">{col.name}</CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">{col.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      {isActive
                        ? <Badge
                            className="text-[10px]"
                            style={skillEnabled
                              ? { backgroundColor: `${color}18`, color, border: `1px solid ${color}40` }
                              : undefined
                            }
                            variant={skillEnabled ? 'outline' : 'secondary'}
                          >
                            {skillEnabled ? 'Active' : 'Disabled'}
                          </Badge>
                        : <Badge variant="outline" className="text-[10px]">Planned</Badge>
                      }
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Database className="h-3 w-3" />
                      <span className="font-medium text-foreground">{col.event_count ?? 0}</span> events
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {col.last_collected_at
                        ? <span>{timeAgo(col.last_collected_at)}</span>
                        : <span>—</span>
                      }
                    </div>
                    {col.endpoint && (
                      <div className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                        {col.endpoint}
                      </div>
                    )}
                  </div>

                  {/* Toggle + Guide row */}
                  <div className="flex items-center justify-between border-t pt-3">
                    {linkedSkill ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{linkedSkill.name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={skillEnabled}
                          onClick={handleToggle}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                            skillEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0 transition duration-200 ${
                              skillEnabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    ) : (
                      <span />
                    )}

                    {guide && (
                      <button
                        onClick={() => setExpandedGuide(isGuideOpen ? null : col.name)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        安装指引
                        {isGuideOpen
                          ? <ChevronUp className="h-3 w-3" />
                          : <ChevronDown className="h-3 w-3" />
                        }
                      </button>
                    )}
                  </div>

                  {/* Setup Guide (expandable) */}
                  {isGuideOpen && guide && (
                    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                      <h4 className="text-xs font-semibold">{guide.title}</h4>
                      {guide.steps.map((step, i) => (
                        <div key={i} className="space-y-1">
                          <p className="text-xs font-medium">{step.title}</p>
                          {step.command && (
                            <div className="flex items-center rounded bg-background px-2 py-1.5 font-mono text-[11px]">
                              <span className="flex-1 break-all">{step.command}</span>
                              <CopyButton text={step.command} />
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground">{step.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
