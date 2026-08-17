import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import { storageService } from '../src/utils/storageService';

const PRODUCTS_KEY = 'bodega_products_v1';

const initialProduct = {
    id: 'prod_harina_kaly',
    name: 'HARINA BLANCA KALY 900 GRS',
    priceUsd: 1.4,
    stock: 6,
    pricingMode: 'tasa_dia',
    updatedAt: '2026-08-16T18:00:00.000Z',
    updatedBy: 'supervisor_1',
    updatedByDeviceId: 'PDA-V2-SUPERVISOR-A'
};

describe('Monitor Queue & Conflict Resolution Tests', () => {
    beforeEach(async () => {
        _memoryStore.clear();
        await storageService.setItem(PRODUCTS_KEY, [{ ...initialProduct }]);
    });

    it('permite ediciones sucesivas del mismo supervisor sin falso conflicto de timestamp', async () => {
        // Primera edición: cambiar precio a 1.50
        const firstEdit = await applyInventoryCommand({
            action: 'edit',
            productId: 'prod_harina_kaly',
            data: {
                name: 'HARINA BLANCA KALY 900 GRS',
                priceUsd: 1.5,
                baseUpdatedAt: '2026-08-16T18:00:00.000Z'
            },
            actor: { id: 'supervisor_1', nombre: 'Supervisor A', rol: 'SUPERVISOR' },
            monitor_device_id: 'PDA-V2-SUPERVISOR-A'
        });

        expect(firstEdit.success).toBe(true);

        const productsAfterFirst = await storageService.getItem(PRODUCTS_KEY);
        const prodAfterFirst = productsAfterFirst.find(p => p.id === 'prod_harina_kaly');
        expect(prodAfterFirst.priceUsd).toBe(1.5);
        expect(prodAfterFirst.updatedBy).toBe('supervisor_1');

        // Segunda edición: cambiar a Siempre BCV enviando el timestamp viejo antes de sincronizar
        const secondEdit = await applyInventoryCommand({
            action: 'edit',
            productId: 'prod_harina_kaly',
            data: {
                name: 'HARINA BLANCA KALY 900 GRS',
                priceUsd: 1.5,
                pricingMode: 'bcv',
                forceBcv: true,
                baseUpdatedAt: '2026-08-16T18:00:00.000Z' // timestamp previo al primer cambio
            },
            actor: { id: 'supervisor_1', nombre: 'Supervisor A', rol: 'SUPERVISOR' },
            monitor_device_id: 'PDA-V2-SUPERVISOR-A'
        });

        // Debe ser exitoso porque proviene del mismo supervisor / dispositivo
        expect(secondEdit.success).toBe(true);

        const productsFinal = await storageService.getItem(PRODUCTS_KEY);
        const prodFinal = productsFinal.find(p => p.id === 'prod_harina_kaly');
        expect(prodFinal.pricingMode).toBe('bcv');
        expect(prodFinal.forceBcv).toBe(true);
    });

    it('detecta y rechaza conflicto real si otro supervisor distinto editó el producto en el intermedio', async () => {
        // Supervisor B edita el producto primero a las 18:30
        const editByB = await applyInventoryCommand({
            action: 'edit',
            productId: 'prod_harina_kaly',
            data: {
                name: 'HARINA BLANCA KALY 900 GRS (MODIFICADA)',
                priceUsd: 1.8,
                baseUpdatedAt: '2026-08-16T18:00:00.000Z'
            },
            actor: { id: 'supervisor_2', nombre: 'Supervisor B', rol: 'SUPERVISOR' },
            monitor_device_id: 'PDA-V2-SUPERVISOR-B'
        });
        expect(editByB.success).toBe(true);

        // Ahora Supervisor C intenta sobreescribir con baseUpdatedAt vieja
        const editByC = await applyInventoryCommand({
            action: 'edit',
            productId: 'prod_harina_kaly',
            data: {
                name: 'HARINA BLANCA KALY 900 GRS',
                priceUsd: 1.2,
                baseUpdatedAt: '2026-08-16T18:00:00.000Z'
            },
            actor: { id: 'supervisor_3', nombre: 'Supervisor C', rol: 'SUPERVISOR' },
            monitor_device_id: 'PDA-V2-SUPERVISOR-C'
        });

        // Debe ser rechazado porque proviene de un supervisor distinto con datos desactualizados
        expect(editByC.success).toBe(false);
        expect(editByC.conflictRejection).toBe(true);
        expect(editByC.error).toMatch(/Conflicto/);
    });
});
