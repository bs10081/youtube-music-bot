import { lazy, Suspense } from 'react';
const LegacyApp = lazy(() => import('./LegacyApp'));
const ListeningApp = lazy(() => import('./components/listening/ListeningApp'));
export default function App() {
  const legacy = new URLSearchParams(window.location.search).get('ui') === 'legacy';
  return <Suspense fallback={<div className="app-loading" role="status">正在開啟音樂空間…</div>}>
    {legacy ? <LegacyApp /> : <ListeningApp />}
  </Suspense>;
}
