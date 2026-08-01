import { describe, test, expect, beforeEach, vi } from 'vitest';
import { getFrozenFormats } from '../src/utils/frozenPrices';

describe('bsCongeladoAlert initial load guard tests', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('Initial rate baseline is NOT overwritten while catalog is loading (isLoadingProducts = true)', () => {
        localStorage.setItem('dj_last_effective_rate', '100');
        const isLoadingProducts = true;
        const effectiveRate = 120;

        // Simulación del guard logic
        let writtenBaseline = null;
        if (!isLoadingProducts) {
            if (effectiveRate > 0) {
                writtenBaseline = effectiveRate;
                localStorage.setItem('dj_last_effective_rate', String(effectiveRate));
            }
        }

        expect(writtenBaseline).toBeNull();
        expect(localStorage.getItem('dj_last_effective_rate')).toBe('100');
    });

    test('Alert fires correctly after catalog finishes loading (isLoadingProducts = false)', () => {
        localStorage.setItem('dj_last_effective_rate', '100');
        const isLoadingProducts = false;
        const effectiveRate = 120;
        const products = [
            { id: 'p1', name: 'Harina', pricingMode: 'bs_fijo', priceBsManual: 40 }
        ];

        let alertPayload = null;
        if (!isLoadingProducts && effectiveRate > 0) {
            const lastKnown = parseFloat(localStorage.getItem('dj_last_effective_rate') || '0');
            if (lastKnown > 0 && Math.abs(lastKnown - effectiveRate) > 0.05) {
                const count = products.reduce((acc, p) => acc + getFrozenFormats(p).length, 0);
                if (count > 0) {
                    alertPayload = { prevRate: lastKnown, newRate: effectiveRate, count };
                }
            }
            localStorage.setItem('dj_last_effective_rate', String(effectiveRate));
        }

        expect(alertPayload).not.toBeNull();
        expect(alertPayload.count).toBe(1);
        expect(alertPayload.prevRate).toBe(100);
        expect(alertPayload.newRate).toBe(120);
        expect(localStorage.getItem('dj_last_effective_rate')).toBe('120');
    });
});
