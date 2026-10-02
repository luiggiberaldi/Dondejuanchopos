import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../src/hooks/useCloudSync.js'), 'utf-8'
);

describe('D1 — el hash de egress solo lo escribe la función que hizo el upload', () => {
    // Funciones que suben documentos a la nube y, tras éxito del RPC, registran
    // su propio hash de egress. Ninguna otra función ni llamador puede hacerlo:
    // marcar como "subido" algo que no se subió deja la clave sin reintento.
    const UPLOADERS = ['pushCloudSyncNow', 'pushSingleSalesDelta'];

    test('toda escritura de localStorage.setItem(hashKey, ...) vive en una función uploader', () => {
        const writes = [...SRC.matchAll(/localStorage\.setItem\(\s*hashKey\s*,/g)];
        expect(writes.length).toBe(UPLOADERS.length);
        for (const w of writes) {
            const before = SRC.slice(0, w.index);
            const spots = UPLOADERS.map((n) => ({ n, i: before.lastIndexOf(`const ${n}`) }));
            const nearest = spots.reduce((a, b) => (b.i > a.i ? b : a));
            expect(nearest.i).toBeGreaterThan(-1);
            // Entre la declaración de la uploader y la escritura no puede haber
            // otra declaración top-level: la escritura pertenece a esa función.
            const between = SRC.slice(nearest.i, w.index);
            expect(between).not.toMatch(/\n(?:export )?const \w+ =/);
        }
    });

    test('esa escritura vive dentro de pushCloudSync', () => {
        const start = SRC.indexOf('const pushCloudSync');
        expect(start).toBeGreaterThan(-1);
        // El final de la función: la siguiente declaracion exportada de nivel superior.
        const end = SRC.indexOf('export const forceSyncAllPOSData', start);
        expect(end).toBeGreaterThan(start);
        const body = SRC.slice(start, end);
        expect(body).toMatch(/localStorage\.setItem\(\s*hashKey\s*,/);
    });

    test('ningun await de subida va seguido de una escritura de hash', () => {
        const lines = SRC.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (!/await\s+(pushCloudSync|pushSingleSalesDelta|pushSalesDeltas|pushPendingSalesDeltas)\(/.test(lines[i])) continue;
            const next = (lines[i + 1] || '') + (lines[i + 2] || '');
            expect(next).not.toMatch(/localStorage\.setItem\(\s*hashKey/);
        }
    });

    test('pushCloudSync devuelve un booleano en todos sus caminos', () => {
        const start = SRC.indexOf('const pushCloudSync');
        const end = SRC.indexOf('export const forceSyncAllPOSData', start);
        const body = SRC.slice(start, end);
        // No debe quedar ningun `return;` desnudo.
        expect(body).not.toMatch(/\breturn\s*;/);
    });

    test('la sincronización exige una sesión Auth vinculada al dispositivo', () => {
        expect(SRC).toMatch(/session\.user\?\.id !== activeDeviceId/);
        expect(SRC).toMatch(/sessionMatchesDevice/);
        expect(SRC).toMatch(/Sincronización pausada/);
    });

    test('forceSyncAllPOSData no reporta éxito si una subida falla', () => {
        expect(SRC).toMatch(/let allSucceeded = true/);
        expect(SRC).toMatch(/if \(allSucceeded\)/);
        expect(SRC).toMatch(/Sincronización POS incompleta/);
    });
});
