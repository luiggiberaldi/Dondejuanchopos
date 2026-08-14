import { beforeEach, describe, expect, it } from 'vitest';
import {
    createSupervisorCommandId,
    ensureSupervisorChangeId,
    getSupervisorChangeKey,
    getSupervisorChangeResolution,
    isTerminalSupervisorCommandStatus,
    normalizeSupervisorChanges,
    restoreLocalRateState,
} from '../src/utils/supervisorCommandModel';

describe('supervisorCommandModel', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('genera un UUID válido y conserva el mismo ID al rehidratar un cambio', () => {
        const change = { action: 'adjust_stock', productId: 'p1', data: { delta: 2 }, queuedAt: '2026-08-13T10:00:00.000Z' };
        const first = ensureSupervisorChangeId(change);
        const second = ensureSupervisorChangeId(first);

        expect(first.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(second.commandId).toBe(first.commandId);
        expect(getSupervisorChangeKey(second)).toBe(first.commandId);
    });

    it('normaliza una cola completa sin cambiar IDs ya persistidos', () => {
        const existing = { commandId: createSupervisorCommandId(), action: 'edit', productId: 'p1' };
        const normalized = normalizeSupervisorChanges([existing, { action: 'delete', productId: 'p2' }]);

        expect(normalized).toHaveLength(2);
        expect(normalized[0].commandId).toBe(existing.commandId);
        expect(normalized[1].commandId).toBeTruthy();
    });

    it('resuelve una orden por commandId sin confundir una respuesta pendiente con rechazo', () => {
        const change = { commandId: 'cmd-1', action: 'adjust_stock', productId: 'p1' };

        expect(getSupervisorChangeResolution(change, [])).toMatchObject({ status: 'pending', command: null });
        expect(getSupervisorChangeResolution(change, [{ id: 'cmd-1', status: 'pending' }]).status).toBe('pending');
        expect(getSupervisorChangeResolution(change, [{ id: 'cmd-1', status: 'failed', error_reason: 'SKU inválido' }])).toMatchObject({ status: 'rejected' });
        expect(getSupervisorChangeResolution(change, [{ id: 'cmd-1', status: 'applied' }])).toMatchObject({ status: 'applied' });
    });

    it('clasifica aplicado, rechazado y cancelado como estados terminales', () => {
        expect(isTerminalSupervisorCommandStatus('pending')).toBe(false);
        expect(isTerminalSupervisorCommandStatus('applied')).toBe(true);
        expect(isTerminalSupervisorCommandStatus('applied_with_warnings')).toBe(true);
        expect(isTerminalSupervisorCommandStatus('failed')).toBe(true);
        expect(isTerminalSupervisorCommandStatus('cancelled')).toBe(true);
    });

    it('restaura el estado local anterior de la tasa y notifica a la UI', () => {
        const events = [];
        window.addEventListener('app_storage_update', event => events.push(event.detail.key));
        localStorage.setItem('bodega_rate_mode', 'manual');
        localStorage.setItem('bodega_use_auto_rate', 'false');
        localStorage.setItem('bodega_custom_rate', '99');

        restoreLocalRateState({ rateMode: 'bcv', useAutoRate: 'true', customRate: null });

        expect(localStorage.getItem('bodega_rate_mode')).toBe('bcv');
        expect(localStorage.getItem('bodega_use_auto_rate')).toBe('true');
        expect(localStorage.getItem('bodega_custom_rate')).toBeNull();
        expect(events).toEqual(expect.arrayContaining(['bodega_rate_mode', 'bodega_use_auto_rate', 'bodega_custom_rate']));
    });
});
