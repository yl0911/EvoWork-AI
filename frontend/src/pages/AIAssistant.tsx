import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Sparkles, Brain, RefreshCw, Save, X, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { api } from '@/lib/api';

type Period = 'week' | 'month' | 'year';

interface AIAssistantProps {
  period: Period;
}

const PRIMARY_COLOR = 'hsl(262, 83%, 58%)';

export default function AIAssistant({ period }: AIAssistantProps) {
  // Review state
  const [review, setReview] = useState<any>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewExpanded, setReviewExpanded] = useState(true);

  // Skill draft state
  const [draftContent, setDraftContent] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftExpanded, setDraftExpanded] = useState(true);

  // Save-as-skill form
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [skillName, setSkillName] = useState('');
  const [skillCategory, setSkillCategory] = useState<'thinking' | 'reusable' | 'open_source'>('thinking');
  const [skillTrigger, setSkillTrigger] = useState('');
  const [skillSteps, setSkillSteps] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleGenerateReview = async () => {
    setReviewLoading(true);
    try {
      const data = await api.periodReview(period, true);
      setReview(data);
      setReviewExpanded(true);
    } catch (err) {
      console.error('Failed to generate review:', err);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleGenerateDraft = async () => {
    setDraftLoading(true);
    setSaved(false);
    try {
      const data = await api.skillDraft(period, undefined, true);
      setDraftContent(data.content || '');
      setDraftExpanded(true);
      setShowSaveForm(false);
    } catch (err) {
      console.error('Failed to generate skill draft:', err);
    } finally {
      setDraftLoading(false);
    }
  };

  const handleOpenSaveForm = () => {
    // Try to extract a name from the first line of draft content
    const firstLine = draftContent.split('\n').find((l: string) => l.trim().length > 0) || '';
    const nameMatch = firstLine.replace(/^#+\s*/, '').replace(/^[*\-]\s*/, '').trim();
    setSkillName(nameMatch.length > 80 ? nameMatch.slice(0, 80) : nameMatch);
    setSkillTrigger('Based on recent work patterns');
    setSkillSteps(draftContent);
    setShowSaveForm(true);
  };

  const handleSaveSkill = async () => {
    if (!skillName.trim() || !skillTrigger.trim()) return;
    try {
      setSaving(true);
      await api.createSkill({
        name: skillName,
        category: skillCategory,
        trigger: skillTrigger,
        content: draftContent,
        steps: skillSteps.split('\n').map((s: string) => s.trim()).filter(Boolean),
        source: 'ai_generated',
      });
      setSaved(true);
      setShowSaveForm(false);
    } catch (err) {
      console.error('Failed to save skill:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardDraft = () => {
    setDraftContent('');
    setShowSaveForm(false);
    setSaved(false);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Period Review Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" style={{ color: PRIMARY_COLOR }} />
              <div>
                <CardTitle className="text-base">Period Review</CardTitle>
                <CardDescription>
                  AI analyzes your {period} activity and generates a review
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {review && (
                <button
                  onClick={() => setReviewExpanded(!reviewExpanded)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {reviewExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              )}
              <Button
                onClick={handleGenerateReview}
                disabled={reviewLoading}
                size="sm"
                style={{ backgroundColor: PRIMARY_COLOR }}
              >
                {reviewLoading ? (
                  <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                )}
                {review ? 'Regenerate' : 'Generate'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {reviewExpanded && review && (
          <CardContent>
            <div className="rounded-lg border bg-secondary/30 p-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
                {review.content}
              </pre>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Skill Draft Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5" style={{ color: PRIMARY_COLOR }} />
              <div>
                <CardTitle className="text-base">Skill Draft</CardTitle>
                <CardDescription>
                  Generate skill suggestions from your {period} patterns, then edit and save
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {draftContent && (
                <button
                  onClick={() => setDraftExpanded(!draftExpanded)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {draftExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              )}
              <Button
                onClick={handleGenerateDraft}
                disabled={draftLoading}
                size="sm"
                variant="outline"
                style={{ borderColor: PRIMARY_COLOR, color: PRIMARY_COLOR }}
              >
                {draftLoading ? (
                  <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Brain className="mr-2 h-3.5 w-3.5" />
                )}
                {draftContent ? 'Regenerate' : 'Generate'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {draftExpanded && draftContent && (
          <CardContent className="space-y-4">
            {/* Editable draft content */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">
                Draft content (editable)
              </label>
              <Textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                className="min-h-[420px] font-mono text-sm"
              />
            </div>

            {/* Action buttons */}
            {!showSaveForm && !saved && (
              <div className="flex gap-2">
                <Button onClick={handleOpenSaveForm} size="sm">
                  <Save className="mr-2 h-3.5 w-3.5" />
                  Save as Skill
                </Button>
                <Button onClick={handleDiscardDraft} variant="ghost" size="sm">
                  <X className="mr-2 h-3.5 w-3.5" />
                  Discard
                </Button>
              </div>
            )}

            {/* Success message */}
            {saved && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                <Check className="h-4 w-4" />
                Skill saved successfully. You can find it in the Skills page.
              </div>
            )}

            {/* Save form */}
            {showSaveForm && (
              <div className="rounded-lg border p-4 space-y-4">
                <h4 className="text-sm font-semibold">Configure Skill</h4>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                    placeholder="Skill name"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Category</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={skillCategory}
                    onChange={(e) => setSkillCategory(e.target.value as any)}
                  >
                    <option value="thinking">Thinking</option>
                    <option value="reusable">Reusable</option>
                    <option value="open_source">Open Source</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Trigger</label>
                  <Textarea
                    value={skillTrigger}
                    onChange={(e) => setSkillTrigger(e.target.value)}
                    placeholder="When should this skill be triggered?"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Steps (one per line)</label>
                  <Textarea
                    value={skillSteps}
                    onChange={(e) => setSkillSteps(e.target.value)}
                    className="min-h-[200px] font-mono text-sm"
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveSkill} disabled={saving} size="sm">
                    {saving ? 'Saving...' : (
                      <>
                        <Save className="mr-2 h-3.5 w-3.5" />
                        Confirm & Save
                      </>
                    )}
                  </Button>
                  <Button onClick={() => setShowSaveForm(false)} variant="ghost" size="sm">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
