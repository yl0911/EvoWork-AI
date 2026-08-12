import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trash2, Plus, BookOpen, Lightbulb, Recycle, Globe } from 'lucide-react';
import { api } from '@/lib/api';

type SkillCategory = 'thinking' | 'reusable' | 'open_source';
type SkillSource = 'user_generated' | 'ai_generated' | 'open_source' | 'mined';

interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  trigger: string;
  content?: string;
  steps: string[];
  source: SkillSource;
  methods?: string[];
  success_criteria?: string;
  failure_fallback?: string;
  agent_assistable?: boolean;
  usage_count: number;
  avg_effectiveness: number;
  created_at?: string;
}

interface SkillForm {
  name: string;
  category: SkillCategory;
  trigger: string;
  content: string;
  steps: string;
  source: SkillSource;
  methods: string;
  success_criteria: string;
  failure_fallback: string;
  agent_assistable: boolean;
}

const initialForm: SkillForm = {
  name: '',
  category: 'thinking',
  trigger: '',
  content: '',
  steps: '',
  source: 'user_generated',
  methods: '',
  success_criteria: '',
  failure_fallback: '',
  agent_assistable: false,
};

const categoryBadgeMap: Record<SkillCategory, { variant: 'secondary' | 'default' | 'outline'; icon: React.ElementType; label: string }> = {
  thinking: { variant: 'secondary', icon: Lightbulb, label: 'Thinking' },
  reusable: { variant: 'default', icon: Recycle, label: 'Reusable' },
  open_source: { variant: 'outline', icon: Globe, label: 'Open Source' },
};

const categoryTabs = [
  { value: 'all', label: 'All' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'reusable', label: 'Reusable' },
  { value: 'open_source', label: 'Open Source' },
];

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [form, setForm] = useState<SkillForm>(initialForm);

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const category = activeTab === 'all' ? undefined : activeTab;
      const data = await api.listSkills(category);
      setSkills(data);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const updateField = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const buildPayload = (): Partial<Skill> => {
    const payload: any = {
      name: form.name,
      category: form.category,
      trigger: form.trigger,
      content: form.content,
      steps: form.steps.split('\n').map((s) => s.trim()).filter(Boolean),
      source: form.source,
    };

    if (form.category === 'thinking') {
      payload.methods = form.methods.split('\n').map((s) => s.trim()).filter(Boolean);
    }

    if (form.category === 'reusable') {
      payload.success_criteria = form.success_criteria;
      payload.failure_fallback = form.failure_fallback;
      payload.agent_assistable = form.agent_assistable;
    }

    return payload;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.trigger.trim()) return;

    try {
      setSubmitting(true);
      await api.createSkill(buildPayload());
      setForm(initialForm);
      await fetchSkills();
    } catch (err) {
      console.error('Failed to create skill:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete skill:', err);
    }
  };

  const filteredSkills = activeTab === 'all'
    ? skills
    : skills.filter((s) => s.category === activeTab);

  return (
    <div className="min-h-screen p-6 bg-background">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center gap-3">
          <BookOpen className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Skills Management</h1>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left Panel: Create Skill Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Create New Skill
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    placeholder="Skill name"
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    required
                  />
                </div>

                {/* Category */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Category</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.category}
                    onChange={(e) => updateField('category', e.target.value as SkillCategory)}
                  >
                    <option value="thinking">Thinking</option>
                    <option value="reusable">Reusable</option>
                    <option value="open_source">Open Source</option>
                  </select>
                </div>

                {/* Trigger */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Trigger</label>
                  <Textarea
                    placeholder="Describe when this skill should be triggered"
                    value={form.trigger}
                    onChange={(e) => updateField('trigger', e.target.value)}
                    required
                  />
                </div>

                {/* Content */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Content</label>
                  <Textarea
                    placeholder="Skill content / description"
                    value={form.content}
                    onChange={(e) => updateField('content', e.target.value)}
                  />
                </div>

                {/* Steps */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Steps (one per line)</label>
                  <Textarea
                    placeholder="Step 1: Do something&#10;Step 2: Do something else"
                    value={form.steps}
                    onChange={(e) => updateField('steps', e.target.value)}
                  />
                </div>

                {/* Source */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Source</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.source}
                    onChange={(e) => updateField('source', e.target.value as SkillSource)}
                  >
                    <option value="user_generated">User Generated</option>
                    <option value="ai_generated">AI Generated</option>
                    <option value="open_source">Open Source</option>
                    <option value="mined">Mined</option>
                  </select>
                </div>

                {/* Conditional: Thinking - methods */}
                {form.category === 'thinking' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Methods (one per line)</label>
                    <Textarea
                      placeholder="Method 1&#10;Method 2"
                      value={form.methods}
                      onChange={(e) => updateField('methods', e.target.value)}
                    />
                  </div>
                )}

                {/* Conditional: Reusable - success_criteria, failure_fallback, agent_assistable */}
                {form.category === 'reusable' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Success Criteria</label>
                      <Textarea
                        placeholder="Define what success looks like"
                        value={form.success_criteria}
                        onChange={(e) => updateField('success_criteria', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Failure Fallback</label>
                      <Textarea
                        placeholder="What to do if this skill fails"
                        value={form.failure_fallback}
                        onChange={(e) => updateField('failure_fallback', e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="agent_assistable"
                        checked={form.agent_assistable}
                        onChange={(e) => updateField('agent_assistable', e.target.checked)}
                        className="h-4 w-4 rounded border border-input accent-primary"
                      />
                      <label htmlFor="agent_assistable" className="text-sm font-medium">
                        Agent Assistable
                      </label>
                    </div>
                  </>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Skill'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Right Panel: Skill Library */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Skill Library
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4 w-full">
                  {categoryTabs.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Loading skills...
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No skills found.
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {filteredSkills.map((skill) => {
                    const badge = categoryBadgeMap[skill.category];
                    const Icon = badge.icon;
                    return (
                      <Card key={skill.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1.5 flex items-center gap-2">
                                <span className="font-medium truncate">{skill.name}</span>
                                <Badge variant={badge.variant} className="gap-1 shrink-0">
                                  <Icon className="h-3 w-3" />
                                  {badge.label}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                                {skill.trigger}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{skill.steps?.length ?? 0} steps</span>
                                <span>Used {skill.usage_count ?? 0} times</span>
                                <span>
                                  Effectiveness:{' '}
                                  {skill.avg_effectiveness != null
                                    ? `${Math.round(skill.avg_effectiveness * 100)}%`
                                    : 'N/A'}
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(skill.id)}
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
