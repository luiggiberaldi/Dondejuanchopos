import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn(), handler: null, setItem: vi.fn() }));
vi.mock('../src/utils/storageService', () => ({ storageService: {
    getItem: vi.fn(async key => key === 'bodega_products_v1' ? [{ id: 'fixture-product' }] : null),
    setItem: m.setItem,
} }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { expires_at: 9999999999 } }, error: null })) },
    from: vi.fn(table => table === 'cloud_backups'
        ? { upsert: m.upsert }
        : { update: m.update }),
    channel: vi.fn(() => ({
        on(_event, _filter, handler) { m.handler = handler; return this; },
        subscribe() { return this; },
    })),
    removeChannel: vi.fn(async () => undefined),
} }));
vi.mock('../src/config/backupKeys', () => ({ IDB_KEYS: ['bodega_products_v1'], LS_KEYS: [] }));
vi.mock('../src/utils/compression', () => ({ isCompressionSupported: () => false, compressString: vi.fn(async value => value) }));

import { useAutoBackup } from '../src/hooks/useAutoBackup';

let root;
let host;
const device = 'auto-backup-test';
function Harness() { useAutoBackup(true, false, device); return null; }
async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
}
async function tick(ms) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }

beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    m.upsert.mockReset().mockResolvedValue({ error: { code: '42501', status: 401, message: 'permission denied' } });
    m.update.mockReset().mockReturnValue({
        eq: vi.fn(async () => ({ error: null })),
    });
    m.handler = null;
    m.setItem.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((...args) => console.log('[test captured error]', ...args));
});
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = null; host?.remove();
    vi.restoreAllMocks(); vi.useRealTimers();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('AutoBackup: no reportar éxito sin confirmación', () => {
    it('no persiste hash ni marca la solicitud completada ante 401 y evita ráfagas durante cooldown', async () => {
        await mount();
        await tick(30000);

        expect(m.upsert).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('bodega_last_upload_hash')).toBeNull();
        expect(localStorage.getItem('bodega_last_daily_backup_date')).toBeNull();
        expect(m.setItem).toHaveBeenCalledWith('bodega_autobackup_v1', expect.objectContaining({ version: '2.0' }));

        await tick(4 * 60 * 1000);
        expect(m.upsert).toHaveBeenCalledTimes(1);
    });

    it('una solicitud remota fallida se marca error y nunca completed', async () => {
        await mount();
        expect(m.handler).toBeTypeOf('function');
        await act(async () => m.handler({ new: { status: 'pending' } }));

        expect(m.upsert).toHaveBeenCalledTimes(1);
        expect(m.update).toHaveBeenCalledWith({ status: 'error' });
        expect(localStorage.getItem('bodega_last_upload_hash')).toBeNull();
        expect(m.update.mock.calls.some(([payload]) => payload.status === 'completed')).toBe(false);
    });
});
