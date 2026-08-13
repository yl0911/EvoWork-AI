import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Send, Sparkles, Brain, BarChart3, StopCircle,
  RotateCcw, Bot, User, Loader2, Copy, Check,
  BookOpen, TrendingUp, Lightbulb,
} from 'lucide-react';
import { api } from '@/lib/api';

type Period = 'week' | 'month' | 'year';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  copied?: boolean;
}

interface AIAssistantProps {
  period: Period;
}

const PRIMARY = 'hsl(262, 83%, 58%)';
const PRIMARY_LIGHT = 'hsl(262, 83%, 96%)';

const QUICK_ACTIONS = [
  {
    label: '周期复盘',
    icon: Sparkles,
    prompt: '请基于我近期的工作数据，生成一个详细的周期复盘，包括工作概览、习惯模式、认知卡点、建议 Skill 和下一步行动。',
  },
  {
    label: 'Skill 建议',
    icon: Brain,
    prompt: '请分析我近期的工作事件，识别重复出现的模式和操作，推荐可以沉淀为可复用 Skill 的内容，并生成一个 Skill 草稿。',
  },
  {
    label: '数据分析',
    icon: BarChart3,
    prompt: '请分析我近期的终端命令使用情况和工作节奏数据，找出工作流优化机会和时间管理建议。',
  },
  {
    label: '效率瓶颈',
    icon: TrendingUp,
    prompt: '请分析我近期的工作数据，找出效率瓶颈和时间浪费点，给出具体的改进建议。重点关注频繁切换、重复操作和长时间低产出事件。',
  },
  {
    label: '学习建议',
    icon: Lightbulb,
    prompt: '基于我近期遇到的问题和技术研究方向，推荐适合我深入学习的主题和资源，并规划一个简要的学习路径。',
  },
];

/* Follow-up suggestions based on response content */
function getFollowUps(content: string): string[] {
  const followUps: string[] = [];
  if (content.includes('Skill') || content.includes('skill') || content.includes('技能')) {
    followUps.push('帮我把这个 Skill 草稿保存下来');
  }
  if (content.includes('卡点') || content.includes('问题') || content.includes('barrier')) {
    followUps.push('针对这个卡点，给出具体的解决方案');
  }
  if (content.includes('命令') || content.includes('shell') || content.includes('终端')) {
    followUps.push('帮我把频繁使用的命令整理成脚本');
  }
  if (content.includes('时间') || content.includes('节奏') || content.includes('高峰')) {
    followUps.push('给我制定一个基于数据的最优工作日安排');
  }
  if (content.includes('下一步') || content.includes('行动')) {
    followUps.push('帮我把这些行动项细化为具体步骤');
  }
  return followUps.slice(0, 3);
}

export default function AIAssistant({ period }: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const streamChat = useCallback(async (chatMessages: Message[]) => {
    setLoading(true);
    const ctrl = new AbortController();
    setAbortCtrl(ctrl);

    // Add empty assistant message for streaming
    const assistantIdx = chatMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

    try {
      const apiMessages = chatMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, period }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`API ${response.status}: ${detail}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          if (data === '[DONE]') {
            setMessages(prev => prev.map((m, i) =>
              i === assistantIdx ? { ...m, streaming: false } : m
            ));
            setLoading(false);
            setAbortCtrl(null);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              accumulated += `\n\n[Error: ${parsed.error}]`;
            } else if (parsed.content) {
              accumulated += parsed.content;
            }
            setMessages(prev => prev.map((m, i) =>
              i === assistantIdx ? { ...m, content: accumulated } : m
            ));
            scrollToBottom();
          } catch {
            // skip malformed chunks
          }
        }
      }

      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx ? { ...m, streaming: false } : m
      ));
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx ? { ...m, content: m.content + '\n\n[已停止生成]', streaming: false } : m
        ));
      } else {
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx
            ? { ...m, content: `请求失败: ${err.message}`, streaming: false }
            : m
        ));
      }
    } finally {
      setLoading(false);
      setAbortCtrl(null);
    }
  }, [period, scrollToBottom]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    streamChat(newMessages);
  }, [input, loading, messages, streamChat]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (loading) return;
    const userMsg: Message = { role: 'user', content: prompt };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    streamChat(newMessages);
  }, [loading, messages, streamChat]);

  const handleStop = useCallback(() => {
    abortCtrl?.abort();
  }, [abortCtrl]);

  const handleReset = useCallback(() => {
    if (loading) abortCtrl?.abort();
    setMessages([]);
    setInput('');
  }, [loading, abortCtrl]);

  const handleCopy = useCallback(async (content: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setMessages(prev => prev.map((m, i) =>
        i === idx ? { ...m, copied: true } : m
      ));
      setTimeout(() => {
        setMessages(prev => prev.map((m, i) =>
          i === idx ? { ...m, copied: false } : m
        ));
      }, 2000);
    } catch {
      /* clipboard not available */
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* Get follow-ups for last assistant message */
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && !m.streaming);
  const followUps = lastAssistantMsg ? getFollowUps(lastAssistantMsg.content) : [];

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" style={{ color: PRIMARY }} />
          <h2 className="text-lg font-semibold">AI 助手</h2>
          <Badge variant="outline" className="text-xs">
            {period === 'week' ? '本周' : period === 'month' ? '本月' : '本年'}
          </Badge>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            新对话
          </Button>
        )}
      </div>

      {/* Chat area */}
      <Card className="flex flex-1 flex-col overflow-hidden">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4"
          style={{ minHeight: 0 }}
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="space-y-2">
                <Bot className="mx-auto h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  基于你的工作数据，与你对话式分析。可以追问、深入探讨。
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_ACTIONS.map(action => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickAction(action.prompt)}
                    className="gap-1.5"
                  >
                    <action.icon className="h-3.5 w-3.5" style={{ color: PRIMARY }} />
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: msg.role === 'user' ? PRIMARY : 'hsl(var(--muted))',
                      color: msg.role === 'user' ? 'white' : 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {msg.role === 'user' ? (
                      <User className="h-3.5 w-3.5" />
                    ) : (
                      <Bot className="h-3.5 w-3.5" />
                    )}
                  </div>

                  {/* Bubble */}
                  <div className="group relative max-w-[80%]">
                    <div
                      className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                      style={{
                        backgroundColor: msg.role === 'user' ? PRIMARY : 'hsl(var(--muted))',
                        color: msg.role === 'user' ? 'white' : undefined,
                        borderTopRightRadius: msg.role === 'user' ? '4px' : undefined,
                        borderTopLeftRadius: msg.role === 'assistant' ? '4px' : undefined,
                      }}
                    >
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-pre:my-1">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                          {msg.streaming && (
                            <span
                              className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm"
                              style={{ backgroundColor: PRIMARY }}
                            />
                          )}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                      )}
                    </div>

                    {/* Message actions (assistant only, not streaming) */}
                    {msg.role === 'assistant' && !msg.streaming && msg.content && (
                      <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.content, idx)}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary"
                          title="复制"
                        >
                          {msg.copied ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Follow-up suggestions */}
              {!loading && followUps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-9.5">
                  {followUps.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuickAction(q)}
                      className="rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick actions bar (shown when there are messages) */}
        {messages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t px-4 py-2">
            {QUICK_ACTIONS.map(action => (
              <Button
                key={action.label}
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => handleQuickAction(action.prompt)}
                className="h-7 gap-1 text-xs text-muted-foreground"
              >
                <action.icon className="h-3 w-3" />
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="border-t p-3">
          <div className="flex gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的问题... (Enter 发送, Shift+Enter 换行)"
              className="min-h-[44px] max-h-[120px] resize-none text-sm"
              rows={1}
              disabled={loading}
            />
            {loading ? (
              <Button
                onClick={handleStop}
                variant="destructive"
                size="icon"
                className="h-[44px] w-[44px] flex-shrink-0"
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!input.trim()}
                size="icon"
                className="h-[44px] w-[44px] flex-shrink-0"
                style={{ backgroundColor: PRIMARY }}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
