/**
 * tests/divergenceBannerHidden.test.jsx
 *
 * FASE 4 — el banner de divergencia PC ↔ nube queda OCULTO por defecto (11-10-2026).
 *
 * Motivo: el backup completo del PC no se refresca desde el 13-09 (las subidas fallan
 * con `statement timeout`), así que el veredicto compara una foto de hace un mes contra
 * la nube de hoy y acusa "PC sin confirmación reciente" a una caja que está vendiendo.
 * Se oculta sin borrar la funcionalidad: reactivable con el flag local.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const remoteAudit = vi.hoisted(() => ({ fetchRemoteFullBackup: vi.fn() }));
vi.mock('../src/services/remoteAuditService', () => remoteAudit);

import {
    usePcDivergenceCheck,
    isPcDivergenceBannerEnabled,
    PC_DIVERGENCE_BANNER_FLAG,
} from '../src/hooks/usePcDivergenceCheck';

const CACHE_KEY = 'dj_divergence_check_at';

function backupWith(salesCount) {
    return {
        success: true,
        updatedAt: new Date().toISOString(),
        backup: {
            data: {
                idb: {
                    bodega_sales_v1: Array.from({ length: salesCount }, (_, i) => ({ id: `s${i}`, saleNumber: i + 1 })),
                },
            },
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(PC_DIVERGENCE_BANNER_FLAG);
    sessionStorage.removeItem(CACHE_KEY);
    remoteAudit.fetchRemoteFullBackup.mockResolvedValue(backupWith(10));
});

describe('kill-switch del banner de divergencia', () => {
    it('está oculto cuando el flag no existe, y sólo se muestra con el flag en "true"', () => {
        expect(isPcDivergenceBannerEnabled()).toBe(false);

        localStorage.setItem(PC_DIVERGENCE_BANNER_FLAG, 'false');
        expect(isPcDivergenceBannerEnabled()).toBe(false);

        localStorage.setItem(PC_DIVERGENCE_BANNER_FLAG, 'true');
        expect(isPcDivergenceBannerEnabled()).toBe(true);
    });

    it('por defecto NO descarga el backup del PC ni produce veredicto', async () => {
        const { result } = renderHook(() => usePcDivergenceCheck('caja-1', 1490));

        // Se da margen al efecto de auto-chequeo: debe quedarse sin hacer nada.
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(remoteAudit.fetchRemoteFullBackup).not.toHaveBeenCalled();
        expect(result.current.verdict).toBeNull();
    });

    it('con el flag activado vuelve a verificar y compara contra la nube', async () => {
        localStorage.setItem(PC_DIVERGENCE_BANNER_FLAG, 'true');

        const { result } = renderHook(() => usePcDivergenceCheck('caja-1', 1490));

        await waitFor(() => expect(result.current.checking).toBe(false));
        await waitFor(() => expect(result.current.verdict).not.toBeNull());

        expect(remoteAudit.fetchRemoteFullBackup).toHaveBeenCalledWith('caja-1');
        expect(result.current.verdict.missing).toBe(1480);
    });

    it('`enabled: false` explícito gana sobre el flag activado', async () => {
        localStorage.setItem(PC_DIVERGENCE_BANNER_FLAG, 'true');

        const { result } = renderHook(() => usePcDivergenceCheck('caja-1', 1490, { enabled: false }));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(remoteAudit.fetchRemoteFullBackup).not.toHaveBeenCalled();
        expect(result.current.verdict).toBeNull();
    });
});
