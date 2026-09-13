/**
 * usePcDivergenceCheck — FASE 4 (observabilidad) para el Monitor del Supervisor.
 *
 * Compara lo que la nube sabe (Doc 60 = la prop `sales` del Monitor, que ya viene
 * sincronizada) contra lo que la PC DECLARA tener (su backup completo, leído bajo
 * demanda vía RPC de pairing). El incidente clase "15 h de ventas sin llegar a la
 * nube" se hacía visible aquí en minutos, no al cuadrar la gaveta.
 *
 * Política de egress: el backup del PC es pesado → auto-chequeo UNA vez por sesión
 * del Monitor (TTL 15 min en sessionStorage) + re-chequeo manual siempre disponible.
 * El veredicto se recalcula en vivo: si llegan ventas nuevas, `cloudSalesCount`
 * cambia y el veredicto se actualiza SIN re-descargar nada.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRemoteFullBackup } from '../services/remoteAuditService';
import { summarizeBackupSales, computeDivergence } from '../utils/divergenceAlert';

const CACHE_KEY = 'dj_divergence_check_at';
const AUTO_TTL_MS = 15 * 60 * 1000;

export function usePcDivergenceCheck(pairedDeviceId, cloudSalesCount, { enabled = true, pcOnline = false } = {}) {
    const [pcStats, setPcStats] = useState(null); // { count, updatedAt } | null
    const [checking, setChecking] = useState(false);
    const [lastChecked, setLastChecked] = useState(null);
    const [lastError, setLastError] = useState(null);
    const busyRef = useRef(false);

    const runCheck = useCallback(async () => {
        if (!pairedDeviceId || busyRef.current) return;
        busyRef.current = true;
        setChecking(true);
        try {
            const result = await fetchRemoteFullBackup(pairedDeviceId);
            if (!result.success || !result.backup) {
                setPcStats(null);
                setLastError(result.error?.message || 'El PC no respondió con un backup.');
            } else {
                const { count } = summarizeBackupSales(result.backup);
                setPcStats({ count, updatedAt: result.updatedAt || null });
                setLastError(null);
            }
            setLastChecked(new Date().toISOString());
            try { sessionStorage.setItem(CACHE_KEY, String(Date.now())); } catch { /* ok */ }
        } finally {
            setChecking(false);
            busyRef.current = false;
        }
    }, [pairedDeviceId]);

    // Veredicto en vivo (recalcula cuando la nube avanza) — solo lectura pura.
    // `pcOnline` (presence) evita falsas alarmas: un backup viejo con PC en línea
    // es normal (los backups no son heartbeat), NO es 'stale'.
    const verdict = useMemo(() => {
        if (lastError && !pcStats) {
            return { level: 'unknown', title: 'Sync sin verificar', message: `No se pudo leer el backup del PC: ${lastError}`, missing: null };
        }
        if (!pcStats) return null;
        return computeDivergence({ cloudSalesCount, pcSalesCount: pcStats.count, pcBackupAt: pcStats.updatedAt, pcOnline });
    }, [cloudSalesCount, pcStats, lastError, pcOnline]);

    // Auto-chequeo: una vez por sesión del Monitor (TTL 15 min).
    useEffect(() => {
        if (!enabled || !pairedDeviceId) return;
        let last = 0;
        try { last = Number(sessionStorage.getItem(CACHE_KEY) || 0); } catch { /* ok */ }
        if (Date.now() - last > AUTO_TTL_MS) runCheck();
        // Intencional: solo al montar / cambiar de dispositivo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, pairedDeviceId]);

    return { verdict, checking, lastChecked, checkDivergence: runCheck };
}
