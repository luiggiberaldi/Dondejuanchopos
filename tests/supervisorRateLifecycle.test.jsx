import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ insert: vi.fn(), lookup: vi.fn(), toast: vi.fn(), row: null }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    from: () => ({
        insert: row => { m.row = row; return m.insert(row); },
        select() { return this; }, eq() { return this; }, maybeSingle: () => m.lookup(),
    }),
} }));
vi.mock('../src/components/Toast', () => ({ showToast: m.toast }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: {
    getState: () => ({ usuarioActivo: { id: 'u-test', rol: 'SUPERVISOR' } }),
} }));
import SupervisorRateModal from '../src/components/SupervisorRateModal';
import { SUPERVISOR_RATE_PENDING_KEY } from '../src/utils/supervisorCommandModel';

let root, host;
const close = vi.fn();
async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(createElement(SupervisorRateModal, {
        isOpen: true, onClose: close, primaryDeviceId: 'box-test', rates: { bcv: { price: 200 } },
    })));
}
async function click(text) {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent.includes(text));
    expect(button).toBeTruthy();
    await act(async () => button.click());
}
function pendingB() {
    localStorage.setItem(SUPERVISOR_RATE_PENDING_KEY, JSON.stringify({ commandId: 'rate-b', desired: { customRate: '300' } }));
    localStorage.setItem('bodega_custom_rate', '300');
}
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); localStorage.setItem('dj_device_id', 'monitor-test');
    localStorage.setItem('dj_paired_device_id', 'box-test');
    localStorage.setItem('bodega_rate_mode', 'manual');
    localStorage.setItem('bodega_use_auto_rate', 'false');
    localStorage.setItem('bodega_custom_rate', '100');
    m.row = null; m.toast.mockReset(); close.mockReset();
    m.insert.mockReset().mockResolvedValue({ error: { message: 'respuesta perdida' } });
    m.lookup.mockReset().mockImplementation(async () => ({ data: { ...m.row, status: 'applied' }, error: null }));
});
afterEach(async () => {
    await act(async () => root?.unmount()); root = null; host?.remove();
    vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Formulario de tasa: orden de respuestas y barrera de eco', () => {
    it('conserva la barrera si la consulta de recuperación encuentra el comando aplicado', async () => {
        await mount(); await click('Dólar BCV Oficial'); await click('Aplicar en Caja');
        const pending = JSON.parse(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY));
        expect(pending?.commandId).toBe(m.row.id);
        expect(pending?.desired.rateMode).toBe('bcv');
    });
    it('no elimina la solicitud B creada por un listener al restaurar A', async () => {
        m.lookup.mockImplementation(async () => ({ data: { ...m.row, status: 'failed' }, error: null }));
        await mount(); await click('Dólar BCV Oficial');
        const onUpdate = () => { if (localStorage.getItem('bodega_rate_mode') === 'manual') pendingB(); };
        window.addEventListener('app_storage_update', onUpdate);
        try { await click('Aplicar en Caja'); } finally { window.removeEventListener('app_storage_update', onUpdate); }
        expect(JSON.parse(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY))?.commandId).toBe('rate-b');
        expect(localStorage.getItem('bodega_custom_rate')).toBe('300');
    });
    it('una respuesta tardía de A no restaura valores sobre la solicitud B', async () => {
        m.lookup.mockImplementation(async () => { pendingB(); return { data: { ...m.row, status: 'failed' }, error: null }; });
        await mount(); await click('Dólar BCV Oficial'); await click('Aplicar en Caja');
        expect(JSON.parse(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY))?.commandId).toBe('rate-b');
        expect(localStorage.getItem('bodega_custom_rate')).toBe('300');
    });
    it('si no se puede guardar el recibo, no cambia la tasa ni envía la orden', async () => {
        await mount(); await click('Dólar BCV Oficial');
        const setItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
            if (key === SUPERVISOR_RATE_PENDING_KEY) throw new Error('quota');
            return setItem.call(this, key, value);
        });
        await click('Aplicar en Caja');
        expect(m.insert).not.toHaveBeenCalled();
        expect(localStorage.getItem('bodega_rate_mode')).toBe('manual');
        expect(localStorage.getItem('bodega_custom_rate')).toBe('100');
    });
    it('una lectura vacía tras un timeout no demuestra que la inserción falló', async () => {
        m.lookup.mockResolvedValue({ data: null, error: null });
        await mount(); await click('Dólar BCV Oficial'); await click('Aplicar en Caja');
        expect(JSON.parse(localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY))?.commandId).toBe(m.row.id);
    });
});
