import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), queue: vi.fn(), reader: null }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: async key => m.db.get(key) ?? null, setItem: (...args) => m.write(...args),
    createInstance: () => ({ getItem: async () => null }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.queue }));
vi.mock('../src/hooks/useSecurity', () => ({ useSecurity: () => ({ deviceId: 'fixture', forceHeartbeat: vi.fn() }) }));
vi.mock('../src/context/ProductContext', () => ({ useProductContext: () => ({}) }));
vi.mock('../src/components/Settings/PaymentMethodsManager', () => ({ default: () => null }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
import SettingsModal from '../src/components/SettingsModal';
import ErrorBoundary from '../src/components/ErrorBoundary';
let root, host;
beforeEach(async () => {
    vi.useFakeTimers(); localStorage.clear(); m.db.clear(); m.queue.mockReset();
    m.write.mockReset().mockImplementation(async (k, v) => m.db.set(k, v));
    vi.stubGlobal('FileReader', class { readAsText(file) { m.reader = this.onload({ target: { result: file.text } }); } });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
async function load(data) {
    await act(async () => root.render(createElement(SettingsModal, { isOpen: true, onClose: vi.fn() })));
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: JSON.stringify({ data }) }] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await m.reader; });
}
it('import v1 overlay mantiene claves ausentes y escribe preferencias en LS, no IDB', async () => {
    m.db.set('bodega_products_v1', [{ id: 'old' }]);
    m.db.set('my_categories_v1', ['retain']);
    localStorage.setItem('business_name', 'Old');
    localStorage.setItem('dj_device_id', 'fixture');
    await load({ bodega_products_v1: '[{"id":"new"}]', business_name: 'New', street_rate_bs: '100' });
    expect(m.db.get('bodega_products_v1')).toEqual([{ id: 'new' }]);
    expect(m.db.get('my_categories_v1')).toEqual(['retain']);
    expect(localStorage.getItem('business_name')).toBe('New');
    expect(localStorage.getItem('street_rate_bs')).toBe('100');
    expect(localStorage.getItem('dj_device_id')).toBe('fixture');
    expect(m.db.has('business_name')).toBe(false);
    expect(m.queue).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Datos restaurados');
});
it('fallo de escritura en overlay no confirma restauración ni programa recarga', async () => {
    m.write.mockRejectedValueOnce(new Error('fixture write failed'));
    await load({ idb: { bodega_products_v1: [{ id: 'new' }] } });
    expect(host.textContent).toContain('Error:');
    expect(host.textContent).not.toContain('Datos restaurados');
    expect(m.queue).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('ErrorBoundary propaga fallo de limpieza hacia estado de error y no recarga', async () => {
    // El mock no implementa removeItem: el fallo del límite E/S debe capturarse.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const boundary = new ErrorBoundary({}); const state = [];
    boundary.setState = update => state.push(update);
    await boundary._handleClearCriticalData();
    expect(state.at(-1)).toMatchObject({ clearing: false });
    expect(state.at(-1).clearMsg).toContain('No se pudo completar');
    expect(vi.getTimerCount()).toBe(0);
});
