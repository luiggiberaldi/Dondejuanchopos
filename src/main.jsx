import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ResetPasswordView from './views/ResetPasswordView.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { SecurityProvider } from './hooks/useSecurity.jsx'
import { supabaseCloud } from './config/supabaseCloud.js'
import { recordReload, isLoopDetected, clearReloadGuard } from './utils/reloadGuard.js'

// Registrar esta carga de página UNA SOLA VEZ al inicio del módulo.
// `recordReload` escribe en localStorage; `isLoopDetected` solo lee.
recordReload();
import './index.css'

// ── Interceptor global de Fetch para Electron (protocolo file://) ──
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

// ── Forzar actualización automática del Service Worker al desplegar en Vercel ──
if ('serviceWorker' in navigator) {
  const checkUpdates = () => {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => reg.update().catch(() => {/* Ignorar fallos en desarrollo o sin conexión */}));
    });
  };

  // Chequeo inmediato al cargar
  checkUpdates();

  // Chequeo periódico cada 3 minutos en segundo plano
  setInterval(checkUpdates, 180000);

  // Chequeo cuando el usuario vuelve a enfocar la pestaña/pantalla
  window.addEventListener('focus', checkUpdates);

  // Cuando el nuevo ServiceWorker se activa (despliegue en Vercel), recargar automáticamente
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

// ── Evitar que la rueda del mouse cambie valores en inputs numéricos ──
// HOOK-033: Antes este listener se registraba a nivel módulo (sin cleanup),
// lo que causaba:
//   1) En HMR, se acumulaban listeners en cada reload.
//   2) El listener sobrevivía al unmount del root en tests.
// Lo movemos dentro de `AppRouter` (useEffect) para que tenga cleanup correcto.
function _attachWheelGuard() {
  const handler = (e) => {
    if (e.target?.type === 'number') {
      e.target.blur();
      e.preventDefault();
    }
  };
  document.addEventListener('wheel', handler, { passive: false });
  return () => document.removeEventListener('wheel', handler);
}

// Detectar token de recuperación en la URL al cargar (antes de React)
function detectRecovery() {
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);
  return hash.includes('type=recovery') || params.has('code');
}

function AppRouter() {
  const [isRecovery, setIsRecovery] = useState(detectRecovery);
  const [isLoopBlocked, setIsLoopBlocked] = useState(() => isLoopDetected());

  // HOOK-033: wheel listener con cleanup correcto.
  useEffect(() => _attachWheelGuard(), []);

  useEffect(() => {
    if (!supabaseCloud) return;
    const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (isLoopBlocked) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-16 h-16 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center mb-4 text-3xl font-bold border border-amber-500/30">
          ⚠️
        </div>
        <h1 className="text-2xl font-bold mb-2">Bucle de Recargas Pausado</h1>
        <p className="text-slate-300 max-w-md mb-6 text-sm leading-relaxed">
          La aplicación se ha recargado varias veces seguidas rápidamente. La sincronización se ha pausado para proteger tu consumo de datos de red.
        </p>
        <button
          onClick={() => {
            clearReloadGuard();
            setIsLoopBlocked(false);
          }}
          className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 font-bold rounded-xl text-white shadow-lg active:scale-95 transition-all"
        >
          Reintentar y Restaurar App
        </button>
      </div>
    );
  }

  if (isRecovery) {
    return (
      <ResetPasswordView
        onDone={() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          setIsRecovery(false);
        }}
      />
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <SecurityProvider>
        <AppRouter />
      </SecurityProvider>
    </ToastProvider>
  </React.StrictMode>,
)

