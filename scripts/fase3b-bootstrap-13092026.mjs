#!/usr/bin/env node
/**
 * scripts/fase3b-bootstrap-13092026.mjs
 *
 * Bootstrap de FASE 3B (numeración central de ventas) — SOLO LECTURA + verificación
 * end-to-end del allocator, sin insertar NADA en la nube por defecto.
 *
 *  1. Lee el Doc 60 canónico y calcula max(saleNumber) (la línea base del allocator).
 *  2. Verifica la vía de lectura del POS: read_paired_audit_documents con el par
 *     real (requiere pairings/monitor_device_id en .env; informativo si faltan).
 *  3. Empaqueta el saleNumberAllocator REAL (esbuild, import.meta.env desde .env),
 *     lo ejecuta con la línea base local simulada y demuestra:
 *       - vía cloud: asigna max+1 mediante su reclamo + compactación;
 *       - vía fallback: max(local)+1 marcado provisional.
 *  4. Con LIVE=1 inserta de verdad el reclamo de la vía cloud (deja 1 fila
 *     'sale_number_claim' como evidencia — es el diseño; el Monitor puede ocultarlas).
 *
 * Uso:  node scripts/fase3b-bootstrap-13092026.mjs        (dry-run, sin escrituras)
 *       LIVE=1 node scripts/fase3b-bootstrap-13092026.mjs (inserta el reclamo real)
 */
import fs from 'node:fs';

// ── Cargar .env ──
const ENV = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2];
});

const url = ENV.VITE_SUPABASE_URL || ENV.VITE_SUPABASE_CLOUD_URL;
const key = ENV.SUPABASE_SERVICE_KEY || ENV.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('✗ Falta .env (VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY)'); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const LIVE = process.env.LIVE === '1';

// IDs del par canónico (posibles overrides por .env o CLI)
const PRIMARY = process.env.PRIMARY_DEVICE_ID || ENV.PRIMARY_DEVICE_ID || 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const MONITOR = process.env.MONITOR_DEVICE_ID || ENV.MONITOR_DEVICE_ID || null;

console.log('═'.repeat(78));
console.log('FASE 3B — Bootstrap del asignador central de saleNumber');
console.log('═'.repeat(78));

// ── 1. Línea base: Doc 60 ──
const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
if (!r.ok) { console.error('✗ lectura Doc 60:', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
const doc = (await r.json())[0];
const sales = doc.data.payload || [];
const nums = sales.map((s) => Number(s && s.saleNumber)).filter((n) => Number.isFinite(n) && n > 0);
const cloudMax = Math.max(0, ...nums);
const dupCheck = new Map();
for (const n of nums) dupCheck.set(n, (dupCheck.get(n) || 0) + 1);
const dups = [...dupCheck.entries()].filter(([, c]) => c > 1);
console.log(`Doc 60: ${sales.length} registros | max saleNumber = #${cloudMax} | duplicados: ${dups.length}`);
if (dups.length) console.log('  ⚠ duplicados presentes:', dups.slice(0, 10).map(([n, c]) => `#${n}×${c}`).join(', '));

// ── 2. Vía de lectura del POS (RPC con el par real) ──
if (MONITOR) {
    const rpc = await fetch(`${url}/rest/v1/rpc/read_paired_audit_documents`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ p_primary_device_id: PRIMARY, p_monitor_device_id: MONITOR, p_collection: 'sales' }),
    });
    const body = await rpc.text();
    let count = 'n/d';
    try { count = (JSON.parse(body).length); } catch { /* informativo */ }
    console.log(`RPC read_paired_audit_documents (par real): status=${rpc.status} filas=${count}`);
} else {
    console.log('RPC read_paired_audit_documents: OMITIDO (sin MONITOR_DEVICE_ID en .env) — informativo');
}

// ── 3. Empaquetar el allocator REAL y ejecutarlo ──
fs.mkdirSync('scratch', { recursive: true });
const esbuild = (await import('esbuild')).default;
await esbuild.build({
    entryPoints: ['src/utils/saleNumberAllocator.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'scratch/saleNumberAllocator.cjs',
    define: {
        'import.meta.env.DEV': 'false',
        'import.meta.env.PROD': 'true',
        'import.meta.env.MODE': JSON.stringify('production'),
        'import.meta.env': JSON.stringify({ DEV: false, PROD: true, MODE: 'production', VITE_SUPABASE_CLOUD_URL: url, VITE_SUPABASE_CLOUD_KEY: key }),
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    external: ['@supabase/supabase-js'],
});
// Shim de localStorage para Node: resolveMonitorDeviceId (salesPushMerge y allocator)
// lo usan como caché; sin esto, la vía cloud muere antes del primer fetch.
globalThis.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
};

const { allocateSaleNumber, maxSaleNumberOf } = await import('../scratch/saleNumberAllocator.cjs');

// Cliente REST mínimo que replica el encadenamiento usado por el allocator
// (device_pairings.maybeSingle + supervisor_commands.insert/select).
function mkRestClient() {
    const chainable = () => {
        const chain = {
            eq: () => chain, contains: () => chain, gte: () => chain,
            order: () => chain, limit: () => chain,
            then: (res, rej) => chain._exec().then(res, rej),
            catch: (rej) => chain._exec().catch(rej),
        };
        chain._exec = async () => {
            const q = new URLSearchParams({ select: 'payload,created_at' });
            q.set('payload->>action', 'eq.sale_number_claim');
            q.set('primary_device_id', `eq.${PRIMARY}`);
            q.set('command_type', 'eq.inventory_update');
            q.set('status', 'eq.applied');
            q.set('created_at', `gte.${chain._cutoff || new Date(0).toISOString()}`);
            q.set('order', 'created_at.desc');
            const rr = await fetch(`${url}/rest/v1/supervisor_commands?${q}`, { headers: H });
            if (!rr.ok) throw new Error('relectura ' + rr.status);
            const rows = await rr.json();
            return { data: rows.map((x) => ({ payload: x.payload })), error: null };
        };
        return chain;
    };
    return {
        // RPC usado por fetchCloudSalesReference (read_paired_audit_documents).
        rpc: async (name, args) => {
            const rr = await fetch(`${url}/rest/v1/rpc/${name}`, {
                method: 'POST', headers: H,
                body: JSON.stringify(args || {}),
            });
            if (!rr.ok) return { data: null, error: { message: (await rr.text()).slice(0, 160) } };
            return { data: await rr.json(), error: null };
        },
        from(table) {
            if (table === 'device_pairings') {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => {
                                if (MONITOR) return { data: { monitor_device_id: MONITOR }, error: null };
                                // Sin monitor configurado: buscar en device_pairings real
                                const rr = await fetch(`${url}/rest/v1/device_pairings?primary_device_id=eq.${PRIMARY}&select=monitor_device_id`, { headers: H });
                                const rows = await rr.json();
                                return { data: rows[0] || null, error: null };
                            },
                        }),
                    }),
                };
            }
            // supervisor_commands
            return {
                insert: async (row) => {
                    if (!LIVE) return { error: { message: 'LIVE=0 (dry-run): reclamo no insertado' } };
                    const rr = await fetch(`${url}/rest/v1/supervisor_commands`, {
                        method: 'POST', headers: { ...H, Prefer: 'return=representation' },
                        body: JSON.stringify(row),
                    });
                    if (!rr.ok) return { error: { message: (await rr.text()).slice(0, 160) } };
                    return { error: null };
                },
                select: chainable,
            };
        },
    };
}

// No podemos inyectar la URL del cliente al módulo (usa supabaseCloud real) — pero
// sí podemos sustituir globalThis.fetch para enrutar supabase-js → REST probado.
// En su lugar: inyectamos el cliente por parámetro (el allocator lo acepta).
const client = mkRestClient();

console.log('\n─ Prueba A: vía CLOUD (local en cero) ──');
const resCloud = await allocateSaleNumber(PRIMARY, { localSales: [], client, now: new Date().toISOString() });
console.log(`  resultado: #${resCloud.saleNumber} (esperado #${cloudMax + 1}) source=${resCloud.source} provisional=${resCloud.provisional}`);
if (resCloud.source === 'cloud' && resCloud.saleNumber === cloudMax + 1) {
    console.log('  ✓ asignación cloud correcta');
} else if (resCloud.source === 'fallback' && !LIVE) {
    console.log('  ⚠ dry-run: el insert del reclamo se simula fallido → cayó a fallback (COMPORTAMIENTO CORRECTO del modo seguro)');
} else {
    console.log('  ✗ resultado inesperado:', resCloud);
}

console.log('\n─ Prueba B: vía FALLBACK (offline forzado) ──');
const resLocal = await allocateSaleNumber(PRIMARY, {
    localSales: [{ tipo: 'VENTA', saleNumber: cloudMax }, { tipo: 'COBRO_DEUDA', saleNumber: cloudMax - 1 }],
    client: null, // fuerza el camino offline
    now: new Date().toISOString(),
});
console.log(`  resultado: #${resLocal.saleNumber} provisional=${resLocal.provisional} (esperado provisional=${resLocal.provisional === true} y #${cloudMax + 1})`);
if (resLocal.provisional === true && resLocal.saleNumber === cloudMax + 1) {
    console.log('  ✓ fallback offline correcto con guardia monótona');
} else {
    console.log('  ✗ fallback inesperado:', resLocal);
}

console.log('\n─ Prueba C: maxSaleNumberOf respeta COBRO_DEUDA ──');
const m = maxSaleNumberOf([{ tipo: 'VENTA', saleNumber: 5 }, { tipo: 'COBRO_DEUDA', saleNumber: 9 }]);
console.log(m === 9 ? '  ✓ abonos consumen numeración' : `  ✗ obtuvo ${m}, esperado 9`);

console.log(`\n${LIVE ? 'LIVE=1: el reclamo quedó insertado como evidencia (fila sale_number_claim).' : 'Dry-run: no se insertó nada. Repite con LIVE=1 para dejar el reclamo real.'}`);
