/**
 * GR-3 — Guardarraíl anti-anidación de cerrojos.
 *
 * Regla: ningún archivo que abra `withLock(...)` puede llamar a una FACHADA con cerrojo.
 * Debe usar su variante `...Unlocked`.
 *
 * Por qué existe: `withLock` ya no tiene guard de reentrancia (F1). Una llamada anidada
 * al mismo cerrojo es un auto-deadlock permanente — ni el mutex en memoria ni
 * `navigator.locks` en modo `exclusive` tienen timeout, así que la operación cuelga
 * el POS para siempre.
 *
 * Este arnés se escribió porque la implementación de F1 dejó exactamente ese fallo vivo
 * en `useGastosInternos` (autoconsumo y anulación de gasto), y la suite pasaba en verde.
 *
 * Al añadir una nueva fachada con cerrojo, hay que registrarla en LOCKED_FACADES.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** Fachadas que adquieren `pos_write_lock`. Cada una tiene su gemela `...Unlocked`. */
const LOCKED_FACADES = [
    'recordKardexMovement',
    'seedInitialKardexIfEmpty',
    'createInventorySnapshot',
    'createSessionFromSale',
    'registerPartialDispatch',
    'cancelSessionBySaleId',
    'revertDispatchRound',
];

/**
 * Excepciones justificadas. Debe quedar vacío salvo que exista una razón documentada:
 * un archivo puede abrir `withLock` en una función y llamar a la fachada desde otra
 * que NO está bajo cerrojo. Si añades algo aquí, explica por qué en el comentario.
 */
const ALLOWLIST = [];

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.(js|jsx)$/.test(entry)) out.push(full);
    }
    return out;
}

/** Elimina comentarios de bloque y de línea para no reportar menciones en prosa. */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('GR-3: ninguna fachada con cerrojo se llama dentro de otro withLock', () => {
    it('no hay adquisiciones anidadas de pos_write_lock en src/', () => {
        const violations = [];

        for (const file of walk(SRC)) {
            const rel = relative(process.cwd(), file).replace(/\\/g, '/');
            if (rel.endsWith('src/utils/withLock.js')) continue;
            if (ALLOWLIST.includes(rel)) continue;

            const raw = readFileSync(file, 'utf8');
            if (!raw.includes('withLock(')) continue; // el archivo no abre cerrojos

            const code = stripComments(raw);

            for (const facade of LOCKED_FACADES) {
                // `facade` no seguido de "Unlocked". Se ignora la línea que la DEFINE.
                const re = new RegExp(`\\b${facade}(?!Unlocked)\\b`, 'g');
                for (const line of code.split('\n')) {
                    if (!re.test(line)) { re.lastIndex = 0; continue; }
                    re.lastIndex = 0;
                    if (/(export\s+)?(async\s+)?function\s+\w+/.test(line)) continue; // declaración
                    violations.push(`${rel}: usa la fachada con cerrojo "${facade}" — usar "${facade}Unlocked"`);
                }
            }
        }

        expect(violations, `Anidación de cerrojos detectada (auto-deadlock):\n${violations.join('\n')}`).toEqual([]);
    }, 30000);

    /**
     * La variante `...Unlocked` se crea BAJO DEMANDA, no de forma preventiva: sólo la
     * necesitan las fachadas que alguien invoca desde dentro de un cerrojo, y eso ya lo
     * exige el test anterior. Crearlas "por si acaso" sólo añade código muerto
     * (hoy `seedInitialKardexIfEmpty` y `createInventorySnapshot` no se llaman bajo cerrojo).
     *
     * Lo que sí hay que impedir es que esta lista se pudra: si una fachada se renombra o
     * desaparece, el test anterior dejaría de vigilarla en silencio.
     */
    it('la lista de fachadas registradas sigue existiendo en el código', () => {
        const sources = walk(SRC)
            .filter(f => /kardexService|consumptionSessionService/.test(f))
            .map(f => readFileSync(f, 'utf8'))
            .join('\n');

        const fantasma = LOCKED_FACADES.filter(f => !sources.includes(`export async function ${f}(`));
        expect(fantasma, `Fachadas registradas que ya no existen: ${fantasma.join(', ')}`).toEqual([]);
    });

    it('toda variante Unlocked corresponde a una fachada registrada', () => {
        const sources = walk(SRC)
            .filter(f => /kardexService|consumptionSessionService/.test(f))
            .map(f => readFileSync(f, 'utf8'))
            .join('\n');

        const declaradas = [...sources.matchAll(/export async function (\w+)Unlocked\b/g)].map(m => m[1]);
        const huerfanas = declaradas.filter(d => !LOCKED_FACADES.includes(d));
        expect(huerfanas, `Variantes Unlocked sin fachada registrada: ${huerfanas.join(', ')}`).toEqual([]);
    });
});
