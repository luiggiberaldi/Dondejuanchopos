import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { recordReload, isLoopDetected } from './utils/reloadGuard.js';
import './index.css';

const recoveryLabRequested = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('recovery-lab') === '1';

if (recoveryLabRequested) {
  const RecoveryLabPanel = lazy(() => import('./components/RecoveryLabPanel.jsx'));
  function RecoveryLabApp() {
    const leaveLaboratory = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('recovery-lab');
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      window.location.reload();
    };

    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950 p-8 text-center text-slate-300">Cargando laboratorio aislado...</div>}>
        <RecoveryLabPanel onBack={leaveLaboratory} />
      </Suspense>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<RecoveryLabApp />);
} else {
  recordReload();

  if (window.location.protocol === 'file:') {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === 'string' && input.startsWith('/api/')) {
        const baseUrl = import.meta.env.VITE_API_URL || 'https://donde-juancho-pos.vercel.app';
        input = `${baseUrl}${input}`;
      }
      return originalFetch(input, init);
    };
  }

  if ('serviceWorker' in navigator) {
    const checkUpdates = () => {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.update().catch(() => {}));
      });
    };

    checkUpdates();
    setInterval(checkUpdates, 180000);
    window.addEventListener('focus', checkUpdates);

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      if (isLoopDetected()) {
        console.warn('[ServiceWorker] Reload cancelado por ReloadGuard.');
        return;
      }
      refreshing = true;
      window.location.reload();
    });
  }

  const NormalAppRoot = lazy(() => import('./NormalAppRoot.jsx'));
  ReactDOM.createRoot(document.getElementById('root')).render(
    <Suspense fallback={<div className="min-h-screen bg-slate-50 p-6 text-center text-slate-500">Cargando aplicación...</div>}>
      <NormalAppRoot />
    </Suspense>,
  );
}
