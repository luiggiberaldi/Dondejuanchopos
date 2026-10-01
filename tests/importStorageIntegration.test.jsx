import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), remove: vi.fn(), push: vi.fn(), queue: vi.fn(), api: null, readPromise: null }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: async k => m.db.get(k) ?? null, setItem: (...args) => m.write(...args),
    removeItem: k => m.remove(k), createInstance: () => ({ getItem: async () => null }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ pushCloudSync: m.push, queueCloudSync: m.queue }));
vi.mock('../src/config/backupKeys', () => ({
    IDB_KEYS: ['bodega_customers_v1', 'bodega_products_v1', 'dj_demo_flag_v1'],
    LS_KEYS: ['business_name'], PROTECTED_KEYS: ['dj_demo_flag_v1'],
}));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
import { useDataImportExport } from '../src/hooks/useDataImportExport';
import { storageService } from '../src/utils/storageService';
let root, host, props;
function Harness() {
    const api = useDataImportExport(props);
    useEffect(() => { m.api = api; });
    return null;
}
beforeEach(async () => {
    vi.useFakeTimers(); localStorage.clear(); m.db.clear(); m.queue.mockReset(); m.api = null;
    m.write.mockReset().mockImplementation(async (k, v) => { m.db.set(k, v); });
    m.remove.mockReset().mockImplementation(async k => { m.db.delete(k); });
    m.push.mockReset().mockResolvedValue(true);
    props = { auditLog: vi.fn(), triggerHaptic: vi.fn(), setImportStatus: vi.fn(), setStatusMessage: vi.fn() };
    vi.stubGlobal('FileReader', class {
        readAsText(file) { m.readPromise = this.onload({ target: { result: file.text } }); }
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
async function load(data) {
    await act(async () => {
        m.api.handleFileChange({ target: { value: 'fixture', files: [{ text: JSON.stringify({ data }) }] } });
        await m.readPromise;
    });
}
it('importación selectiva reemplaza sin guardias/eco y conserva identidad y flag protegido ausente del backup', async () => {
    m.db.set('bodega_customers_v1', Array.from({ length: 20 }, (_, id) => ({ id })));
    m.db.set('dj_demo_flag_v1', true);
    localStorage.setItem('bodega_products_v1', '[{"id":"stale"}]');
    localStorage.setItem('dj_device_id', 'local-fixture'); localStorage.setItem('sb-fixture-auth-token', 'fixture');
    localStorage.setItem('business_name', 'Old');
    await load({ idb: { bodega_customers_v1: [{ id: 'one' }] }, ls: { business_name: 'New' } });
    expect(m.db.get('bodega_customers_v1')).toEqual([{ id: 'one' }]);
    expect(localStorage.getItem('bodega_products_v1')).toBeNull();
    expect(m.db.get('dj_demo_flag_v1')).toBe(true);
    expect(localStorage.getItem('dj_device_id')).toBe('local-fixture');
    expect(localStorage.getItem('sb-fixture-auth-token')).toBe('fixture');
    expect(localStorage.getItem('business_name')).toBe('New');
    expect(m.queue).not.toHaveBeenCalled();
    expect(m.push).toHaveBeenCalledWith('bodega_customers_v1', [{ id: 'one' }], true);
    expect(props.setImportStatus).toHaveBeenCalledWith('success');
});
it('una limpieza fallida aborta antes de restaurar, publicar o programar recarga', async () => {
    m.remove.mockRejectedValueOnce(new Error('fixture removal failed'));
    await load({ idb: { bodega_customers_v1: [{ id: 'one' }] } });
    expect(m.write).not.toHaveBeenCalled(); expect(m.push).not.toHaveBeenCalled();
    expect(props.setImportStatus).toHaveBeenCalledWith('error');
    expect(props.setImportStatus).not.toHaveBeenCalledWith('success');
    expect(localStorage.getItem('dj_backup_imported_flag')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});
it('restauración invalida fallback previo para que un flush posterior no reponga datos viejos', async () => {
    m.write.mockRejectedValueOnce(new Error('fixture primary full'));
    await storageService.setItem('bodega_customers_v1', [{ id: 'old' }]);
    await load({ idb: { bodega_customers_v1: [{ id: 'new' }] } });
    expect(await storageService.flushRetries()).toBe(0);
    expect(m.db.get('bodega_customers_v1')).toEqual([{ id: 'new' }]);
    expect(m.queue).not.toHaveBeenCalled();
});
