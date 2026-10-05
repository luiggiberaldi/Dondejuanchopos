import { describe, test, expect, vi, beforeEach } from 'vitest';

// Módulo real: la telemetría es 100% local (sin red), determinista y segura
// fuera de un checkout activo. jsdom provee window/performance.
import {
    checkoutStart,
    checkoutRenderDone,
    checkoutStage,
    checkoutTxBegin,
    checkoutTxEnd,
    checkoutEnd,
    getCheckoutTimings,
    clearCheckoutTimings,
} from '../src/utils/checkoutTelemetry';

beforeEach(() => {
    clearCheckoutTimings();
    vi.restoreAllMocks();
    // Silencia la salida real de console.time/timeEnd/timeLog (el módulo las emite
    // de verdad; los asserts verifican las llamadas con spies).
    vi.spyOn(console, 'time').mockImplementation(() => {});
    vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
    vi.spyOn(console, 'timeLog').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
});

describe('checkoutTelemetry — flujo completo exitoso', () => {
    test('start → renderDone → alloc → tx → end produce desglose coherente', () => {
        const timeSpy = vi.spyOn(console, 'time').mockImplementation(() => {});
        const timeEndSpy = vi.spyOn(console, 'timeEnd').mockImplementation(() => {});

        checkoutStart('op-1');
        checkoutRenderDone();
        checkoutStage('alloc', 120);
        checkoutTxBegin();
        checkoutTxEnd();
        const entry = checkoutEnd({ ok: true });

        expect(entry.opId).toBe('op-1');
        expect(entry.renderMs).toBeGreaterThanOrEqual(0);
        expect(entry.allocMs).toBe(120);
        expect(entry.txMs).toBeGreaterThanOrEqual(0);
        expect(entry.totalMs).toBeGreaterThanOrEqual(entry.renderMs);
        expect(entry.unattributedMs).toBeGreaterThanOrEqual(0);
        // Nota: la identidad exacta del desglose se verifica aparte (sesión sin
        // inyecciones): con allocMs=120 ficticio la suma supera al total real.
        expect(entry.ok).toBe(true);
        expect(entry.duplicate).toBe(false);
        expect(entry.error).toBeNull();

        // console.time/timeEnd con la MISMA etiqueta (colapsa en DevTools).
        expect(timeSpy).toHaveBeenCalledWith('checkout:op-1');
        expect(timeEndSpy).toHaveBeenCalledWith('checkout:op-1');

        // Quedó en el historial, más nueva primero.
        expect(getCheckoutTimings(1)).toEqual([entry]);
    });

    test('múltiples transacciones locales acumulan en txMs', () => {
        checkoutStart('op-2');
        checkoutTxBegin();
        checkoutTxEnd();
        checkoutTxBegin();
        checkoutTxEnd();
        const entry = checkoutEnd({ ok: true });
        expect(entry.txMs).toBeGreaterThanOrEqual(0);
        // Dos pares begin/end, cada uno midió ≥ 0: acumulado presente, no null.
        expect(entry.txMs).not.toBeNull();
    });
});

describe('checkoutTelemetry — rutas de error y casos borde', () => {
    test('end con error de negocio registra ok:false y el error', () => {
        checkoutStart('op-err');
        const entry = checkoutEnd({ ok: false, error: 'Se requiere cliente para ventas fiadas' });
        expect(entry.ok).toBe(false);
        expect(entry.error).toBe('Se requiere cliente para ventas fiadas');
        expect(entry.allocMs).toBeNull(); // nunca llegó al allocation
    });

    test('etapas y renders fuera de un checkout activo se ignoran sin romper', () => {
        expect(() => {
            checkoutRenderDone();
            checkoutStage('alloc', 5);
            checkoutTxBegin();
            checkoutTxEnd();
            expect(checkoutEnd()).toBeNull();
        }).not.toThrow();
        expect(getCheckoutTimings()).toEqual([]);
    });

    test('doble alloc: gana la primera medición (la etapa no se pisa)', () => {
        checkoutStart('op-3');
        checkoutStage('alloc', 100);
        checkoutStage('alloc', 999);
        const entry = checkoutEnd({ ok: true });
        expect(entry.allocMs).toBe(100);
    });

    test('duplicado (reintento con mismo checkoutOperationId) queda marcado', () => {
        checkoutStart('op-dup');
        const entry = checkoutEnd({ ok: true, duplicate: true });
        expect(entry.duplicate).toBe(true);
        expect(entry.ok).toBe(true);
    });

    test('alloc fuera de presupuesto: la duración negativa se clampéa a 0', () => {
        checkoutStart('op-4');
        checkoutStage('alloc', -50);
        const entry = checkoutEnd({ ok: true });
        expect(entry.allocMs).toBe(0);
    });
});

describe('checkoutTelemetry — desglose exacto con duraciones reales', () => {
    test('sesión sin etapas: unattributed absorbe el total (identidad exacta)', () => {
        checkoutStart('op-real');
        checkoutEnd({ ok: true });
        const e = getCheckoutTimings(1)[0];
        // nulls coaccionan a 0 en la suma → unattributed === total.
        expect((e.renderMs ?? 0) + (e.allocMs ?? 0) + (e.txMs ?? 0) + e.unattributedMs).toBe(e.totalMs);
        expect(e.unattributedMs).toBe(e.totalMs);
    });
});

describe('checkoutTelemetry — buffer y visor de producción', () => {
    test('el buffer acota el historial a 20 ventas (más nuevas primero)', () => {
        for (let i = 0; i < 25; i++) {
            checkoutStart(`op-${i}`);
            checkoutEnd({ ok: true });
        }
        const rows = getCheckoutTimings(50);
        expect(rows).toHaveLength(20);
        expect(rows[0].opId).toBe('op-24'); // la más nueva
        expect(rows[19].opId).toBe('op-5'); // la más vieja retenida
    });

    test('window._checkoutTimings expone el visor y .clear vacía el buffer', () => {
        expect(typeof window._checkoutTimings).toBe('function');
        checkoutStart('op-view');
        checkoutEnd({ ok: true });
        const rows = window._checkoutTimings();
        expect(rows).toHaveLength(1);
        expect(rows[0].opId).toBe('op-view');
        window._checkoutTimings.clear();
        expect(getCheckoutTimings()).toEqual([]);
    });
});
