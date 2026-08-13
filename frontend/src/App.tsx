import { useState } from 'react';
import Layout from '@/components/Layout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toaster';
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

  return (
    <Layout currentPage={page} onNavigate={setPage} period={period} onPeriodChange={setPeriod}>
      <ErrorBoundary>
        <div className={page === 'dashboard' ? '' : 'hidden'}><Dashboard period={period} /></div>
        <div className={page === 'events' ? '' : 'hidden'}><Events /></div>
        <div className={page === 'skills' ? '' : 'hidden'}><Skills /></div>
        <div className={page === 'search' ? '' : 'hidden'}><SearchPage /></div>
        <div className={page === 'ai' ? '' : 'hidden'}><AIAssistant period={period} /></div>
        <div className={page === 'analytics' ? '' : 'hidden'}><Analytics /></div>
        <div className={page === 'config' ? '' : 'hidden'}><Config /></div>
      </ErrorBoundary>
      <Toaster />
    </Layout>
  );
}
