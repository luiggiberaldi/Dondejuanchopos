import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handler: null, update: vi.fn(), push: vi.fn(), inventory: vi.fn() }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    channel: () => ({
        on(_kind, _filter, handler) { mocks.handler = handler; return this; },
        subscribe() { return this; },
    }),
    removeChannel: vi.fn(async () => undefined),
    from: () => ({ update(fields) { mocks.update(fields); return this; },
        eq: async () => ({ error: null }) }),
} }));
vi.mock('../src/utils/remoteInventoryProcessor', () => ({
    applyInventoryCommand: mocks.inventory, isReappliableCommand: () => false,
}));
vi.mock('../src/hooks/useCloudSync', () => ({ pushCloudSync: mocks.push }));
vi.mock('../src/utils/storageService', () => ({ storageService: { getItem: async () => [] } }));
vi.mock('../src/services/remoteAuditService', () => ({ REMOTE_BACKUP_EXCLUDED_KEYS: [] }));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
import { useSupervisorCommands } from '../src/hooks/useSupervisorCommands';
let root;
let host;
function Harness() { useSupervisorCommands('register-test'); return null; }
async function send(payload, type = 'inventory_update') {
    await act(async () => mocks.handler({ new: {
        id: crypto.randomUUID(), status: 'pending', command_type: type, payload,
    } }));
}
beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    mocks.update.mockReset();
    mocks.push.mockReset().mockResolvedValue(true);
    mocks.inventory.mockReset();
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
describe('Supervisor feature command routing', () => {
    it('accepts the exact legacy envelope already queued in production', async () => {
        await send({ action: 'enable_feature', flag: 'dj_sales_push_merge_v1' });
        expect(localStorage.getItem('dj_sales_push_merge_v1')).toBe('true');
        expect(mocks.inventory).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'applied' }));
        expect(mocks.push).toHaveBeenCalledWith('bodega_sales_v1', [], true);
    });
    it('keeps the typed enable_feature command compatible', async () => {
        await send({ action: 'enable', flag: 'dj_sales_push_merge_v1' }, 'enable_feature');
        expect(localStorage.getItem('dj_sales_push_merge_v1')).toBe('true');
    });
    it.each(['disable', 'clear'])('supports explicit %s without pushing sales', async flagAction => {
        localStorage.setItem('dj_sales_push_merge_v1', 'true');
        await send({ action: 'enable_feature', flag: 'dj_sales_push_merge_v1', flagAction });
        expect(localStorage.getItem('dj_sales_push_merge_v1')).toBe(flagAction === 'clear' ? null : 'false');
        expect(mocks.push).not.toHaveBeenCalled();
    });
    it('rejects arbitrary configuration keys without marking them applied', async () => {
        await send({ action: 'enable_feature', flag: 'dj_device_id' });
        expect(localStorage.getItem('dj_device_id')).toBeNull();
        expect(localStorage.getItem('dj_applied_supervisor_cmds_v1')).toBeNull();
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });
});
