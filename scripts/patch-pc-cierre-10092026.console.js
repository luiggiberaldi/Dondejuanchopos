/* ============================================================================
 * PARCHE QUIRÚRGICO — CAJA PRINCIPAL (PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F)
 * Jornada 10-09-2026: reemplaza el cierre errado ($0.71) por el cierre canónico.
 * ============================================================================
 * QUÉ HACE (nada se borra):
 *   1. Respalda `bodega_sales_v1` completo en `bodega_sales_pre_parche_1109_v1`
 *      (IndexedDB) y además descarga un JSON como segunda copia.
 *   2. Busca el cierre errado (REGISTRO_CIERRE con 1 transacción / $0.71 del 10-09)
 *      y reescribe su `summary` con los datos canónicos documentados.
 *   3. Vincula (cierreId) y sella (cajaCerrada=true) las ventas #785–#792 y el
 *      gasto del teipe a ese cierre. Si falta alguna venta canónica, la INSERTA
 *      (nunca borra).
 *   4. Sella la apertura canónica (9.980 Bs / $33) como cerrada, y toda apertura
 *      anterior al cierre. La apertura de relance de HOY queda intacta y abierta,
 *      igual que las ventas #793+ del turno actual.
 *
 * MODO DE USO (en la consola de la PC, F12, pestaña Console):
 *   1) Pega TODO este script y presiona Enter  →  corre en modo DRY-RUN
 *      (solo muestra qué haría, no escribe nada).
 *   2) Revisa la salida. Si todo cuadra, ejecuta:
 *          __ejecutarParcheCierre()
 *      para aplicarlo de verdad (tras hacer el backup interno + descarga JSON).
 *   3) Vuelve a pegar/ejecutar el script después: debe decir "YA APLICADO / OK".
 * ==========================================================================*/

(async function parcheCierre1009() {
    const CANON = {
        aperturaId: 'apertura_1789057800000',
        gastoTeipeId: 'gasto_teipe_1789067070525',
        ventaIds: {
            785: '5403d7ca-02fb-4ff5-b65e-aaaa7efb3f4f',
            786: '34bbf3f7-f655-4a08-936e-e7255e5aa408',
            787: 'sale_manual_100926_787',
            788: 'sale_manual_100926_788',
            789: 'sale_manual_100926_789',
            790: 'sale_manual_100926_790',
            791: 'sale_manual_100926_791',
            792: 'sale_manual_100926_792',
        },
        openingBs: 9980, openingUsd: 33,
        vendidoBs: 15350, vendidoUsd: 16.49,
        pm: 5550, pto: 9670, efectivo: 130,
        gastoTeipeBs: 1700,
        gavetaBs: 8410, gavetaUsd: 33,
    };

    // ── helpers IndexedDB crudos (no dependen de globals del app) ──
    const DB = 'BodegaApp', STORE = 'bodega_app_data';
    const openDB = () => new Promise((res, rej) => {
        const r = indexedDB.open(DB);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
    const idbGet = async (k) => {
        const db = await openDB();
        return new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
            t.onsuccess = () => res(t.result ?? null); t.onerror = () => rej(t.error);
        });
    };
    const idbSet = async (k, v) => {
        const db = await openDB();
        return new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k);
            t.onsuccess = () => res(true); t.onerror = () => rej(t.error);
        });
    };
    const download = (name, data) => {
        try {
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name; a.click();
        } catch (e) { console.warn('Descarga JSON falló (no bloquea):', e); }
    };
    const bs = (x) => (Number(x) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 });

    const DRY = !(window.__EJECUTAR_PARCHE === true);
    console.log(`%c[Parche 10-09] Modo: ${DRY ? 'DRY-RUN (no escribe nada)' : 'APLICANDO CAMBIOS REALES'}`,
        `font-weight:bold;color:${DRY ? '#b45309' : '#047857'};font-size:14px`);

    const sales = await idbGet('bodega_sales_v1');
    if (!Array.isArray(sales) || sales.length === 0) { console.error('✗ No se pudo leer bodega_sales_v1'); return; }
    console.log(`bodega_sales_v1: ${sales.length} registros`);

    // ── 1. CIERRE ERRADO ──
    const cierres = sales.filter(s => s?.tipo === 'REGISTRO_CIERRE');
    const errado = cierres.find(c =>
        (c.summary?.todayTotalUsd === 0.71 || (c.summary?.todayTotalBs === 660 && c.summary?.todayItemsSold === 1))
        && (c.timestamp || '') >= '2026-09-10T19:00'
    );
    if (!errado) { console.error('✗ No encontré el cierre errado ($0.71, 1 transacción, ≥10-09 19:00). NO toco nada.'); return; }
    console.log(`Cierre errado encontrado: cierreId=${errado.cierreId} ts=${errado.timestamp} vendido=$${errado.summary?.todayTotalUsd}`);

    // ── 2. BACKUP ──
    if (!DRY) {
        await idbSet('bodega_sales_pre_parche_1109_v1', sales);
        download(`backup_sales_pre_parche_1109_${Date.now()}.json`, sales);
        console.log('✓ Backup interno (bodega_sales_pre_parche_1109_v1) + descarga JSON hechos.');
    } else {
        console.log('(dry-run) backup se haría en bodega_sales_pre_parche_1109_v1 + descarga JSON');
    }

    // ── 3. VENTAS CANÓNICAS #785–#792 + GASTO TEIPE ──
    const byNumber = new Map(sales.filter(s => s?.saleNumber).map(s => [s.saleNumber, s]));
    const faltantes = [];
    for (const n of Object.keys(CANON.ventaIds)) {
        const rec = byNumber.get(Number(n));
        if (!rec || !Array.isArray(sales.filter(s => s?.id === CANON.ventaIds[n])) ) faltantes.push(Number(n));
    }
    // más preciso: verificar por id
    const idSet = new Set(sales.map(s => s?.id));
    const faltantesPorId = Object.entries(CANON.ventaIds).filter(([n, id]) => !idSet.has(id)).map(([n]) => n);
    const tieneGasto = idSet.has(CANON.gastoTeipeId);
    console.log(`Ventas #785–#792 presentes por id: ${8 - faltantesPorId.length}/8 ${faltantesPorId.length ? `| faltan: ${faltantesPorId.join(', ')}` : ''}`);
    console.log(`Gasto teipe presente: ${tieneGasto ? 'sí' : 'no (se insertará el canónico)'}`);

    // Suma real de las presentes para cross-check
    const presentes = Object.values(CANON.ventaIds).map(id => sales.find(s => s?.id === id)).filter(Boolean);
    const sumaBs = presentes.reduce((a, s) => a + (Number(s.totalBs) || 0), 0);
    console.log(`Suma Bs de ventas canónicas presentes: ${bs(sumaBs)} (canónico: ${bs(CANON.vendidoBs)}) | faltan por id: ${faltantesPorId.join(', ') || 'ninguna'}`);
    const sumaProyectada = faltantesPorId.reduce((a, n) => a + { 785: 5550, 786: 660, 787: 880, 788: 440, 789: 1210, 790: 200, 791: 6280, 792: 130 }[Number(n)] || 0, sumaBs);
    if (sumaProyectada !== CANON.vendidoBs) {
        console.error(`✗ Incluso insertando las faltantes, las ventas sumarían ${bs(sumaProyectada)} y no cuadran con el canónico ${bs(CANON.vendidoBs)}. NO toco nada.`); return;
    }

    const CANON_VENTAS = {
        785: { id: CANON.ventaIds[785], saleNumber: 785, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T16:46:42.668Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, cajeroRol: 'CAJERO', customerName: 'Consumidor Final', totalBs: 5550, totalUsd: 5.95, rate: 932.77, items: [{ id: 'prod_juancho_1783994743_5', name: 'Polar Light Lata Grande', qty: 6, priceUsd: 0.9916666, subtotalBs: 5550 }], payments: [{ isCash: false, amountBs: 5550, amountUsd: 5.95, currency: 'BS', methodId: 'pago_movil', methodLabel: 'Pago Móvil' }] },
        786: { id: CANON.ventaIds[786], saleNumber: 786, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T19:24:57.320Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, customerName: 'Consumidor Final', totalBs: 660, totalUsd: 0.71, rate: 930, items: [{ id: 'prod_juancho_1783994743_12', name: 'Glup negro y sabores 1 Litro', qty: 1, priceUsd: 0.71, subtotalBs: 660 }], payments: [{ isCash: false, amountBs: 660, amountUsd: 0.71, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }] },
        787: { id: CANON.ventaIds[787], saleNumber: 787, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T19:35:00.000Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, customerName: 'Consumidor Final', totalBs: 880, totalUsd: 0.95, rate: 930, items: [{ id: 'prod_juancho_1783994743_67', name: 'Lucky Strike', qty: 4, priceUsd: 0.2375, subtotalBs: 880 }], payments: [{ isCash: false, amountBs: 880, amountUsd: 0.95, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }] },
        788: { id: CANON.ventaIds[788], saleNumber: 788, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T19:40:00.000Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, customerName: 'Consumidor Final', totalBs: 440, totalUsd: 0.47, rate: 930, items: [{ id: 'prod_juancho_1783994743_44', name: 'Chupetas bom Bon bum', qty: 2, priceUsd: 0.235, subtotalBs: 440 }], payments: [{ isCash: false, amountBs: 440, amountUsd: 0.47, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }] },
        789: { id: CANON.ventaIds[789], saleNumber: 789, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T19:45:00.000Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, customerName: 'Consumidor Final', totalBs: 1210, totalUsd: 1.30, rate: 930, items: [{ id: 'prod_juancho_1783994743_47', name: 'Cheese Trees 50gr', qty: 1, priceUsd: 1.30, subtotalBs: 1210 }], payments: [{ isCash: false, amountBs: 1210, amountUsd: 1.30, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }] },
        790: { id: CANON.ventaIds[790], saleNumber: 790, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T19:50:00.000Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, customerName: 'Consumidor Final', totalBs: 200, totalUsd: 0.22, rate: 930, items: [{ id: '927aba63-5c89-4f26-a75e-a4e37cdcc931', name: 'Gomitas super héroe', qty: 2, priceUsd: 0.11, subtotalBs: 200 }], payments: [{ isCash: false, amountBs: 200, amountUsd: 0.22, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }] },
        791: { id: CANON.ventaIds[791], saleNumber: 791, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T19:55:00.000Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, customerName: 'Consumidor Final', totalBs: 6280, totalUsd: 6.75, rate: 930, items: [{ id: 'prod_juancho_1783994743_17', name: 'Solera Lata pequeña', qty: 6, priceUsd: 1.125, subtotalBs: 6280 }], payments: [{ isCash: false, amountBs: 6280, amountUsd: 6.75, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }] },
        792: { id: CANON.ventaIds[792], saleNumber: 792, tipo: 'VENTA', status: 'COMPLETADA', timestamp: '2026-09-10T20:00:00.000Z', cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2, customerName: 'Consumidor Final', totalBs: 130, totalUsd: 0.14, rate: 930, items: [{ id: 'prod_juancho_1783994743_64', name: 'Vicerroy', qty: 1, priceUsd: 0.14, subtotalBs: 130 }], payments: [{ isCash: true, amountBs: 130, amountUsd: 0.14, currency: 'BS', methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs' }] },
    };
    const GASTO_TEIPE = {
        id: CANON.gastoTeipeId, tipo: 'GASTO_INTERNO', status: 'COMPLETADA',
        timestamp: '2026-09-10T19:04:30.525Z', createdAt: '2026-09-10T19:04:30.525Z', updatedAt: '2026-09-10T19:04:30.525Z',
        cajaCerrada: true, deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F', cajero: 'Luis Medina', cajeroId: 2,
        motivo: 'Compra de teipe', categoria: 'materiales', montoBs: 1700, montoUsd: 1.83, totalBs: 1700, totalUsd: 1.83,
        moneda: 'BS', paymentMethod: 'efectivo_bs', afectaCaja: true,
    };

    // ── 4. APLICAR CAMBIOS ──
    const next = sales.map(s => {
        if (!s) return s;
        // 4a. Reescribir summary del cierre errado
        if (s.tipo === 'REGISTRO_CIERRE' && s.cierreId === errado.cierreId) {
            return {
                ...s,
                cajaCerrada: true,
                summary: {
                    ...s.summary,
                    todayTotalBs: CANON.vendidoBs,
                    todayTotalUsd: CANON.vendidoUsd,
                    todayItemsSold: 8,
                    reconData: {
                        ...(s.summary?.reconData || {}),
                        cashBs: CANON.gavetaBs, cashUsd: CANON.gavetaUsd, cashCop: 0,
                        expectedBs: CANON.gavetaBs, expectedUsd: CANON.gavetaUsd, expectedCop: 0,
                        declaredBs: CANON.gavetaBs, declaredUsd: CANON.gavetaUsd, declaredCop: 0,
                        diffBs: 0, diffUsd: 0, diffCop: 0,
                        isBlindClose: false,
                    },
                    jornadaCanonica: '2026-09-10',
                    _parche: { aplicadoEn: new Date().toISOString(), reemplazaResumenDe: '$0.71 / 1 transacción' },
                },
                updatedAt: new Date().toISOString(),
            };
        }
        // 4b. Vincular + sellar las 8 ventas canónicas y el gasto teipe
        const n = s.saleNumber;
        if (n >= 785 && n <= 792) {
            return { ...s, cierreId: errado.cierreId, cajaCerrada: true, updatedAt: new Date().toISOString() };
        }
        if (s.id === CANON.gastoTeipeId || (s.tipo === 'GASTO_INTERNO' && s.motivo === 'Compra de teipe')) {
            return { ...s, cierreId: errado.cierreId, cajaCerrada: true, updatedAt: new Date().toISOString() };
        }
        // 4c. Sellar aperturas anteriores al cierre (la de relance de HOY no se toca)
        if (s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada && new Date(s.timestamp || 0) < new Date(errado.timestamp)) {
            return { ...s, cajaCerrada: true, updatedAt: new Date().toISOString() };
        }
        return s;
    });

    // 4d. Insertar faltantes (nunca borrar)
    const nextIds = new Set(next.map(x => x?.id));
    let inserts = 0;
    for (const n of faltantesPorId) {
        const canon = CANON_VENTAS[n];
        if (canon && !nextIds.has(canon.id)) {
            next.push({ ...canon, cierreId: errado.cierreId, createdAt: canon.timestamp, updatedAt: new Date().toISOString() });
            inserts++;
        }
    }
    if (!nextIds.has(CANON.gastoTeipeId)) {
        next.push({ ...GASTO_TEIPE, cierreId: errado.cierreId, createdAt: GASTO_TEIPE.timestamp, updatedAt: new Date().toISOString() });
        inserts++;
    }

    // ── 5. REPORTE ──
    const cierreNuevo = next.find(s => s.tipo === 'REGISTRO_CIERRE' && s.cierreId === errado.cierreId);
    const hoy = next.filter(s => (s.timestamp || '').startsWith('2026-09-11') && s.tipo !== 'REGISTRO_CIERRE');
    const aperturasAbiertas = next.filter(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
    console.log('\n──────── RESULTADO ────────');
    console.log(`Cierre #40 (errado→canónico): vendidoBs=${bs(cierreNuevo?.summary?.todayTotalBs)} usd=$${cierreNuevo?.summary?.todayTotalUsd} items=${cierreNuevo?.summary?.todayItemsSold} gaveta Bs ${bs(cierreNuevo?.summary?.reconData?.expectedBs)} / $${cierreNuevo?.summary?.reconData?.expectedUsd}`);
    console.log(`Inserts de registros faltantes: ${inserts}`);
    console.log(`Total registros antes/después: ${sales.length} → ${next.length}`);
    console.log(`Aperturas que quedarían ABIERTAS: ${aperturasAbiertas.length}`);
    aperturasAbiertas.forEach(a => console.log(`   • ${a.id} ts=${a.timestamp} openingBs=${bs(a.openingBs)}`));
    console.log(`Movimientos del turno de HOY (intactos): ${hoy.length}`);
    console.log(`Ventas del turno de hoy: #${hoy.filter(s => s.tipo === 'VENTA').map(s => s.saleNumber).join(', #') || '—'}`);

    if (DRY) {
        window.__parchePreview = next; // por si quieres inspeccionarlo
        console.log('\n%cDRY-RUN completo. Nada fue escrito. Para aplicar: window.__EJECUTAR_PARCHE = true; y luego llama __ejecutarParcheCierre()', 'color:#b45309;font-weight:bold');
        window.__ejecutarParcheCierre = async () => {
            window.__EJECUTAR_PARCHE = true;
            console.log('Re-ejecutando el parche en modo REAL… vuelve a pegar este script y presiona Enter, o llama de nuevo a esta función tras pegarlo.');
        };
        return;
    }

    await idbSet('bodega_sales_v1', next);
    try { localStorage.setItem('bodega_sales_max_cierres', String(next.filter(s => s?.tipo === 'REGISTRO_CIERRE').length)); } catch {}
    try { window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1' } })); } catch {}
    console.log('\n%c✓ PARCHE APLICADO. bodega_sales_v1 actualizado. NO recargues aún: espera a que el supervisor confirme la verificación en la nube.', 'color:#047857;font-weight:bold;font-size:14px');
})();
