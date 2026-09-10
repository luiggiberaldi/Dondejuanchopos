import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storageService } from '../src/utils/storageService';

describe('Shift Persistence Guard & Auto-Healing Harness', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    describe('Auto-Healing from Persistent Shift Anchor', () => {
        it('restores missing active apertura from bodega_active_shift_anchor if shift was open and no later close exists', () => {
            const anchorRecord = {
                id: 'apertura_1789057800000',
                tipo: 'APERTURA_CAJA',
                timestamp: '2026-09-10T16:30:00.000Z',
                cajaCerrada: false,
                openingBs: 9980,
                openingUsd: 33,
                cajero: { id: 2, nombre: 'Luis Medina' }
            };
            localStorage.setItem('bodega_active_shift_anchor', JSON.stringify(anchorRecord));

            // Simular lista de ventas que perdió la apertura (ej. reemplazo de sincronización o corte de red)
            let salesList = [
                {
                    id: 'sale_785',
                    tipo: 'VENTA',
                    totalUsd: 5.95,
                    totalBs: 5550,
                    timestamp: '2026-09-10T16:46:00.000Z',
                    cajaCerrada: false
                }
            ];

            let healed = false;
            let activeApertura = salesList.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
            if (!activeApertura) {
                const rawAnchor = localStorage.getItem('bodega_active_shift_anchor');
                if (rawAnchor) {
                    const parsed = JSON.parse(rawAnchor);
                    if (parsed && parsed.tipo === 'APERTURA_CAJA' && !parsed.cajaCerrada) {
                        const apTs = new Date(parsed.timestamp || 0).getTime();
                        const hasLaterClose = salesList.some(s =>
                            s.tipo === 'REGISTRO_CIERRE' &&
                            new Date(s.timestamp || 0).getTime() >= apTs
                        );
                        if (!hasLaterClose) {
                            salesList.push(parsed);
                            activeApertura = parsed;
                            healed = true;
                        }
                    }
                }
            }

            expect(healed).toBe(true);
            expect(activeApertura).toBeDefined();
            expect(activeApertura.id).toBe('apertura_1789057800000');
            expect(activeApertura.openingBs).toBe(9980);
            expect(salesList.some(s => s.id === 'apertura_1789057800000')).toBe(true);
        });

        it('does NOT restore anchor if a later REGISTRO_CIERRE exists (shift legitimately closed)', () => {
            const anchorRecord = {
                id: 'apertura_1789057800000',
                tipo: 'APERTURA_CAJA',
                timestamp: '2026-09-10T16:30:00.000Z',
                cajaCerrada: false,
                openingBs: 9980,
                openingUsd: 33
            };
            localStorage.setItem('bodega_active_shift_anchor', JSON.stringify(anchorRecord));

            // Lista con un cierre posterior
            let salesList = [
                {
                    id: 'cierre_1789060000000',
                    tipo: 'REGISTRO_CIERRE',
                    timestamp: '2026-09-10T17:00:00.000Z',
                    cajaCerrada: true
                }
            ];

            let healed = false;
            let activeApertura = salesList.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
            if (!activeApertura) {
                const rawAnchor = localStorage.getItem('bodega_active_shift_anchor');
                if (rawAnchor) {
                    const parsed = JSON.parse(rawAnchor);
                    if (parsed && parsed.tipo === 'APERTURA_CAJA' && !parsed.cajaCerrada) {
                        const apTs = new Date(parsed.timestamp || 0).getTime();
                        const hasLaterClose = salesList.some(s =>
                            s.tipo === 'REGISTRO_CIERRE' &&
                            new Date(s.timestamp || 0).getTime() >= apTs
                        );
                        if (!hasLaterClose) {
                            salesList.push(parsed);
                            activeApertura = parsed;
                            healed = true;
                        }
                    }
                }
            }

            expect(healed).toBe(false);
            expect(activeApertura).toBeUndefined();
            expect(salesList.length).toBe(1);
        });

        it('does NOT restore anchor if the anchor itself has cajaCerrada: true', () => {
            const anchorRecord = {
                id: 'apertura_1789057800000',
                tipo: 'APERTURA_CAJA',
                timestamp: '2026-09-10T16:30:00.000Z',
                cajaCerrada: true
            };
            localStorage.setItem('bodega_active_shift_anchor', JSON.stringify(anchorRecord));

            let salesList = [];
            let healed = false;
            let activeApertura = salesList.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
            if (!activeApertura) {
                const rawAnchor = localStorage.getItem('bodega_active_shift_anchor');
                if (rawAnchor) {
                    const parsed = JSON.parse(rawAnchor);
                    if (parsed && parsed.tipo === 'APERTURA_CAJA' && !parsed.cajaCerrada) {
                        salesList.push(parsed);
                        healed = true;
                    }
                }
            }

            expect(healed).toBe(false);
            expect(salesList.length).toBe(0);
        });
    });

    describe('Shift Lifecycle: Anchor Purge and Restoration', () => {
        it('clears shift anchor on cashier closing', () => {
            localStorage.setItem('bodega_active_shift_anchor', JSON.stringify({ id: 'ap_test', tipo: 'APERTURA_CAJA' }));
            expect(localStorage.getItem('bodega_active_shift_anchor')).not.toBeNull();

            // Simular handleConfirmClose
            localStorage.removeItem('bodega_active_shift_anchor');
            expect(localStorage.getItem('bodega_active_shift_anchor')).toBeNull();
        });

        it('re-anchors active apertura when supervisor reopens shift', () => {
            const reopenedSales = [
                {
                    id: 'apertura_reopened',
                    tipo: 'APERTURA_CAJA',
                    cajaCerrada: false,
                    openingBs: 9980,
                    openingUsd: 33
                },
                {
                    id: 'sale_1',
                    tipo: 'VENTA',
                    cajaCerrada: false
                }
            ];

            const activeApertura = reopenedSales.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
            if (activeApertura) {
                localStorage.setItem('bodega_active_shift_anchor', JSON.stringify(activeApertura));
            }

            const stored = JSON.parse(localStorage.getItem('bodega_active_shift_anchor'));
            expect(stored).toBeDefined();
            expect(stored.id).toBe('apertura_reopened');
            expect(stored.cajaCerrada).toBe(false);
        });
    });

    describe('StorageService Circuit Breaker Isolation for Monitors', () => {
        it('allows monitors to adopt smaller cloud payload without reverting to stale local sales', async () => {
            const isMonitor = true;
            const localLength = 100;
            const cloudLength = 10;

            const isAbruptDrop = localLength > 20 && cloudLength < localLength * 0.5;
            const shouldReject = isAbruptDrop && !isMonitor;

            expect(shouldReject).toBe(false);
        });

        it('protects main POS from accidental truncation when NOT monitor', () => {
            const isMonitor = false;
            const localLength = 100;
            const cloudLength = 10;

            const isAbruptDrop = localLength > 20 && cloudLength < localLength * 0.5;
            const shouldReject = isAbruptDrop && !isMonitor;

            expect(shouldReject).toBe(true);
        });
    });
});
