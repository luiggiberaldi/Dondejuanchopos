import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import MonitorCambiosTab from '../src/components/Monitor/MonitorCambiosTab';

// Regresión «APLICADO EN CAJA EL 31/12/1969» (CASO-SYNC-PRECIOS-CERVEZAS-
// SUPERVISOR-23102026, sección 7.5): comandos con applied_at NULL (claims
// sale_number_claim antiguos, fallbacks de confirmación) se renderizaban con
// new Date(null) → epoch → 31/12/1969. El render debe mostrar «SIN SELLO».
const Icon = () => null;

function baseProps(cmd) {
    return {
        ChevronLeft: Icon, ChevronRight: Icon, Clock: Icon, ShieldCheck: Icon, Trash2: Icon,
        ITEMS_PER_PAGE_CAMBIOS: 10,
        allCloudCmds: [cmd],
        cancelAllCloudCmds: vi.fn(), cancelSingleCloudCmd: vi.fn(), cancellingCmdId: null,
        cloudPendingCmds: [], cmdTabFilter: 'todos', currentPageCambios: 1,
        discardSinglePendingChange: vi.fn(),
        getSupervisorCommandDetails: () => ({
            title: 'Artículo / Configuración',
            actionColor: '',
            actionLabel: 'MODIFICACIÓN DE INVENTARIO',
            details: [],
            author: 'mon_test',
        }),
        isConnected: true, isDuplicateProductIdFailure: () => false,
        pendingChanges: [], products: [], queueInventoryChange: vi.fn(),
        setCmdTabFilter: vi.fn(), setCurrentPageCambios: vi.fn(), setShowDiscardQueueModal: vi.fn(),
        showToast: vi.fn(), triggerHaptic: vi.fn(), triggerRefresh: vi.fn(),
        uploadPendingChanges: vi.fn(), uploading: false,
    };
}

let root, host;
function renderTab(cmd) {
    return act(async () => root.render(createElement(MonitorCambiosTab, baseProps(cmd))));
}

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const CLAIM_CMD = {
    id: 'cmd-1', status: 'applied', command_type: 'inventory_update',
    created_at: '2026-10-24T22:33:00.000Z', applied_at: null,
    payload: { action: 'sale_number_claim', candidate: 150 },
};

it('applied_at NULL no renderiza 31/12/1969: muestra SIN SELLO', async () => {
    await renderTab({ ...CLAIM_CMD });
    const text = host.textContent;
    expect(text).toContain('APLICADO EN CAJA');
    expect(text).toContain('SIN SELLO');
    expect(text).not.toContain('1969');
});

it('applied_at malformado tampoco rompe ni muestra fecha inválida', async () => {
    await renderTab({ ...CLAIM_CMD, applied_at: 'no-es-fecha' });
    expect(host.textContent).toContain('SIN SELLO');
    expect(host.textContent).not.toContain('Invalid Date');
    expect(host.textContent).not.toContain('1969');
});

it('applied_at válido muestra la fecha de aplicación normal', async () => {
    await renderTab({ ...CLAIM_CMD, applied_at: '2026-10-24T22:33:28.805Z' });
    const text = host.textContent;
    expect(text).toContain('APLICADO EN CAJA EL');
    expect(text).not.toContain('SIN SELLO');
    expect(text).not.toContain('1969');
});
