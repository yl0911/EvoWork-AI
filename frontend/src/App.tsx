import { useState } from 'react';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Events from '@/pages/Events';
import Skills from '@/pages/Skills';
import SearchPage from '@/pages/Search';
import AIAssistant from '@/pages/AIAssistant';
import Analytics from '@/pages/Analytics';
import Config from '@/pages/Config';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard period={period} />;
      case 'events':    return <Events />;
      case 'skills':    return <Skills />;
      case 'search':    return <SearchPage />;
      case 'ai':        return <AIAssistant period={period} />;
      case 'analytics': return <Analytics />;
      case 'config':    return <Config />;
      default:          return <Dashboard period={period} />;
    }
  };

  return (
    <Layout currentPage={page} onNavigate={setPage} period={period} onPeriodChange={setPeriod}>
      {renderPage()}
    </Layout>
  );
}
