import { describe, expect, it } from 'vitest';
import { shouldApplySyncVersion, isNewerSyncVersion } from '../src/utils/syncVersionGuard';
import { createAsyncKeyQueue } from '../src/utils/asyncKeyQueue';

const oldVersion = '2026-08-07T10:00:00.000Z';
const newVersion = '2026-08-07T10:01:00.000Z';

describe('Supervisor product name sync guard', () => {
    it('acepta la primera versión y rechaza un documento anterior', () => {
        expect(shouldApplySyncVersion(null, oldVersion)).toBe(true);
        expect(shouldApplySyncVersion(oldVersion, newVersion)).toBe(true);
        expect(shouldApplySyncVersion(newVersion, oldVersion)).toBe(false);
    });

    it('permite duplicados idempotentes, pero no timestamps inválidos', () => {
        expect(shouldApplySyncVersion(newVersion, newVersion)).toBe(true);
        expect(shouldApplySyncVersion(newVersion, 'not-a-date')).toBe(false);
        expect(shouldApplySyncVersion(newVersion, null)).toBe(false);
        expect(isNewerSyncVersion(oldVersion, newVersion)).toBe(true);
        expect(isNewerSyncVersion(newVersion, newVersion)).toBe(false);
    });

    it('mantiene la convergencia cuando llega viejo después de nuevo', () => {
        let appliedVersion = null;
        let visibleName = 'Cerveza Solera';

        for (const document of [
            { version: newVersion, name: 'Cerveza Solera Pilsen' },
            { version: oldVersion, name: 'Cerveza Solera' },
        ]) {
            if (shouldApplySyncVersion(appliedVersion, document.version)) {
                appliedVersion = document.version;
                visibleName = document.name;
            }
        }

        expect(appliedVersion).toBe(newVersion);
        expect(visibleName).toBe('Cerveza Solera Pilsen');
    });

    it('serializa publicaciones del mismo catálogo aunque la primera tarde', async () => {
        const enqueue = createAsyncKeyQueue();
        const events = [];
        let releaseOld;
        const oldGate = new Promise(resolve => { releaseOld = resolve; });

        const oldPush = enqueue('bodega_products_v1', async () => {
            events.push('old:start');
            await oldGate;
            events.push('old:end');
        });
        const newPush = enqueue('bodega_products_v1', async () => {
            events.push('new:done');
        });

        await new Promise(resolve => setTimeout(resolve, 0));
        expect(events).toEqual(['old:start']);
        releaseOld();
        await Promise.all([oldPush, newPush]);
        expect(events).toEqual(['old:start', 'old:end', 'new:done']);
    });

    it('no bloquea claves cloud independientes', async () => {
        const enqueue = createAsyncKeyQueue();
        const events = [];
        let releaseProducts;
        const productsGate = new Promise(resolve => { releaseProducts = resolve; });

        const productsPush = enqueue('bodega_products_v1', async () => {
            events.push('products:start');
            await productsGate;
            events.push('products:end');
        });
        const salesPush = enqueue('bodega_sales_v1', async () => {
            events.push('sales:done');
        });

        await salesPush;
        expect(events).toEqual(['products:start', 'sales:done']);
        releaseProducts();
        await productsPush;
    });
});
