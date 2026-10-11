import React, { useState, useEffect } from 'react';
import App from './App.jsx';
import ResetPasswordView from './views/ResetPasswordView.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { SecurityProvider } from './hooks/useSecurity.jsx';
import { isLoopDetected, clearReloadGuard } from './utils/reloadGuard.js';

function attachWheelGuard() {
    const handler = event => {
        if (event.target?.type === 'number') {
            event.target.blur();
            event.preventDefault();
        }
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
}

function detectRecovery() {
    return window.location.hash.includes('type=recovery')
        || new URLSearchParams(window.location.search).has('code');
}

function AppRouter() {
    const [isRecovery, setIsRecovery] = useState(detectRecovery);
    const [isLoopBlocked, setIsLoopBlocked] = useState(() => isLoopDetected());

    useEffect(() => attachWheelGuard(), []);

    useEffect(() => {
        let cancelled = false;
        let subscription = null;
        import('./config/supabaseCloud.js').then(({ supabaseCloud }) => {
            if (!supabaseCloud || cancelled) return;
            const result = supabaseCloud.auth.onAuthStateChange(event => {
                if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
            });
            subscription = result.data?.subscription || null;
            if (cancelled) subscription?.unsubscribe();
        });
        return () => {
            cancelled = true;
            subscription?.unsubscribe();
        };
    }, []);

    if (isLoopBlocked) {
        return (
            <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center select-none">
                <div className="w-16 h-16 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center mb-4 text-3xl font-bold border border-amber-500/30">⚠️</div>
                <h1 className="text-2xl font-bold mb-2">Bucle de Recargas Pausado</h1>
                <p className="text-slate-300 max-w-md mb-6 text-sm leading-relaxed">La aplicación se ha recargado varias veces seguidas rápidamente. La sincronización se ha pausado para proteger tu consumo de datos de red.</p>
                <button onClick={() => { clearReloadGuard(); setIsLoopBlocked(false); }} className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 font-bold rounded-xl text-white shadow-lg active:scale-95 transition-all">
                    Reintentar y Restaurar App
                </button>
            </div>
        );
    }

    if (isRecovery) {
        return <ResetPasswordView onDone={() => {
            window.history.replaceState({}, document.title, window.location.pathname);
            setIsRecovery(false);
        }} />;
    }

    return <App />;
}

export default function NormalAppRoot() {
    return (
        <React.StrictMode>
            <ToastProvider>
                <SecurityProvider>
                    <React.Suspense fallback={<div className="min-h-screen bg-slate-50 p-6 text-center text-slate-500">Cargando aplicación...</div>}>
                        <AppRouter />
                    </React.Suspense>
                </SecurityProvider>
            </ToastProvider>
        </React.StrictMode>
    );
}
