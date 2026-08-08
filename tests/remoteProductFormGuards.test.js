import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

describe('RemoteProductFormModal — guards estáticos', () => {
    const src = readFileSync('src/components/Monitor/RemoteProductFormModal.jsx', 'utf8');

    it('FA02: tiene guard de tamaño antes de FileReader', () => {
        expect(src).toMatch(/file\.size\s*>/);
    });

    it('FA03: handleSubmit tiene bloque catch', () => {
        const fnMatch = src.match(/const handleSubmit[\s\S]+?^\s{4}\};/m);
        expect(fnMatch).not.toBeNull();
        expect(fnMatch[0]).toMatch(/\}\s*catch\s*\(/);
    });
});
