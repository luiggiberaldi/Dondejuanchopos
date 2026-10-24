import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regresión Causa #2 (CASO-SYNC-PRECIOS-CERVEZAS-SUPERVISOR-23102026):
// el dispatch de supervisor_inventory_applied ocurría DESPUÉS del await de
// updateCommandStatus (hasta ~21s de reintentos), dejando la memoria React
// stale mientras el autoguardado podía revertir el comando aplicado.
// Fix B: el heal local se dispatcha inmediatamente después de la persistencia,
// sin esperar la confirmación en la nube.
const mocks = vi.hoisted(() => ({ handler: null, update: vi.fn(), push: vi.fn(), inventory: vi.fn(), confirm: null }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    channel: () => ({
        on(_kind, _filter, handler) { mocks.handler = handler; return this; },
        subscribe() { return this; },
    }),
    removeChannel: vi.fn(async () => undefined),
    from: () => ({ update(fields) { mocks.update(fields); return this; }, eq: () => mocks.confirm.promise }),
} }));
vi.mock('../src/utils/remoteInventoryProcessor', () => ({
    applyInventoryCommand: mocks.inventory, isReappliableCommand: () => false,
}));
vi.mock('../src/hooks/useCloudSync', () => ({ pushCloudSync: mocks.push }));
vi.mock('../src/utils/storageService', () => ({ storageService: { getItem: async () => [] } }));
vi.mock('../src/services/remoteAuditService', () => ({ REMOTE_BACKUP_EXCLUDED_KEYS: [] }));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
import { useSupervisorCommands } from '../src/hooks/useSupervisorCommands';

function deferred() {
    let resolve; const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}
async function waitUntil(fn, timeoutMs = 2000) {
    const start = Date.now();
    while (!fn()) {
        if (Date.now() - start > timeoutMs) throw new Error('waitUntil: timeout');
        await new Promise(r => setTimeout(r, 5));
    }
}

let root, host;
function Harness() { useSupervisorCommands('register-test'); return null; }

beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    mocks.update.mockReset();
    mocks.push.mockReset().mockResolvedValue(true);
    mocks.inventory.mockReset();
    mocks.confirm = deferred();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Fix B (Causa #2): el heal local no espera la confirmación en la nube', () => {
    it('dispatcha supervisor_inventory_applied antes de que responda updateCommandStatus', async () => {
        const events = [];
        const listener = e => events.push(e.detail);
        window.addEventListener('supervisor_inventory_applied', listener);
        try {
            const row = { id: 'p1', name: 'Zulia', priceUsd: 3.8 };
            mocks.inventory.mockResolvedValue({ success: true, productName: 'Zulia', updatedProducts: [row] });

            // act() devuelve un thenable de React (su .then no deriva promesa):
            // envolver en un async real para poder observar cuándo termina.
            let finished = false;
            const processing = (async () => {
                await act(async () => {
                    await mocks.handler({ new: {
                        id: crypto.randomUUID(), status: 'pending', command_type: 'inventory_update',
                        payload: { action: 'edit', productId: 'p1', data: {} },
                    } });
                });
                finished = true;
            })();

            // La confirmación en la nube queda COLGADA (el gate nunca se resolvió):
            // si el evento llega ahora, el heal no depende de la nube.
            await waitUntil(() => events.length === 1);
            expect(finished).toBe(false);
            expect(events[0]).toMatchObject({ action: 'edit', productName: 'Zulia', updatedProducts: [row] });

            // Ahora sí responde la nube: el comando termina y se confirma con applied_at.
            mocks.confirm.resolve({ error: null });
            await processing;
            expect(finished).toBe(true);
            expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
                status: 'applied', applied_at: expect.any(String),
            }));
        } finally {
            window.removeEventListener('supervisor_inventory_applied', listener);
        }
    });

    it('el evento también se dispara si la confirmación en la nube falla', async () => {
        const events = [];
        const listener = e => events.push(e.detail);
        window.addEventListener('supervisor_inventory_applied', listener);
        try {
            mocks.inventory.mockResolvedValue({ success: true, productName: 'Zulia', updatedProducts: [] });
            // status 400 = error definitivo NO transitorio (sin `status`,
            // isTransientConfirmError reintenta 3s/6s/12s de reloj real).
            mocks.confirm.resolve({ error: { status: 400, code: '23514', message: 'acción inválida' } });
            await act(async () => {
                await mocks.handler({ new: {
                    id: crypto.randomUUID(), status: 'pending', command_type: 'inventory_update',
                    payload: { action: 'adjust_stock', productId: 'p1', data: { delta: 1 } },
                } });
            });
            expect(events).toHaveLength(1);
        } finally {
            window.removeEventListener('supervisor_inventory_applied', listener);
        }
    });
});
