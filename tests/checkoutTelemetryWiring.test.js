import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Invariantes de cableado de la telemetría de checkout (perf), siguiendo el
 * patrón fuente-invariante del repo (cf. saleNumberAllocatorWiring.test.js).
 *
 * Garantiza que las 3 fases quedan instrumentadas en el código real:
 *   render → CheckoutModalPOS (click → onConfirmSale)
 *   alloc  → checkoutProcessor (allocateSaleNumber)
 *   tx     → checkoutProcessor (storageService.transaction)
 *   end    → useCheckoutFlow (éxito, aborto y excepción)
 */
const POS = readFileSync(join(__dirname, '..', 'src', 'components', 'Sales', 'CheckoutModalPOS', 'index.jsx'), 'utf8');
const CHECKOUT = readFileSync(join(__dirname, '..', 'src', 'utils', 'checkoutProcessor.js'), 'utf8');
const FLOW = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useCheckoutFlow.js'), 'utf8');
const TELEMETRY = readFileSync(join(__dirname, '..', 'src', 'utils', 'checkoutTelemetry.js'), 'utf8');

describe('CheckoutModalPOS — fase render instrumentada', () => {
    test('el click arranca la medición con el opId de correlación', () => {
        expect(POS).toContain("from '../../../utils/checkoutTelemetry'");
        // El start va pegado a la creación del checkoutOperationId: misma clave en toda la cadena.
        const startIdx = POS.indexOf('checkoutStart(checkoutOperationId)');
        const opIdx = POS.indexOf('const checkoutOperationId = crypto.randomUUID();');
        expect(opIdx).toBeGreaterThan(-1);
        expect(startIdx).toBeGreaterThan(opIdx);
    });
    test('renderDone se marca justo antes de onConfirmSale', () => {
        const doneIdx = POS.indexOf('checkoutRenderDone();');
        const confirmIdx = POS.indexOf('await onConfirmSale(payments, {');
        expect(doneIdx).toBeGreaterThan(-1);
        expect(confirmIdx).toBeGreaterThan(doneIdx);
    });
});

describe('checkoutProcessor — fases alloc y tx instrumentadas', () => {
    test('la fase alloc mide allocateSaleNumber (dentro del lock, antes de la transacción)', () => {
        const lockIdx = CHECKOUT.indexOf("withLock('pos_write_lock'");
        const allocIdx = CHECKOUT.indexOf("checkoutStage('alloc'");
        const txIdx = CHECKOUT.indexOf('checkoutTxBegin();');
        expect(lockIdx).toBeGreaterThan(-1);
        expect(allocIdx).toBeGreaterThan(lockIdx);
        expect(txIdx).toBeGreaterThan(allocIdx);
    });
    test('la medición de alloc envuelve al allocation (no lo reemplaza: call site intacto)', () => {
        expect(CHECKOUT).toContain('allocateSaleNumber(deviceId, { localSales: existingSales })');
        expect(CHECKOUT).toContain("checkoutStage('alloc', performance.now() - t0)");
    });
    test('la fase tx cierra al terminar el lock (checkoutTxEnd tras withLock)', () => {
        const txBeginIdx = CHECKOUT.indexOf('checkoutTxBegin();');
        const txEndIdx = CHECKOUT.indexOf('checkoutTxEnd();');
        expect(txBeginIdx).toBeGreaterThan(-1);
        expect(txEndIdx).toBeGreaterThan(txBeginIdx);
    });
});

describe('useCheckoutFlow — cierre con estado (éxito, aborto, excepción)', () => {
    test('checkoutEnd se invoca en las tres salidas del flujo', () => {
        expect(FLOW).toContain("checkoutEnd({ ok: true, duplicate: result.duplicate === true })");
        expect(FLOW).toContain('checkoutEnd({ ok: false, error: result.error })');
        expect(FLOW).toContain("checkoutEnd({ ok: false, error: err?.message || 'excepción' })");
    });
});

describe('checkoutTelemetry — seguro por construcción', () => {
    test('nunca lanza ni toca red: sin fetch/XMLHttpRequest/sendBeacon', () => {
        expect(TELEMETRY.includes('fetch(')).toBe(false);
        expect(TELEMETRY.includes('XMLHttpRequest')).toBe(false);
        expect(TELEMETRY.includes('sendBeacon')).toBe(false);
    });
    test('los buffers acotan memoria (constante WINDOW_BUFFER_MAX en el código)', () => {
        expect(TELEMETRY).toContain('const WINDOW_BUFFER_MAX = 20;');
    });
});
