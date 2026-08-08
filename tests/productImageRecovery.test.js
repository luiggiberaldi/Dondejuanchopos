import { describe, expect, it } from 'vitest';
import { isRecoverableImage, mergeCloudProductImages, mergeMissingProductImages } from '../src/utils/productImageRecovery';

describe('productImageRecovery', () => {
    it('solo completa image y conserva todos los demás campos actuales', () => {
        const current = [{ id: 'p1', name: 'Nuevo nombre', stock: 7 }, { id: 'p2', name: 'Con foto', image: 'https://img/current.webp' }];
        const source = [{ id: 'p1', name: 'Nombre viejo', stock: 99, image: 'data:image/webp;base64,abc' }, { id: 'p2', image: 'https://img/old.webp' }];

        const result = mergeMissingProductImages(current, source);

        expect(result.recovered).toBe(1);
        expect(result.products).toEqual([
            { id: 'p1', name: 'Nuevo nombre', stock: 7, image: 'data:image/webp;base64,abc' },
            { id: 'p2', name: 'Con foto', image: 'https://img/current.webp' },
        ]);
    });

    it('no recupera imágenes de productos que ya no existen ni valores inválidos', () => {
        const result = mergeMissingProductImages(
            [{ id: 'p1', name: 'Actual' }],
            [{ id: 'p1', image: '' }, { id: 'p2', image: 'https://img/orphan.webp' }],
        );

        expect(result.recovered).toBe(0);
        expect(result.products).toEqual([{ id: 'p1', name: 'Actual' }]);
        expect(isRecoverableImage('not-an-image')).toBe(false);
        expect(isRecoverableImage('https://img/ok.webp')).toBe(true);
    });

    it('preserva imagen local solo cuando cloud omitió la propiedad, no cuando la vació explícitamente', () => {
        const local = [{ id: 'p1', image: 'https://img/local.webp' }, { id: 'p2', image: 'https://img/local-2.webp' }];
        const incoming = [{ id: 'p1', name: 'Uno' }, { id: 'p2', name: 'Dos', image: '' }];

        expect(mergeCloudProductImages(incoming, local)).toEqual([
            { id: 'p1', name: 'Uno', image: 'https://img/local.webp' },
            { id: 'p2', name: 'Dos', image: '' },
        ]);
    });
});
