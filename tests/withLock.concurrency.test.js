import { describe, it, expect } from 'vitest';
import { withLock } from '../src/utils/withLock';

describe('withLock — Concurrencia y prevención anti-ABBA (F1)', () => {
    it('serializa N secciones críticas concurrentes para N = 2, 10 y 50', async () => {
        for (const N of [2, 10, 50]) {
            const history = [];
            const tasks = Array.from({ length: N }, (_, i) => async () => {
                await withLock('concurrency_test_lock', async () => {
                    history.push(`start_${i}`);
                    await new Promise(r => setTimeout(r, 2));
                    history.push(`end_${i}`);
                });
            });

            await Promise.all(tasks.map(t => t()));

            // Verificar que ninguna sección se solape
            expect(history.length).toBe(N * 2);
            for (let k = 0; k < history.length; k += 2) {
                const startIdx = parseInt(history[k].replace('start_', ''), 10);
                const endIdx = parseInt(history[k + 1].replace('end_', ''), 10);
                expect(startIdx).toBe(endIdx);
            }
        }
    });

    it('reentrancia anidada sobre el mismo cerrojo es bloqueada mientras el cerrojo esté ocupado', async () => {
        let nestedStartedDuringOuter = true;

        await withLock('reentrancy_lock', async () => {
            let nestedStarted = false;
            withLock('reentrancy_lock', async () => {
                nestedStarted = true;
            });

            // Dar ticks de event loop para comprobar que el lock anidado no se cuela
            await new Promise(r => setTimeout(r, 20));
            nestedStartedDuringOuter = nestedStarted;
        });

        expect(nestedStartedDuringOuter).toBe(false);
    });

    it('Anti-ABBA: operaciones paralelas sobre pos_write_lock completan sin interbloqueo', async () => {
        let op1Done = false;
        let op2Done = false;

        const op1 = withLock('pos_write_lock', async () => {
            await new Promise(r => setTimeout(r, 10));
            op1Done = true;
        });

        const op2 = withLock('pos_write_lock', async () => {
            await new Promise(r => setTimeout(r, 10));
            op2Done = true;
        });

        await Promise.all([op1, op2]);
        expect(op1Done).toBe(true);
        expect(op2Done).toBe(true);
    });
});
