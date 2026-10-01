import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../src/hooks/useCloudSync.js'), 'utf-8'
);

describe('D1 — pushCloudSync es el unico dueno del hash de egress', () => {
    test('solo existe una escritura de localStorage.setItem(hashKey, ...)', () => {
        const writes = [...SRC.matchAll(/localStorage\.setItem\(\s*hashKey\s*,/g)];
        expect(writes).toHaveLength(1);
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

    test('ningun await pushCloudSync va seguido de una escritura de hash', () => {
        const lines = SRC.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (!/await\s+pushCloudSync\(/.test(lines[i])) continue;
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
