import { describe, it, expect } from 'vitest';
import { matchProductSearch, normalizeSearchText } from '../src/utils/searchUtils';

describe('matchProductSearch — Motor de Búsqueda Inteligente', () => {
    const products = [
        {
            id: 'p1',
            name: 'DETODITO GRANDE',
            barcode: '7591206285504',
            category: 'snacks'
        },
        {
            id: 'p2',
            name: 'Cerveza Polar Pilsen 355ml',
            barcode: '7590001002',
            boxBarcode: '17590001002',
            category: 'licores'
        },
        {
            id: 'p3',
            name: 'Jamón Planchado Superior',
            barcode: '7590003004',
            category: 'charcuteria'
        },
        {
            id: 'p4',
            name: 'Harina de Maíz Blanco Pan 1 kg',
            barcode: '7591005006',
            category: 'viveres'
        }
    ];

    it('1. Búsqueda simple de 1 palabra ("detodito")', () => {
        expect(matchProductSearch(products[0], 'detodito')).toBe(true);
        expect(matchProductSearch(products[0], 'DETODITO')).toBe(true);
    });

    it('2. Búsqueda multi-palabra contigua ("detodito grande")', () => {
        expect(matchProductSearch(products[0], 'detodito grande')).toBe(true);
    });

    it('3. Búsqueda multi-palabra NO contigua ("polar 355" → Cerveza Polar Pilsen 355ml)', () => {
        expect(matchProductSearch(products[1], 'polar 355')).toBe(true);
        expect(matchProductSearch(products[1], 'cerveza 355')).toBe(true);
        expect(matchProductSearch(products[1], '355 polar')).toBe(true);
    });

    it('4. Insensibilidad a acentos / diacríticos ("jamon" → Jamón Planchado)', () => {
        expect(matchProductSearch(products[2], 'jamon planchado')).toBe(true);
        expect(matchProductSearch(products[2], 'JAMON')).toBe(true);
    });

    it('5. Búsqueda con palabras intermedias ("harina pan 1kg")', () => {
        expect(matchProductSearch(products[3], 'harina pan 1kg')).toBe(true);
        expect(matchProductSearch(products[3], 'blanco pan')).toBe(true);
    });

    it('6. Coincidencia por código de barras exacto o parcial', () => {
        expect(matchProductSearch(products[0], '7591206285504')).toBe(true);
        expect(matchProductSearch(products[0], '759120')).toBe(true);
        expect(matchProductSearch(products[1], '17590001002')).toBe(true); // boxBarcode
    });

    it('7. Consultas vacías o con espacios solamente devuelven false', () => {
        expect(matchProductSearch(products[0], '')).toBe(false);
        expect(matchProductSearch(products[0], '   ')).toBe(false);
        expect(matchProductSearch(null, 'test')).toBe(false);
    });
});
