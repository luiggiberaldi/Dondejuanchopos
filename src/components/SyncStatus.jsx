import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { hasCriticalCloudPushInFlight } from '../hooks/useCloudSync';

/**
 * SyncStatus — Indicador visual de conectividad y subida crítica de cierre.
 * - Online:  Nube/Wifi verde
 * - Offline: Wifi rojo tachado
 * - Subida crítica activa: pastilla ámbar animada "Subiendo cierre..."
 */
export default function SyncStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [isCriticalSyncBusy, setIsCriticalSyncBusy] = useState(() => hasCriticalCloudPushInFlight());

    useEffect(() => {
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        const handleCriticalSync = (event) => {
            setIsCriticalSyncBusy(Boolean(event?.detail?.busy));
        };

        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        window.addEventListener('cloud_critical_sync_state', handleCriticalSync);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
            window.removeEventListener('cloud_critical_sync_state', handleCriticalSync);
        };
    }, []);

    return (
        <div className="flex items-center gap-1.5">
            {isCriticalSyncBusy && (
                <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold tracking-wide bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60"
                    title="Sincronizando cierre de caja con el Supervisor"
                >
                    <Loader2 size={12} strokeWidth={2.5} className="animate-spin" />
                    <span>Subiendo cierre...</span>
                </div>
            )}
            <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold tracking-wide transition-all duration-300 ${
                    isOnline
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 animate-pulse'
                }`}
                title={isOnline ? 'Conectado a Internet' : 'Sin conexion a Internet'}
            >
                {isOnline ? (
                    <>
                        <Wifi size={13} strokeWidth={2.5} />
                        <span className="hidden sm:inline">Online</span>
                    </>
                ) : (
                    <>
                        <WifiOff size={13} strokeWidth={2.5} />
                        <span>Offline</span>
                    </>
                )}
            </div>
        </div>
    );
}
