import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Calendar, BookOpen, Search, BarChart3, Settings, Zap, ChevronLeft, Menu, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
  period: string;
  onPeriodChange: (period: 'week' | 'month' | 'year') => void;
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'events', label: 'Events', icon: Calendar },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'ai', label: 'AI Assistant', icon: Sparkles },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'config', label: 'Config', icon: Settings },
];

const PERIODS: { value: 'week' | 'month' | 'year'; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export default function Layout({ children, currentPage, onNavigate, period, onPeriodChange }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className={cn(
        "flex flex-col border-r bg-card transition-all duration-300",
        collapsed ? "w-16" : "w-56"
      )}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-14 border-b">
          <Zap className="w-6 h-6 text-primary flex-shrink-0" />
          {!collapsed && (
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold text-base">EvoWork</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">AI</Badge>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 space-y-1 px-2">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm transition-colors",
                currentPage === item.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="p-2 border-t">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full py-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary"
          >
            {collapsed ? <Menu className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <header className="flex items-center justify-between px-6 h-14 border-b bg-card">
          <h1 className="text-lg font-semibold capitalize">{currentPage}</h1>
          <div className="flex items-center gap-1 bg-secondary rounded-md p-0.5">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => onPeriodChange(p.value)}
                className={cn(
                  "px-3 py-1 text-xs rounded transition-colors",
                  period === p.value
                    ? "bg-background text-foreground shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
