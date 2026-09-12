import { beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

// Esta integración escribe datos: solo ejecutar contra un servicio de PRUEBAS
// configurado explícitamente. Nunca usar credenciales incrustadas o de producción.
const UPSTASH_URL = process.env.UPSTASH_TEST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_TEST_TOKEN;
const enabled = process.env.RUN_REMOTE_RELAY_TESTS === '1';

async function redis(command, ...args) {
    const res = await fetch(`${UPSTASH_URL}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${UPSTASH_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify([command, ...args]),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

describe.skipIf(!enabled)('Compartir Base de Datos por Código (Relay Test)', () => {
    const testCode = `test-${randomUUID()}`;
    beforeAll(() => {
        if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('Configura UPSTASH_TEST_URL y UPSTASH_TEST_TOKEN para esta integración.');
    });

    it('guarda un paquete de base de datos y genera código con TTL de 24h', async () => {
        const payload = {
            idb: {
                bodega_products_v1: [{ id: 'p1', name: 'Polar Pilsen 355ml', stock: 24, priceUsd: 1.0 }],
                bodega_sales_v1: [{ id: 's1', totalUsd: 5.0, timestamp: new Date().toISOString() }],
                bodega_customers_v1: [{ id: 'c1', name: 'Cliente Frecuente' }]
            },
            ls: {
                business_name: 'Donde Juancho',
                printer_paper_width: '80'
            },
            groups: ['inventory', 'customers', 'sales', 'config'],
            isComplete: true,
            createdAt: new Date().toISOString()
        };

        const setResult = await redis('SET', `inv:${testCode}`, JSON.stringify(payload), 'EX', 86400);
        expect(setResult).toBe('OK');
    });

    it('recupera correctamente el paquete de datos usando el código de 6 dígitos', async () => {
        const raw = await redis('GET', `inv:${testCode}`);
        expect(raw).toBeTruthy();

        const data = JSON.parse(raw);
        expect(data.isComplete).toBe(true);
        expect(data.idb.bodega_products_v1).toHaveLength(1);
        expect(data.idb.bodega_products_v1[0].name).toBe('Polar Pilsen 355ml');
        expect(data.idb.bodega_sales_v1).toHaveLength(1);
        expect(data.ls.business_name).toBe('Donde Juancho');
    });

    it('elimina el código de prueba de forma limpia', async () => {
        const delResult = await redis('DEL', `inv:${testCode}`);
        expect(delResult).toBe(1);

        const afterDel = await redis('GET', `inv:${testCode}`);
        expect(afterDel).toBeNull();
    });
});
