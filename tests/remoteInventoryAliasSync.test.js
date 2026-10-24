// tests/remoteInventoryAliasSync.test.js — Regresión CASO-SYNC-PRECIOS-CERVEZAS-SUPERVISOR-23102026
//
// Fix A corregido: sincronizar alias legacy → canónico SOLO cuando la canónica
// viene ausente en el payload. Copiar el legacy sin esa condición haría que un
// alias obsoleto (boxPriceBsManual viejo) pisara la canónica nueva.
//
// Payloads REALES de supervisor_commands (2026-10-23):
//  - 33fe17c5 (edit, Cerveza retornable Zulia): el formulario arrastró el
//    legacy viejo: { boxPriceBs: 25750 (NUEVO), boxPriceBsManual: 25480 (VIEJO),
//    halfBoxPriceBs: 12880, halfBoxPriceBsManual: 12740 }. La canónica DEBE ganar.
//  - 41b5b9a0 (batch_edit, Cerveza Solera): el asistente solo emitió claves
//    legacy: { boxPriceBsManual: 27230, halfBoxPriceBsManual: 13860 }. Sin el
//    fix, la canónica vieja del producto existente (26950/13020) ganaba en
//    readPositiveMoney y el cambio se aplicaba "applied" sin efecto.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '@testing-library/react';

const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

import { applyInventoryCommand } from '../src/utils/remoteInventoryProcessor';
import { syncLegacyFormatPriceAliases } from '../src/utils/productPriceMigration';
import { storageService } from '../src/utils/storageService';
import MonitorOverlays from '../src/components/Monitor/MonitorOverlays';

const PRODUCTS_KEY = 'bodega_products_v1';

// Estado real en la nube del producto Solera ANTES del comando 41b5b9a0
// (sync_documents, doc bodega_products_v1, device PDA-V2): alias duplicados
// canónico+legacy con el precio viejo.
const solera = {
    id: '56ae1787-0d4a-45bf-9529-eac13c72ddc8',
    name: 'Cerveza Solera pilsen Retornable',
    unit: 'unidad', packagingType: 'suelto',
    priceUsd: 0.862222, priceUsdt: 0.862222,
    priceBsManual: null, priceBsUsdRef: null,
    pricingMode: 'tasa_dia', forceBcv: false,
    sellByBox: true, sellByHalfBox: true, sellByUnit: false,
    boxUnits: 36, halfBoxUnits: 18,
    boxPricingMode: 'bs_fijo', halfBoxPricingMode: 'bs_fijo',
    boxPriceUsd: 27, halfBoxPriceUsd: 14,
    boxPriceBs: 26950, boxPriceBsManual: 26950,
    halfBoxPriceBs: 13020, halfBoxPriceBsManual: 13020,
    stock: 12, lowStockAlert: 5,
    barcode: null, boxBarcode: null, halfBoxBarcode: null,
    updatedAt: '2026-10-14T16:32:22.647Z',
};

// Estado real en la nube del producto Zulia ANTES del comando 33fe17c5.
const zulia = {
    id: 'prod_juancho_1783994743_0',
    name: 'Cerveza retornable Zulia',
    unit: 'unidad', packagingType: 'suelto',
    priceUsd: 0.835556, priceUsdt: 0.835556,
    priceBsManual: null, priceBsUsdRef: null,
    pricingMode: 'tasa_dia', forceBcv: false,
    sellByBox: true, sellByHalfBox: true, sellByUnit: false,
    boxUnits: 36, halfBoxUnits: 18,
    boxPricingMode: 'bs_fijo', halfBoxPricingMode: 'bs_fijo',
    boxPriceUsd: 25, halfBoxPriceUsd: 13,
    boxPriceBs: 25480, boxPriceBsManual: 25480,
    halfBoxPriceBs: 12740, halfBoxPriceBsManual: 12740,
    stock: 58, lowStockAlert: 5,
    barcode: '7591067000865', boxBarcode: '000000000024', halfBoxBarcode: '000000000031',
    updatedAt: '2026-10-10T00:34:13.091Z',
};

// Payload REAL del comando 41b5b9a0 (batch_edit) — items[0].data tal cual.
const itemData41b5b9a0 = {
    boxPriceBsManual: 27230,
    boxPricingMode: 'bs_fijo',
    forceBcv: false,
    halfBoxPriceBsManual: 13860,
    halfBoxPricingMode: 'bs_fijo',
    name: 'Cerveza Solera pilsen Retornable',
    priceBsManual: null,
    priceUsd: 0.862222,
    pricingMode: 'tasa_dia',
};

// Payload REAL del comando 33fe17c5 (edit) — campos de precio/alias tal cual
// (el resto del payload son barcodes/stock/imagen que no afectan al fix).
const editData33fe17c5 = {
    name: 'Cerveza retornable Zulia',
    priceUsd: 0.835556, priceUsdt: 0.835556,
    priceBsManual: null, priceBsUsdRef: null,
    pricingMode: 'tasa_dia', forceBcv: false,
    sellByBox: true, sellByHalfBox: true, sellByUnit: false,
    boxUnits: 36, halfBoxUnits: 18,
    boxPricingMode: 'bs_fijo', halfBoxPricingMode: 'bs_fijo',
    boxPriceUsd: 25, halfBoxPriceUsd: 13,
    boxPriceBs: 25750,        // NUEVO (canónico)
    boxPriceBsManual: 25480,  // VIEJO (legacy arrastrado por el spread del formulario)
    halfBoxPriceBs: 12880,    // NUEVO
    halfBoxPriceBsManual: 12740, // VIEJO
    barcode: '7591067000865', boxBarcode: '000000000024', halfBoxBarcode: '000000000031',
    stock: 58,
    baseUpdatedAt: '2026-10-10T00:34:13.091Z',
};

beforeEach(async () => {
    _memoryStore.clear();
    await storageService.setItem(PRODUCTS_KEY, [solera, zulia]);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('syncLegacyFormatPriceAliases (unit)', () => {
    it('canónica ausente → se completa desde la legacy', () => {
        const out = syncLegacyFormatPriceAliases({ boxPriceBsManual: 27230, halfBoxPriceBsManual: 13860 });
        expect(out.boxPriceBs).toBe(27230);
        expect(out.halfBoxPriceBs).toBe(13860);
    });

    it('canónica presente con otro valor → NO se pisa con el legacy obsoleto', () => {
        const out = syncLegacyFormatPriceAliases({ boxPriceBs: 25750, boxPriceBsManual: 25480 });
        expect(out.boxPriceBs).toBe(25750);
    });

    it('solo canónica → no inventa la legacy', () => {
        const out = syncLegacyFormatPriceAliases({ boxPriceBs: 25750 });
        expect(out).toEqual({ boxPriceBs: 25750 });
    });
});

describe('applyInventoryCommand — Fix A con payloads reales', () => {
    it('41b5b9a0 (batch_edit solo-legacy): el precio NUEVO gana sobre la canónica vieja del producto', async () => {
        const res = await applyInventoryCommand({
            action: 'batch_edit',
            productId: 'batch_update',
            commandId: '41b5b9a0-e754-4c8a-8c77-b7e62115076c',
            supervisorNombre: 'Supervisor',
            supervisorRol: 'SUPERVISOR',
            data: { items: [{ productId: solera.id, data: itemData41b5b9a0 }] },
        });

        expect(res.success).toBe(true);
        const products = await storageService.getItem(PRODUCTS_KEY);
        const updated = products.find(p => p.id === solera.id);

        // Sin el fix: readPositiveMoney(26950 viejo, 27230 nuevo) → 26950.
        expect(updated.boxPriceBs).toBe(27230);
        expect(updated.boxPriceBsManual).toBe(27230);
        expect(updated.halfBoxPriceBs).toBe(13860);
        expect(updated.halfBoxPriceBsManual).toBe(13860);
        // El stock de la caja nunca lo toca un batch de precios.
        expect(updated.stock).toBe(12);
    });

    it('33fe17c5 (edit canónica nueva + legacy viejo): la canónica gana y los alias convergen', async () => {
        const res = await applyInventoryCommand({
            action: 'edit',
            productId: zulia.id,
            commandId: '33fe17c5-e361-4701-a2cf-d0b8df1df062',
            supervisorNombre: 'Supervisor',
            supervisorRol: 'SUPERVISOR',
            data: editData33fe17c5,
        });

        expect(res.success).toBe(true);
        const products = await storageService.getItem(PRODUCTS_KEY);
        const updated = products.find(p => p.id === zulia.id);

        // Un fix que copie legacy→canónico sin condición escribiría 25480 aquí.
        expect(updated.boxPriceBs).toBe(25750);
        expect(updated.boxPriceBsManual).toBe(25750); // alias normalizado al valor resuelto
        expect(updated.halfBoxPriceBs).toBe(12880);
        expect(updated.halfBoxPriceBsManual).toBe(12880);
    });

    it('edit con SOLO claves legacy también aplica el precio nuevo (tolerancia al emisor)', async () => {
        const res = await applyInventoryCommand({
            action: 'edit',
            productId: solera.id,
            data: { name: 'Cerveza Solera pilsen Retornable', priceUsd: 0.862222, boxPriceBsManual: 27230, halfBoxPriceBsManual: 13860 },
        });

        expect(res.success).toBe(true);
        const products = await storageService.getItem(PRODUCTS_KEY);
        const updated = products.find(p => p.id === solera.id);
        expect(updated.boxPriceBs).toBe(27230);
        expect(updated.boxPriceBsManual).toBe(27230);
    });
});

describe('MonitorOverlays — mapping del Asistente de BsCongelado', () => {
    it('emite el par canónico+legacy con el mismo valor en el batch (canónica manda)', async () => {
        let wizardProps = null;
        const captureWizard = (props) => { wizardProps = props; return null; };
        const noop = () => null;
        const uploadPendingChanges = vi.fn();

        render(createElement(MonitorOverlays, {
            BsCongeladoWizardModal: captureWizard,
            BsCongeladoAlertBanner: noop,
            AlertTriangle: noop, Clock: noop, ComboFormModal: noop, Lock: noop,
            RefreshCw: noop, RemoteEmployeeModal: noop, RemoteProductFormModal: noop,
            SaleDetailModal: noop, StockAdjustModal: noop, SupervisorPairingModal: noop,
            SupervisorRateModal: noop, Trash2: noop, UploadCloud: noop, Users: noop,
            UsersManager: noop, X: noop,
            pendingChanges: [], products: [], usuarios: [], cloudPendingCmds: [],
            pendingVoidSaleIds: [], inFlightChanges: [],
            uploadPendingChanges, uploading: false, isConnected: true, isPosOnline: true,
            viewTab: 'inventario',
        }));

        expect(wizardProps?.onSaveProducts).toBeTruthy();

        await wizardProps.onSaveProducts([
            // Caso A: ambas claves presentes con valores distintos → gana la canónica.
            { ...solera, id: 'a', boxPriceBs: 27230, boxPriceBsManual: 26950, halfBoxPriceBs: 13860, halfBoxPriceBsManual: 13020 },
            // Caso B: solo legacy → se materializa en la canónica.
            { ...solera, id: 'b', boxPriceBs: undefined, boxPriceBsManual: 27230, halfBoxPriceBs: undefined, halfBoxPriceBsManual: 13860 },
        ]);

        expect(uploadPendingChanges).toHaveBeenCalledTimes(1);
        const [batch] = uploadPendingChanges.mock.calls[0][0];
        expect(batch.action).toBe('batch_edit');

        const byId = new Map(batch.data.items.map(i => [i.productId, i.data]));
        expect(byId.get('a')).toMatchObject({
            boxPriceBs: 27230, boxPriceBsManual: 27230,
            halfBoxPriceBs: 13860, halfBoxPriceBsManual: 13860,
        });
        expect(byId.get('b')).toMatchObject({
            boxPriceBs: 27230, boxPriceBsManual: 27230,
            halfBoxPriceBs: 13860, halfBoxPriceBsManual: 13860,
        });
    });
});
