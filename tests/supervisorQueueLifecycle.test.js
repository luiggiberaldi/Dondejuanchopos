import { act, createElement, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ insert: vi.fn(), rows: [], toast: vi.fn(), writes: vi.fn() }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    from: () => ({
        select() { return this; }, eq() { return this; }, order() { return this; },
        limit: async () => ({ data: m.rows, error: null }),
        in: async () => ({ data: m.rows, error: null }),
        maybeSingle: async () => ({ data: m.rows[0] || null, error: null }),
        insert: row => m.insert(row),
    }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => undefined,
} }));
vi.mock('../src/components/Toast', () => ({ showToast: m.toast }));
vi.mock('../src/services/remoteAuditService', () => ({ fetchRemoteFullBackup: vi.fn() }));
vi.mock('../src/utils/storageService', () => ({ storageService: { setItem: m.writes } }));
vi.mock('../src/utils/productProcessor', () => ({ calculateComboStock: () => 0, getEffectiveCostUsd: () => 0 }));
import { useSupervisorCommandQueue } from '../src/hooks/useSupervisorCommandQueue';
import { useMonitorInventory } from '../src/hooks/useMonitorInventory';
import { SUPERVISOR_RATE_PENDING_KEY } from '../src/utils/supervisorCommandModel';

let root, host, queue, inventory;
let products;
let pairedDeviceId;
const setter = vi.fn();
function Harness() {
    const currentQueue = useSupervisorCommandQueue({ pairedDeviceId, products, setProducts: setter,
        supervisorUser: { id: 'u-test', rol: 'SUPERVISOR' }, setSales: vi.fn(), setSelectedSaleDetail: vi.fn() });
    const currentInventory = useMonitorInventory({ products, pendingChanges: currentQueue.pendingChanges,
        inFlightChanges: currentQueue.inFlightChanges, recentlyConfirmedIds: currentQueue.recentlyConfirmedIds });
    useEffect(() => {
        queue = currentQueue;
        inventory = currentInventory;
    });
    return null;
}
async function render() { await act(async () => root.render(createElement(StrictMode, null, createElement(Harness)))); }
async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); await render();
}
async function add(productId = 'p1', delta = 5) {
    await act(async () => queue.queueInventoryChange('adjust_stock', productId, { delta }));
}
async function send() { await act(async () => queue.uploadPendingChanges()); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function command(id, status, type = 'inventory_update') {
    return { id, status, command_type: type, monitor_device_id: 'monitor-test', primary_device_id: 'box-test' };
}
async function commands(rows) { m.rows = rows; await act(async () => queue.setAllCloudCmds(rows)); }
beforeEach(() => {
    vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); localStorage.setItem('dj_device_id', 'monitor-test'); localStorage.setItem('dj_paired_device_id', 'box-test');
    pairedDeviceId = 'box-test';
    products = [{ id: 'p1', name: 'Producto', stock: 10 }];
    m.rows = []; m.insert.mockReset().mockResolvedValue({ error: null }); m.toast.mockReset(); m.writes.mockReset(); setter.mockReset();
});
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = null; host?.remove(); vi.useRealTimers(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Cola real del supervisor: concurrencia, catálogo y tasa', () => {
    it('conserva B agregado mientras se envía A', async () => {
        await mount(); await add(); const d = deferred(); m.insert.mockReturnValueOnce(d.promise);
        let upload; await act(async () => { upload = queue.uploadPendingChanges(); });
        await add('p2', 2);
        await act(async () => { d.resolve({ error: null }); await upload; });
        expect(queue.pendingChanges.map(c => c.productId)).toEqual(['p2']);
        expect(queue.inFlightChanges).toHaveLength(1);
    });
    it('no cambia el UUID ni el contenido enviado al editar el mismo producto en vuelo', async () => {
        await mount(); await add(); const d = deferred(); m.insert.mockReturnValueOnce(d.promise);
        let upload; await act(async () => { upload = queue.uploadPendingChanges(); });
        const row = structuredClone(m.insert.mock.calls[0][0]); await add('p1', 2);
        await act(async () => { d.resolve({ error: null }); await upload; });
        expect(queue.pendingChanges).toHaveLength(1);
        expect(queue.pendingChanges[0].commandId).not.toBe(row.id);
        expect(queue.pendingChanges[0].data.delta).toBe(2);
        expect(m.insert.mock.calls[0][0]).toEqual(row);
    });
    it('persiste el sobre inmutable antes de enviar y lo reintenta igual tras recargar', async () => {
        await mount(); await add(); m.insert.mockResolvedValueOnce({ error: { message: 'respuesta perdida' } }); await send();
        const original = structuredClone(m.insert.mock.calls[0][0]);
        await act(async () => root.unmount()); host.remove(); root = null;
        await mount(); await add('p1', 2); await send();
        expect(m.insert.mock.calls[1][0]).toEqual(original);
        expect(m.insert.mock.calls[2][0].id).not.toBe(original.id);
    });
    it('concilia cada éxito aunque después otra fila lance una excepción', async () => {
        await mount(); await add(); await add('p2', 2);
        m.insert.mockResolvedValueOnce({ error: null }).mockRejectedValueOnce(new Error('red'));
        await send(); expect(queue.inFlightChanges.some(c => c.productId === 'p1')).toBe(true);
        expect(queue.pendingChanges.some(c => c.productId === 'p2')).toBe(true);
        expect(queue.pendingChanges.some(c => c.productId === 'p1')).toBe(false);
    });
    it('no envía si no puede persistir la identidad del comando', async () => {
        await mount(); await add(); const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        try { await send(); expect(m.insert).not.toHaveBeenCalled(); expect(queue.pendingChanges).toHaveLength(1); }
        finally { spy.mockRestore(); }
    });
    it('un rechazo definitivo permite continuar y descartar sin perder el resto', async () => {
        await mount(); await add(); await add('p2', 2);
        m.insert.mockResolvedValueOnce({ error: { code: '23514', message: 'acción inválida' } });
        await send();
        expect(m.insert).toHaveBeenCalledTimes(2);
        expect(queue.pendingChanges[0].syncState).toBe('rejected_local');
        expect(queue.inFlightChanges[0].productId).toBe('p2');
        expect(inventory.projectedProducts[0].stock).toBe(10);
        await send(); expect(m.insert).toHaveBeenCalledTimes(2);
        await act(async () => queue.discardSinglePendingChange(0));
        expect(queue.pendingChanges).toHaveLength(0);
    });
    it('un resultado incierto no marca como intentado el comando siguiente', async () => {
        await mount(); await add(); await add('p2', 2);
        m.insert.mockRejectedValueOnce(new Error('red')); await send();
        expect(m.insert).toHaveBeenCalledTimes(1);
        expect(queue.pendingChanges.find(c => c.productId === 'p2').attemptedAt).toBeUndefined();
        await act(async () => queue.discardSinglePendingChange(1));
        expect(queue.pendingChanges.map(c => c.productId)).toEqual(['p1']);
    });
    it('un rechazo después de un timeout no borra la incertidumbre original', async () => {
        await mount(); await add(); m.insert.mockRejectedValueOnce(new Error('respuesta perdida')); await send();
        m.insert.mockResolvedValueOnce({ error: { code: '42501', message: 'permiso cambiado' } }); await send();
        expect(queue.pendingChanges[0].syncState).toBe('uncertain');
        await act(async () => queue.discardSinglePendingChange(0));
        expect(queue.pendingChanges).toHaveLength(1);
    });
    it('actualiza el contenido de B editado mientras A se envía, antes de congelarlo', async () => {
        await mount(); await add(); await add('p2', 2);
        const d = deferred(); m.insert.mockReturnValueOnce(d.promise);
        let upload; await act(async () => { upload = queue.uploadPendingChanges(); });
        await add('p2', 3);
        await act(async () => { d.resolve({ error: null }); await upload; });
        expect(m.insert.mock.calls[1][0].payload.data.delta).toBe(5);
    });
    it('un doble clic con evento React solo realiza un envío por UUID', async () => {
        await mount(); await add(); const d = deferred(); m.insert.mockReturnValueOnce(d.promise);
        let upload; await act(async () => { upload = queue.uploadPendingChanges({ type: 'click' }); });
        await act(async () => queue.uploadPendingChanges({ type: 'click' }));
        expect(m.insert).toHaveBeenCalledTimes(1);
        await act(async () => { d.resolve({ error: null }); await upload; });
    });
    it('un duplicado remoto con otro contenido no se da por aceptado ni cambia su UUID', async () => {
        await mount(); await add(); m.insert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicado' } });
        const id = queue.pendingChanges[0].commandId;
        m.rows = [{ ...command(id, 'pending'), payload: { action: 'delete', productId: 'otro' } }];
        await send();
        expect(queue.pendingChanges[0]).toMatchObject({ commandId: id, syncState: 'rejected_local' });
        expect(queue.inFlightChanges).toHaveLength(0);
    });
    it('un duplicado remoto con el mismo contenido se concilia sin reinserciones adicionales', async () => {
        await mount(); await add();
        m.insert.mockImplementationOnce(async row => {
            m.rows = [{ ...row, payload: { ...row.payload }, status: 'applied' }];
            return { error: { code: '23505', message: 'duplicado' } };
        });
        await send();
        expect(queue.pendingChanges).toHaveLength(0);
        expect(queue.inFlightChanges[0].syncState).toBe('awaiting_catalog');
        expect(m.insert).toHaveBeenCalledTimes(1);
    });
    it('la migración legacy no se repite en otra caja', async () => {
        localStorage.setItem('dj_pending_inventory_changes_v1', JSON.stringify([{ commandId: 'legacy', action: 'adjust_stock', productId: 'p1', data: { delta: 5 } }]));
        await mount(); expect(queue.pendingChanges).toHaveLength(1);
        await act(async () => queue.discardPendingChanges());
        await act(async () => root.unmount()); host.remove(); root = null;
        pairedDeviceId = 'box-other'; localStorage.setItem('dj_paired_device_id', pairedDeviceId);
        await mount(); expect(queue.pendingChanges).toHaveLength(0);
        await send(); expect(m.insert).not.toHaveBeenCalled();
    });
    it('una cola corrupta se conserva y bloquea nuevos envíos', async () => {
        const key = 'dj_supervisor_queue_v2:box-test:monitor-test';
        localStorage.setItem(key, '{ilegible');
        await mount(); await add(); await send();
        expect(localStorage.getItem(key)).toBe('{ilegible'); expect(m.insert).not.toHaveBeenCalled();
    });
    it('cerrar el monitor durante A no envía B ni cambia su cola después del desmontaje', async () => {
        await mount(); await add(); await add('p2', 2); const d = deferred(); m.insert.mockReturnValueOnce(d.promise);
        let upload; await act(async () => { upload = queue.uploadPendingChanges(); });
        await act(async () => root.unmount()); root = null;
        const key = 'dj_supervisor_queue_v2:box-test:monitor-test'; const saved = localStorage.getItem(key);
        await act(async () => { d.resolve({ error: null }); await upload; });
        expect(m.insert).toHaveBeenCalledTimes(1); expect(localStorage.getItem(key)).toBe(saved);
    });
    it('cambiar de caja durante A no permite continuar el lote en otra vinculación', async () => {
        await mount(); await add(); await add('p2', 2); const d = deferred(); m.insert.mockReturnValueOnce(d.promise);
        let upload; await act(async () => { upload = queue.uploadPendingChanges(); });
        localStorage.setItem('dj_paired_device_id', 'box-other');
        await act(async () => { d.resolve({ error: null }); await upload; });
        expect(m.insert).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('dj_supervisor_queue_v2:box-other:monitor-test')).toBeNull();
    });
    it('no reintroduce como pendiente una confirmación que llega durante el envío', async () => {
        await mount(); await add(); const d = deferred(); m.insert.mockReturnValueOnce(d.promise);
        let upload; await act(async () => { upload = queue.uploadPendingChanges(); });
        const id = m.insert.mock.calls[0][0].id;
        await commands([command(id, 'failed')]);
        await act(async () => { d.resolve({ error: null }); await upload; });
        expect(queue.pendingChanges).toHaveLength(0); expect(queue.inFlightChanges).toHaveLength(0);
    });
    it('no descarta silenciosamente comandos de resultado incierto', async () => {
        await mount(); await add(); m.insert.mockResolvedValueOnce({ error: { message: 'timeout' } }); await send();
        await add('p2', 2); await act(async () => queue.discardPendingChanges());
        expect(queue.pendingChanges).toHaveLength(1); expect(queue.pendingChanges[0].productId).toBe('p1');
    });
    it('no pierde comandos en vuelo antiguos al recargar', async () => {
        localStorage.setItem('dj_inflight_inventory_changes_v1', JSON.stringify([{ commandId: 'old', action: 'adjust_stock', productId: 'p1', data: { delta: 5 }, sentAt: '2020-01-01T00:00:00Z' }]));
        await mount(); expect(queue.inFlightChanges).toHaveLength(1);
    });
    it('no confirma por coincidencia numérica ni suma dos veces al llegar el recibo', async () => {
        await mount(); await add(); await send(); const id = m.insert.mock.calls[0][0].id;
        products = [{ id: 'p1', stock: 15 }]; await render();
        expect(queue.inFlightChanges).toHaveLength(1);
        products = [{ id: 'p1', stock: 15, stockOperationIds: [id] }]; await render();
        expect(inventory.projectedProducts[0].stock).toBe(15);
        expect(setter).not.toHaveBeenCalled(); expect(m.writes).not.toHaveBeenCalled();
    });
    it('ACK antes del catálogo espera el recibo sin sobrescribir la base', async () => {
        await mount(); await add(); await send(); const id = m.insert.mock.calls[0][0].id;
        await commands([command(id, 'applied')]);
        expect(queue.inFlightChanges[0].syncState).toBe('awaiting_catalog');
        expect(inventory.projectedProducts[0]._isAwaitingCatalog).toBe(true);
        expect(setter).not.toHaveBeenCalled();
        products = [{ id: 'p1', stock: 13, stockOperationIds: [id] }]; await render();
        expect(inventory.projectedProducts[0].stock).toBe(13); expect(queue.inFlightChanges).toHaveLength(0);
    });
    it('un ACK antiguo con traza posterior resuelve el recibo que salió del anillo', async () => {
        await mount(); await add(); await send(); const id = m.insert.mock.calls[0][0].id;
        await commands([{ ...command(id, 'applied'), applied_at: '2026-09-12T10:00:00Z' }]);
        products = [{ id: 'p1', stock: 3, stockUpdatedAt: '2026-09-12T11:00:00Z',
            stockOperationIds: Array.from({ length: 25 }, (_, i) => `later-${i}`) }];
        await render(); expect(queue.inFlightChanges).toHaveLength(0);
        expect(inventory.projectedProducts[0].stock).toBe(3); expect(setter).not.toHaveBeenCalled();
    });
    it('las advertencias no se convierten en éxito por una traza ajena', async () => {
        await mount(); await add(); await send(); const id = m.insert.mock.calls[0][0].id;
        await commands([{ ...command(id, 'applied_with_warnings'), applied_at: '2026-09-12T10:00:00Z' }]);
        products = [{ id: 'p1', stock: 3, stockUpdatedAt: '2026-09-12T11:00:00Z',
            stockOperationIds: Array.from({ length: 25 }, (_, i) => `later-${i}`) }];
        await render(); expect(queue.inFlightChanges).toHaveLength(1);
    });
    it('un batch aplicado no queda esperando un producto sin identificador', async () => {
        await mount();
        await act(async () => queue.uploadPendingChanges([{ commandId: 'batch-a', action: 'batch_edit', data: { items: [] } }]));
        await commands([command('batch-a', 'applied')]);
        expect(queue.pendingChanges).toHaveLength(0); expect(queue.inFlightChanges).toHaveLength(0);
    });
    it('producto ausente no produce excepción al confirmar un ajuste', async () => {
        await mount(); await add(); await send(); products = []; await render();
        await commands([command(m.insert.mock.calls[0][0].id, 'applied')]);
        expect(queue.inFlightChanges).toHaveLength(1); expect(setter).not.toHaveBeenCalled();
    });
    it('no duplica altas cuando el producto ya llegó al catálogo', async () => {
        await mount(); await act(async () => queue.queueInventoryChange('add', 'p2', { id: 'p2', stock: 4 })); await send();
        products = [...products, { id: 'p2', stock: 4, lastOperationId: m.insert.mock.calls[0][0].id }]; await render();
        expect(inventory.projectedProducts.filter(p => p.id === 'p2')).toHaveLength(1);
        expect(setter).not.toHaveBeenCalled();
    });
    it.each(['failed', 'cancelled'])('tasa %s libera su barrera y restaura una sola vez', async status => {
        localStorage.setItem('bodega_custom_rate', '200');
        localStorage.setItem(SUPERVISOR_RATE_PENDING_KEY, JSON.stringify({ commandId: 'rate-a', previous: { rateMode: 'manual', useAutoRate: 'false', customRate: '100' }, desired: { customRate: '200' } }));
        await mount(); await commands([command('rate-a', status, 'rate_change')]);
        expect(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY)).toBeNull();
        expect(localStorage.getItem('bodega_custom_rate')).toBe('100');
        const count = m.toast.mock.calls.length; await commands([command('rate-a', status, 'rate_change')]); expect(m.toast.mock.calls.length).toBe(count);
    });
    it('rechazo tardío de A no elimina la tasa B y el éxito no borra la barrera antes del eco', async () => {
        localStorage.setItem(SUPERVISOR_RATE_PENDING_KEY, JSON.stringify({ commandId: 'rate-b', desired: { customRate: '300' } }));
        await mount(); await commands([command('rate-a', 'failed', 'rate_change')]);
        expect(JSON.parse(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY)).commandId).toBe('rate-b');
        await commands([command('rate-b', 'applied', 'rate_change')]);
        expect(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY)).not.toBeNull();
        const count = m.toast.mock.calls.length; await commands([command('rate-b', 'applied', 'rate_change')]); expect(m.toast.mock.calls.length).toBe(count);
    });
});
