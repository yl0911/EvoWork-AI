import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Send, Sparkles, Brain, BarChart3, StopCircle,
  RotateCcw, Bot, User, Loader2, Copy, Check,
  TrendingUp, Lightbulb, MessageSquare, Plus, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';

type Period = 'week' | 'month' | 'year';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  copied?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  period: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface AIAssistantProps {
  period: Period;
}

const PRIMARY = 'hsl(262, 83%, 58%)';

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

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  // Load conversation list on mount
  useEffect(() => {
    api.listConversations()
      .then(list => setConversations(list))
      .catch(() => {});
  }, []);

  // Auto-save messages 2s after assistant finishes streaming
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.streaming || messages.length === 0) {
      return;
    }

    const hasUserMsg = messages.some(m => m.role === 'user');
    if (!hasUserMsg) return;

    saveTimerRef.current = setTimeout(async () => {
      try {
        const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));
        if (!activeConvId) {
          const conv = await api.createConversation(period);
          setActiveConvId(conv.id);
          await api.saveMessages(conv.id, apiMessages);
          setConversations(prev => [conv, ...prev]);
        } else {
          await api.saveMessages(activeConvId, apiMessages);
          // Refresh list to update title (auto-generated from first user msg)
          setConversations(prev =>
            prev.map(c => c.id === activeConvId ? { ...c, updated_at: new Date().toISOString() } : c)
          );
          // Reload list to pick up backend-generated title
          try {
            const list = await api.listConversations();
            setConversations(list);
          } catch {}
        }
      } catch {
        // save failed silently
      }
    }, 2000);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [messages, activeConvId, period]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    api.loadMessages(activeConvId)
      .then(msgs => {
        if (cancelled) return;
        setMessages(msgs.map(m => ({ role: m.role, content: m.content })));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => { cancelled = true; };
  }, [activeConvId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const list = await api.listConversations();
      setConversations(list);
    } catch {}
  }, []);

  // --- Conversation handlers ---

  const handleNewConversation = useCallback(() => {
    if (loading) abortCtrl?.abort();
    setMessages([]);
    setActiveConvId(null);
    setInput('');
    inputRef.current?.focus();
  }, [loading, abortCtrl]);

  const handleSwitchConversation = useCallback((convId: string) => {
    if (convId === activeConvId) return;
    if (loading) abortCtrl?.abort();
    setActiveConvId(convId);
    setInput('');
  }, [activeConvId, loading, abortCtrl]);

  const handleDeleteConversation = useCallback(async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
        if (loading) abortCtrl?.abort();
      }
    } catch {}
  }, [activeConvId, loading, abortCtrl]);

  // --- Chat handlers ---

  const streamChat = useCallback(async (chatMessages: Message[]) => {
    setLoading(true);
    const ctrl = new AbortController();
    setAbortCtrl(ctrl);

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
    // Keep activeConvId — next message auto-saves to same conversation
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
    } catch {}
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && !m.streaming);
  const followUps = lastAssistantMsg ? getFollowUps(lastAssistantMsg.content) : [];

  return (
    <div className="flex h-full p-4 gap-3">
      {/* Conversation Sidebar */}
      <div className="w-[240px] flex-shrink-0 flex flex-col">
        <Button
          variant="outline"
          className="mb-2 w-full justify-start gap-2"
          onClick={handleNewConversation}
        >
          <Plus className="h-4 w-4" style={{ color: PRIMARY }} />
          新建对话
        </Button>

        <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              暂无历史对话
            </p>
          )}
          {conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => handleSwitchConversation(conv.id)}
              className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                conv.id === activeConvId
                  ? 'bg-primary/10 text-foreground'
                  : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">
                  {conv.title || '新对话'}
                </p>
                <p className="text-[10px] opacity-60 mt-0.5">
                  {relativeTime(conv.updated_at)} · {conv.message_count} 条
                </p>
              </div>
              <button
                onClick={(e) => handleDeleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 transition-opacity"
                title="删除对话"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
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
              继续新对话
            </Button>
          )}
        </div>

        {/* Chat Card */}
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
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
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

                      {/* Message actions */}
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

          {/* Quick actions bar */}
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
    </div>
  );
}
