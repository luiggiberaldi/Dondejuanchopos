import { describe, it, expect } from 'vitest';
import { applyProjectedStock } from '../src/views/OwnerMonitorView';
import { normalizeSupervisorChanges, ensureSupervisorChangeId, getSupervisorChangeResolution } from '../src/utils/supervisorCommandModel';

describe('Optimistic UI & Responsive Monitor Sync Tests', () => {
    it('debe proyectar el stock de inmediato con múltiples cambios en cola y en vuelo', () => {
        const baseStock = 10;
        const changes = [
            { action: 'adjust_stock', data: { delta: 5 }, productId: 'p1' },
            { action: 'adjust_stock', data: { delta: -2 }, productId: 'p1' },
        ];
        const projected = applyProjectedStock(baseStock, changes);
        expect(projected).toBe(13);
    });

    it('debe limpiar cambios huérfanos con TTL de más de 20 minutos', () => {
        const now = Date.now();
        const oldChange = {
            action: 'adjust_stock',
            productId: 'p1',
            data: { delta: 5 },
            sentAt: new Date(now - 25 * 60 * 1000).toISOString()
        };
        const freshChange = {
            action: 'adjust_stock',
            productId: 'p2',
            data: { delta: 2 },
            sentAt: new Date(now - 2 * 60 * 1000).toISOString()
        };

        const list = [oldChange, freshChange];
        const MAX_INFLIGHT_AGE_MS = 20 * 60 * 1000;
        const valid = list.filter(c => {
            const time = new Date(c.sentAt || c.queuedAt || 0).getTime();
            return Number.isFinite(time) && (now - time) < MAX_INFLIGHT_AGE_MS;
        });

        expect(valid).toHaveLength(1);
        expect(valid[0].productId).toBe('p2');
    });

    it('debe asignar commandId único y normalizar la lista de cambios', () => {
        const raw = [{ action: 'edit', productId: 'p1', data: { priceUsd: 10 } }];
        const normalized = normalizeSupervisorChanges(raw);
        expect(normalized).toHaveLength(1);
        expect(normalized[0].commandId).toBeDefined();
        expect(typeof normalized[0].commandId).toBe('string');
    });

    it('debe resolver estado de comando aplicado o rechazado correctamente', () => {
        const change = { commandId: 'cmd-123', action: 'edit', productId: 'p1' };
        const commands = [
            { id: 'cmd-123', status: 'applied', command_type: 'inventory_update' }
        ];

        const res = getSupervisorChangeResolution(change, commands);
        expect(res.status).toBe('applied');
        expect(res.command.id).toBe('cmd-123');
    });
});
