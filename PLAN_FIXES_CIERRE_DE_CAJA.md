# Plan de Fixes — Lógica de Cierre de Caja (Ronda 6)

**Fecha:** 2026-07-26
**Alcance:** el **ciclo completo del turno**, desde la apertura hasta el cierre — apertura ([useCheckoutFlow.js:96-146](src/hooks/useCheckoutFlow.js#L96-L146)), movimientos del turno (ventas, cobros, pagos a proveedor y **gastos internos**), y el cierre en sus tres implementaciones: sistema principal ([DashboardView.jsx:342-424](src/views/DashboardView.jsx#L342-L424)), Cierre Remoto del monitor ([OwnerMonitorView.jsx:648-715](src/views/OwnerMonitorView.jsx#L648-L715)) y el handler `force_daily_close` de la caja ([useSupervisorCommands.js:234-274](src/hooks/useSupervisorCommands.js#L234-L274)).

**Veredicto:** la **apertura está bien hecha** (FIN-026: `withLock`, lectura fresca, validación de montos, y la UI bloquea las ventas sin apertura). El problema está de la apertura en adelante.

Un mismo error se repite en tres formas distintas: **el conjunto de movimientos que alimenta el arqueo no es el conjunto que está en la gaveta.**

1. El turno que cruza medianoche cuenta sólo lo posterior a las 00:00, pero cierra todo el turno.
2. Los gastos internos en efectivo salen de la gaveta pero **nunca se restan** del efectivo esperado.
3. El monitor y la caja calculan ese conjunto con reglas opuestas.

A eso se suma que el Cierre Remoto **no usa el canal de comandos**: escribe directo sobre el documento financiero de la caja, y su resultado es no determinista.

---

## 1. Hallazgos

### Apertura — sin hallazgos

[`handleSaveApertura`](src/hooks/useCheckoutFlow.js#L96-L146) valida montos no negativos, incluye `openingCop` siempre (FIN-026), escribe bajo `withLock` re-leyendo storage fresco, y despacha `sales-updated`. [SalesView.jsx:778](src/views/SalesView.jsx#L778) bloquea toda la pantalla de ventas si no hay apertura, y [useSalesKeyboard.js:25](src/hooks/useSalesKeyboard.js#L25) bloquea también los atajos. Como `todayAperturaData` es `find(APERTURA_CAJA && !cajaCerrada)`, tampoco se puede abrir dos veces. `FinancialEngine` suma el fondo a los buckets de efectivo sin contarlo como ingreso, COP incluido (FIN-002). **Correcto de punta a punta.**

### Del primer movimiento al cierre

| # | Hallazgo | Severidad |
|---|---|---|
| C1 | El cierre marca como cerradas ventas que **no contó** en el resumen: el turno que cruza medianoche pierde toda la facturación anterior a las 00:00 | 🔴 |
| **A1** | **Los gastos internos en efectivo nunca se restan del efectivo esperado** → faltante fantasma en cada arqueo | 🔴 |
| C2 | El Cierre Remoto escribe directo en `sync_documents`, sobrescribiendo `bodega_sales_v1` de la caja con la copia del monitor | 🔴 |
| C3 | Su resultado es no determinista: en el arranque de la caja, el push masivo y el pull inicial corren en paralelo | 🔴 |
| A2 | `GASTO_INTERNO` nunca se marca `cajaCerrada` → el monitor muestra «Caja Abierta» para siempre tras el primer gasto | 🟠 |
| A3 | El monitor y la caja calculan el arqueo con conjuntos **opuestos**: el monitor excluye la apertura e incluye los gastos; la caja hace exactamente lo contrario | 🟠 |
| C4 | El handler correcto `force_daily_close` existe en la caja, pero **nadie lo envía** y la constraint SQL lo prohíbe | 🟠 |
| C5 | Ninguno de los tres cierres re-lee `bodega_sales_v1` bajo `withLock` antes de escribir; `registrarGasto` tampoco | 🟠 |
| C6 | El Cierre Remoto no lleva `reconData`: el `REGISTRO_CIERRE` que genera no es cuadrable contra efectivo físico | 🟡 |
| C7 | `cierreNumber` se calcula desde el estado de React, no desde storage fresco | 🟡 |
| A4 | El cierre no despacha `sales-updated` (la apertura sí): la pestaña Ventas sigue creyendo la caja abierta hasta cambiar de pestaña | 🟡 |

### A1 — Los gastos internos no bajan el efectivo esperado

La cadena del arqueo es ésta, y se rompe en el último eslabón:

```
CierreCajaWizard.jsx:45   expectedUsd = paymentBreakdown['efectivo_usd'] − vueltos
useDashboardMetrics:145   paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(todayCashFlow)
useDashboardMetrics:40    todayCashFlow → sólo VENTA, VENTA_FIADA, VENTA_CASHEA, COBRO_DEUDA, PAGO_PROVEEDOR, APERTURA_CAJA
```

`GASTO_INTERNO` **no está en esa lista**. Y sin embargo `FinancialEngine` sí sabe tratarlo — [FinancialEngine.js:164-166](src/core/FinancialEngine.js#L164-L166):

```js
if (sale.tipo === 'GASTO_INTERNO') {
    if (!sale.afectaCaja) return;   // autoconsumo: no toca la gaveta
    …                               // resta el egreso del bucket de efectivo
```

El código correcto existe y es **inalcanzable**: el filtro de `todayCashFlow` descarta los gastos antes de que lleguen al motor. `registrarGasto` los crea con `afectaCaja: true` y montos negativos ([useGastosInternos.js:36-56](src/hooks/useGastosInternos.js#L36-L56)) — plata que de verdad salió de la gaveta.

Resultado: el cajero saca $40 de la gaveta para pagar el hielo y lo registra correctamente; al cerrar, el sistema espera $40 más de los que hay. **Faltante fantasma por el monto exacto de los gastos, en todos los cierres.** El cajero termina cuadrando de memoria o cargando con una diferencia que no cometió.

### A2 — El monitor nunca vuelve a decir «Caja Cerrada»

Como `GASTO_INTERNO` tampoco está en `validTiposParaCerrar`, ningún cierre le pone `cajaCerrada: true`: queda abierto para siempre. En el monitor, [OwnerMonitorView.jsx:909-915](src/views/OwnerMonitorView.jsx#L909-L915) usa como respaldo «¿hay algo sin cerrar?» cuando no encuentra apertura activa:

```js
const unclosed = sales.filter(s => !s.cajaCerrada && s.status !== 'ANULADA' && s.tipo !== 'REGISTRO_CIERRE');
if (unclosed.length > 0) openTs = sorted[0].timestamp;   // ← el gasto viejo entra aquí
```

Tras el primer gasto interno, el monitor muestra «Caja Abierta desde hace 3d 7h» de forma permanente, aunque la caja esté cerrada. El indicador de estado del turno deja de ser fiable — y es justo el que decide si hace falta un Cierre Remoto.

### A3 — Monitor y caja miden cosas distintas

Los dos calculan «el desglose del turno activo», con reglas contrarias:

| | Apertura | Gastos internos | Acotado por |
|---|---|---|---|
| Caja — `todayCashFlow` | ✅ incluida | ❌ excluidos | **día** (`localDate === today`) |
| Monitor — `activeShiftPaymentBreakdown` ([:1004-1013](src/views/OwnerMonitorView.jsx#L1004-L1013)) | ❌ excluida | ✅ incluidos | **turno** (`>= apertura.timestamp`) |

Cada uno se equivoca en lo contrario del otro, así que las cifras nunca coinciden. El dueño ve un número en el monitor y el cajero otro en la caja, y ninguno de los dos es el correcto. Nótese que el monitor **sí** acota por turno: el criterio bueno ya está escrito, sólo que en el lado que no cierra.

### C1 — El turno que cruza medianoche pierde la facturación

Las métricas están acotadas **por día**, con `localDate === today` ([useDashboardMetrics.js:26-44](src/hooks/useDashboardMetrics.js#L26-L44)):

```js
const todaySales = useMemo(() => salesWithLocalDate.filter(s => {
    ...
    if (s.cajaCerrada === true) return false;
    return s.localDate === today;          // ← acotado por DÍA
}), [salesWithLocalDate, today]);
```

Pero la apertura está acotada **por turno**, deliberadamente y sin filtro de fecha — es lo que permite mantener el turno vivo tras las 12 AM (commit `62aaa77`):

```js
const todayApertura = useMemo(() =>
    salesWithLocalDate.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada), …);
```

Y el marcado del cierre no tiene filtro de fecha **ninguno** ([DashboardView.jsx:402-407](src/views/DashboardView.jsx#L402-L407)):

```js
const updatedSales = sales.map(s => {
    if (!s.cajaCerrada && validTiposParaCerrar.includes(s.tipo || 'VENTA')) {
        return { ...s, cajaCerrada: true, cierreId: currentCierreId };   // ← TODO lo abierto
    }
    return s;
});
```

**El conjunto que se cuenta y el conjunto que se marca no son el mismo.** Turno que abre el sábado a las 6 PM y cierra el domingo a las 2 AM:

| | Contenido |
|---|---|
| Resumen del cierre (`todayTotalUsd`, `paymentBreakdown`, `topProducts`) | sólo domingo 00:00–02:00 |
| Ventas marcadas `cajaCerrada: true, cierreId: N` | **todo** el turno, sábado incluido |
| Apertura usada para el cuadre | la del sábado 6 PM |

La facturación del sábado por la noche —el grueso de la caja— queda atada al cierre #N pero **fuera de sus totales**. El cuadre compara el efectivo físico real contra una fracción de las ventas: faltante enorme y falso. Y como quedan `cajaCerrada: true`, ya **no aparecen en ningún reporte posterior**: el dinero desaparece del sistema de forma irreversible y silenciosa.

### C2 y C3 — El Cierre Remoto se salta el canal de comandos

[OwnerMonitorView.jsx:691-701](src/views/OwnerMonitorView.jsx#L691-L701):

```js
const { error: syncErr } = await supabaseCloud
    .from('sync_documents')
    .upsert({
        device_id: pairedDeviceId,
        collection: 'local',
        doc_id: 'bodega_sales_v1',
        data: { payload: updatedSales },      // ← copia del MONITOR
        updated_at: new Date().toISOString()
    }, { onConflict: 'device_id,collection,doc_id' });
```

`updatedSales` sale del array `sales` que el monitor tiene en memoria, que es lo último que alcanzó a sincronizar. Toda venta hecha en la caja después de esa sincronización **no está en ese array**. Y con el hallazgo C1 de la ronda 4 (el 413 de Realtime descarta los documentos grandes, entre ellos `bodega_sales_v1`), esa copia puede estar arbitrariamente vieja.

Peor: el resultado depende de una carrera. En el arranque de la caja, [useCloudSync.js:322](src/hooks/useCloudSync.js#L322) lanza el push masivo **sin `await`**, y el pull inicial arranca a continuación:

```js
forceSyncAllPOSData(deviceId).catch(() => {});   // push local → nube, NO esperado
…
const { data: docs } = await supabaseCloud.from('sync_documents').select(…);  // pull nube → local
```

Los dos corren a la vez sobre `bodega_sales_v1`. Cara o cruz:

- **Gana el push:** la copia local de la caja pisa la del monitor → el cierre remoto se pierde, sin aviso.
- **Gana el pull:** la copia del monitor pisa la de la caja → **se borran las ventas** que el monitor no había visto.

Además la caja **no** está suscrita por Realtime a `sync_documents` (las únicas suscripciones a esa tabla están en `useMonitorSync`, que sólo corre en el monitor). El cierre remoto no se aplica hasta que la caja **reinicie**, que es justo el momento en que ocurre la carrera.

### C4 — La vía correcta existe y está muerta

[useSupervisorCommands.js:234-274](src/hooks/useSupervisorCommands.js#L234-L274) implementa `force_daily_close` bien: re-lee `bodega_sales_v1` fresco de storage, marca, añade el `REGISTRO_CIERRE`, guarda y publica. Es idempotente (no duplica el registro si el `cierreId` ya existe).

Nadie lo invoca: `grep -rn "force_daily_close" src/` sólo devuelve esa línea. Y no podría invocarse aunque se quisiera, porque la constraint lo rechaza ([supabase_supervisor_commands_setup.sql:34](supabase_supervisor_commands_setup.sql#L34)):

```sql
CHECK (command_type IN ('rate_change', 'inventory_update', 'void_sale', 'user_update'));
```

Ése es el motivo por el que se tomó el atajo del `upsert` directo. Arreglar la constraint desactiva la causa.

---

## 2. Plan de fixeo

Una fase = un commit. Tras cada fase: `npx eslint --no-cache <archivos tocados>`, `npx vitest run`, `npm run build`. Si el código no coincide con las anclas, **detenerse y reportar**.

Reglas vigentes: SEC-002, SEC-009, SEC-010, guarda FIN-022, sin `parseFloat` en código financiero, sin código de migración de datos, no hacer push salvo pedido explícito.

**Orden:** CC1 → CC2 → CC3 → CC4 → CC5 → CC6 → CC7. CC2 es SQL y debe correrse en Supabase **antes** de desplegar CC3.

CC1 es la fase troncal: crea el predicado único del turno y arregla C1, A1, A2 y A3 de una vez, porque los cuatro son el mismo error de alcance.

---

### CC1 🔴 — Un solo predicado: se marca exactamente lo que se cuenta

**Archivos:** nuevo `src/utils/shiftScope.js`, [src/hooks/useDashboardMetrics.js](src/hooks/useDashboardMetrics.js), [src/views/DashboardView.jsx](src/views/DashboardView.jsx), [src/views/OwnerMonitorView.jsx](src/views/OwnerMonitorView.jsx)

El invariante que hoy se rompe: **el conjunto contado, el conjunto marcado y el conjunto que muestra el monitor deben ser el mismo**. La forma de garantizarlo es que los tres salgan de la misma función.

**1.1** Helper compartido, para que lo usen el cierre local, el remoto y el monitor:

```js
// src/utils/shiftScope.js
// El turno NO está acotado por día: puede cruzar la medianoche (ver commit 62aaa77).
// Acotarlo por `localDate === today` hacía que el resumen contara una fracción de
// lo que el cierre marcaba como cerrado, y esa diferencia se perdía para siempre.
//
// GASTO_INTERNO va INCLUIDO: es plata que sale de la gaveta y tiene que bajar el
// efectivo esperado del arqueo. FinancialEngine ya distingue por `afectaCaja`
// (el autoconsumo no toca la gaveta), así que aquí no hay que filtrarlo.
export const TIPOS_CIERRE = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'COBRO_DEUDA', 'PAGO_PROVEEDOR', 'GASTO_INTERNO', 'APERTURA_CAJA'];

/** Apertura que abrió el turno vigente (la única APERTURA_CAJA sin cerrar). */
export function findOpenApertura(sales) {
    return (sales || []).find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada) || null;
}

/**
 * Movimientos del turno abierto: todo lo no cerrado desde la apertura vigente.
 * @returns {{ movements: Array, orphans: Array, apertura: object|null }}
 *   `orphans` son movimientos sin cerrar ANTERIORES a la apertura vigente —
 *   restos de un turno que nunca se cerró. No se arrastran en silencio: se
 *   reportan para que el usuario decida.
 */
export function getOpenShiftMovements(sales) {
    const apertura = findOpenApertura(sales);
    const from = apertura?.timestamp ? new Date(apertura.timestamp).getTime() : null;

    const movements = [];
    const orphans = [];
    for (const s of sales || []) {
        if (s.cajaCerrada === true) continue;
        if (s.status === 'ANULADA') continue;
        if (!TIPOS_CIERRE.includes(s.tipo || 'VENTA')) continue;
        const ts = s.timestamp ? new Date(s.timestamp).getTime() : null;
        if (from !== null && ts !== null && ts < from) orphans.push(s);
        else movements.push(s);
    }
    return { movements, orphans, apertura };
}
```

**1.2** En `useDashboardMetrics`, exponer el conjunto del turno **sin tocar** `todaySales`/`todayCashFlow` — esos alimentan las tarjetas «hoy» del dashboard y ahí «hoy» sí significa hoy:

```js
const shiftScope = useMemo(() => getOpenShiftMovements(sales), [sales]);
const shiftCashFlow = shiftScope.movements;
const shiftSales = useMemo(() =>
    shiftCashFlow.filter(s => ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo || 'VENTA')), [shiftCashFlow]);
const shiftTotalUsd = useMemo(() => sumR(shiftSales.map(s => s.totalUsd || 0)), [shiftSales]);
// … shiftTotalBs, shiftProfit, shiftItemsSold, shiftPaymentBreakdown, shiftTopProducts
```

Devolverlos junto con `shiftOrphans` y `shiftApertura`. Reutilizar `FinancialEngine.calculatePaymentBreakdown(shiftCashFlow)` igual que hoy hace con `todayCashFlow` — el motor financiero no cambia.

**1.3** En `handleConfirmCashRecon`, sustituir **todas** las magnitudes `today*` del `summaryObj` por sus equivalentes `shift*`, y marcar exactamente `shiftCashFlow`:

```js
const closingIds = new Set(shiftCashFlow.map(s => s.id));
const updatedSales = sales.map(s =>
    closingIds.has(s.id) ? { ...s, cajaCerrada: true, cierreId: currentCierreId } : s
);
```

El `Set` de IDs es lo que hace el invariante verificable de un vistazo: se marca la misma lista que se sumó.

`handleDailyClose` (la guarda de «no hay movimientos») pasa a mirar `shiftCashFlow.length`.

**1.4** Huérfanos visibles. Si `shiftOrphans.length > 0`, mostrar un aviso en el modal de cuadre antes de confirmar:

> ⚠️ Hay {n} movimientos de un turno anterior sin cerrar. **No** se incluyen en este cierre. Revísalos en Ventas.

Absorberlos en silencio es lo que hace hoy y es exactamente el bug. Dejarlos abiertos y avisar es la conducta correcta.

**1.5** El monitor usa el mismo helper. En [OwnerMonitorView.jsx:899-903](src/views/OwnerMonitorView.jsx#L899-L903) y [:1004-1014](src/views/OwnerMonitorView.jsx#L1004-L1014), sustituir `activeShiftApertura` por `findOpenApertura(sales)` y el filtro `activeFlow` por `getOpenShiftMovements(sales).movements`. Eso **elimina A3 por construcción**: el monitor deja de excluir la apertura y la caja deja de excluir los gastos, porque ninguno de los dos vuelve a escribir su propio filtro.

Ojo: `activeShiftMetrics` (ventas del turno, líneas 951-995) es otra cosa — mide facturación, no flujo de caja — y debe seguir contando sólo `VENTA/VENTA_FIADA/VENTA_CASHEA`. Filtrar `movements` por esos tres tipos, no reemplazarlo.

**1.6** Arreglar el respaldo de `shiftStatusInfo` ([:909-915](src/views/OwnerMonitorView.jsx#L909-L915)), que hoy declara la caja abierta si existe **cualquier** movimiento sin cerrar. Con A2 corregido en 1.1 los gastos ya se cerrarán de aquí en adelante, pero los que ya están en la base seguirían marcando «Caja Abierta» para siempre. El estado del turno debe salir de la apertura, que es lo que de verdad lo define:

```js
if (!openTs) return { isOpen: false, openTime: null, formattedTime: '', elapsedLabel: 'Caja Cerrada' };
```

es decir, eliminar el bloque de respaldo. Si no hay `APERTURA_CAJA` abierta, la caja está cerrada — punto.

**1.7 Tests** — en `tests/`, un archivo nuevo `shiftScope.test.js`:
- Turno que cruza medianoche: apertura sábado 18:00, ventas sábado 20:00 y domingo 01:00 → `movements` debe contener **las dos**.
- Un `GASTO_INTERNO` con `afectaCaja: true` entra en `movements`, y `calculatePaymentBreakdown` sobre ese conjunto **baja** el bucket `efectivo_bs` por el monto del gasto.
- Un `GASTO_INTERNO` con `afectaCaja: false` (autoconsumo) entra en `movements` —para que se cierre— pero **no** altera ningún bucket.
- Suma de `movements` == conjunto marcado (el invariante de 1.3).
- Una venta con `cajaCerrada: true` nunca entra.
- Una venta anterior a la apertura vigente cae en `orphans`, no en `movements`.
- Sin apertura: todo lo no cerrado entra en `movements` y `orphans` queda vacío.

**Verificación manual:**
1. Abrir caja con Bs 1.000 de fondo, vender Bs 500 en efectivo, registrar un gasto interno de Bs 200 en efectivo y cerrar. El sistema debe esperar **Bs 1.300**, no Bs 1.500.
2. Abrir caja, vender, cambiar la hora del sistema al día siguiente, vender otra vez y cerrar. El resumen debe incluir **las dos** ventas.
3. Tras cerrar, el monitor debe decir «Caja Cerrada» aunque existan gastos internos antiguos.

---

### CC2 🔴 — Permitir `force_daily_close` en la constraint

**Archivo:** [supabase_supervisor_commands_setup.sql:32-34](supabase_supervisor_commands_setup.sql#L32-L34)

```sql
ALTER TABLE public.supervisor_commands DROP CONSTRAINT IF EXISTS supervisor_commands_command_type_check;
ALTER TABLE public.supervisor_commands ADD CONSTRAINT supervisor_commands_command_type_check
    CHECK (command_type IN ('rate_change', 'inventory_update', 'void_sale', 'user_update', 'force_daily_close'));
```

**Correrlo en Supabase antes de desplegar CC3.** Si CC3 llega primero, el monitor recibe un 23514 al insertar y el cierre remoto queda inservible.

Esta fase es SQL puro: sin harness de JS, pero verificar con
`INSERT … command_type = 'force_daily_close'` que la constraint acepta el valor.

---

### CC3 🔴 — El Cierre Remoto pasa por el canal de comandos

**Archivo:** [OwnerMonitorView.jsx:648-715](src/views/OwnerMonitorView.jsx#L648-L715)

Sustituir **todo** el cuerpo de `handleRemoteForceDailyClose`. El monitor deja de calcular `updatedSales` y de tocar `sync_documents`: sólo emite la orden. Quien decide qué se cierra es la caja, sobre datos frescos.

```js
const handleRemoteForceDailyClose = async () => {
    if (!pairedDeviceId || !supabaseCloud) return;
    setClosingRemote(true);
    triggerHaptic?.();
    try {
        const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
        const currentCierreId = Date.now();

        // El monitor NO calcula el cierre: su copia de bodega_sales_v1 puede estar
        // atrasada y sobrescribir el documento financiero de la caja borraría ventas.
        // Envía la orden; la caja re-lee fresco bajo lock y publica el resultado.
        const { error } = await supabaseCloud
            .from('supervisor_commands')
            .insert({
                primary_device_id: pairedDeviceId,
                monitor_device_id: monitorDeviceId,
                command_type: 'force_daily_close',
                payload: {
                    cierreId: currentCierreId,
                    // Cifras de referencia SEGÚN EL MONITOR al emitir la orden.
                    // Sirven para contrastar, no para el registro: manda lo que
                    // calcule la caja.
                    referencia: {
                        totalUsd: activeShiftMetrics.totalUsd,
                        totalBs: activeShiftMetrics.totalBs,
                        count: activeShiftMetrics.count,
                    },
                    cashier: { nombre: activeCashier?.nombre || 'Supervisión Remota', rol: 'SUPERVISOR_REMOTO' },
                    copEnabled,
                    tasaCop,
                },
                status: 'pending'
            });
        if (error) throw error;

        setShowRemoteCloseModal(false);
        showToast('Orden de cierre enviada. Se aplicará en la caja al recibirla.', 'success');
    } catch (err) {
        console.error('[OwnerMonitor] Error al enviar el cierre remoto:', err);
        showToast('No se pudo enviar la orden de cierre', 'error');
    } finally {
        setClosingRemote(false);
    }
};
```

Cambios de comportamiento, todos deseables:

- **Se elimina** el `setSales(updatedSales)` optimista y el salto a la pestaña `cierres`. El cierre aparece cuando la caja lo publica y el monitor lo sincroniza — que es cuando de verdad existe. Mostrar un cierre que quizá nunca se aplique es peor que esperar.
- El toast pasa de «Cierre #N completado exitosamente» (falso: nada se había aplicado en la caja) a «Orden enviada».
- Si la caja está apagada, el comando queda `pending` y se aplica por catch-up al arrancar ([useSupervisorCommands.js:282-297](src/hooks/useSupervisorCommands.js#L282-L297)). Eso hace **innecesaria** una suscripción Realtime de la caja a `sync_documents`: el canal de comandos ya cubre el caso offline, que era el motivo del atajo.
- Con FS4 de la ronda 4 aplicado, un cierre rechazado se ve en el monitor con su motivo.

`activeShiftMetrics` sigue usándose sólo como referencia informativa; no entra en el `REGISTRO_CIERRE`.

**Verificación manual:** con la caja **cerrada**, lanzar el cierre remoto. Debe decir «Orden enviada» y aparecer en «Cambios» como pendiente. Al abrir la caja, debe aplicarse y el cierre aparecer en el monitor con las cifras **de la caja**. Ninguna venta hecha en la caja mientras el monitor estaba desconectado puede desaparecer.

---

### CC4 🟠 — La caja aplica el cierre con lock y con el mismo predicado

**Archivo:** [useSupervisorCommands.js:234-274](src/hooks/useSupervisorCommands.js#L234-L274)

El handler ya re-lee fresco, pero fuera de `withLock`: un checkout concurrente reintroduciría su propia copia del array y perdería el cierre (o al revés). Es el mismo patrón que `checkoutProcessor` y `remoteInventoryProcessor` ya respetan (regla D3).

```js
const { withLock } = await import('../utils/withLock');
const { getOpenShiftMovements } = await import('../utils/shiftScope');

const result = await withLock('pos_write_lock', async () => {
    const sales = await storageService.getItem('bodega_sales_v1', []) || [];
    const targetCierreId = command.payload?.cierreId || Date.now();

    if (sales.some(s => s.cierreId === targetCierreId && s.tipo === 'REGISTRO_CIERRE')) {
        return { updatedSales: sales, alreadyApplied: true };   // idempotencia
    }

    const { movements, orphans } = getOpenShiftMovements(sales);
    if (movements.length === 0) return { empty: true };

    const closingIds = new Set(movements.map(s => s.id));
    const updatedSales = sales.map(s =>
        closingIds.has(s.id) ? { ...s, cajaCerrada: true, cierreId: targetCierreId } : s
    );
    // … construir REGISTRO_CIERRE con los totales calculados sobre `movements`
    updatedSales.push(registroCierre);
    await storageService.setItem('bodega_sales_v1', updatedSales);
    return { updatedSales, orphanCount: orphans.length };
});
```

Fuera del lock: `pushCloudSync`, `updateCommandStatus` y el `dispatchEvent`.

Si `result.empty`, marcar el comando `failed` con «No hay movimientos abiertos para cerrar» en vez de `applied` — con PU7 de la ronda 5, el motivo se ve en el monitor.

Los totales del `REGISTRO_CIERRE` se calculan **en la caja** sobre `movements`, con las mismas funciones que CC1: el resumen remoto y el local dejan de poder discrepar. `command.payload.referencia` se guarda aparte, como dato de contraste.

Si `orphanCount > 0`, incluirlo en el `REGISTRO_CIERRE` para que el monitor lo muestre.

---

### CC5 🟠 — El cierre local también bajo lock

**Archivo:** [DashboardView.jsx:402-414](src/views/DashboardView.jsx#L402-L414)

`handleConfirmCashRecon` construye `updatedSales` a partir del array `sales` del estado de React y lo escribe entero. Cualquier venta registrada entre el render y la confirmación del cuadre se pierde.

Envolver el bloque en `withLock('pos_write_lock')` y **re-leer** `bodega_sales_v1` de storage dentro del lock, calculando ahí el `getOpenShiftMovements`. El `summaryObj` para el PDF puede seguir saliendo del estado de React (es presentación), pero lo que se **escribe** tiene que salir de la lectura fresca.

Aprovechar para mover ahí el `cierreNumber` (C7), que hoy se calcula sobre el estado de React y puede repetir número si el estado va atrasado:

```js
const cierreNumber = freshSales
    .filter(s => s.tipo === 'REGISTRO_CIERRE')
    .reduce((mx, s) => Math.max(mx, s.cierreNumber || 0), 0) + 1;
```

---

### CC6 🟡 — Un cierre remoto sin conteo físico debe decirlo

**Archivos:** [useSupervisorCommands.js](src/hooks/useSupervisorCommands.js), [OwnerMonitorView.jsx](src/views/OwnerMonitorView.jsx)

El cierre local guarda `reconData` (el conteo físico de efectivo). El remoto no puede tenerlo: nadie está contando la gaveta. Hoy el `REGISTRO_CIERRE` remoto simplemente no lo trae, y en la vista de cierres es indistinguible de uno cuadrado.

Marcarlo explícitamente en el registro que crea la caja:

```js
summary: { …, reconData: null, sinCuadreFisico: true }
```

y en la vista de cierres del monitor, un chip junto al número:

> 📵 Sin cuadre físico · cierre remoto

`remoteTriggered: true` ya se guarda; esto lo hace visible. Un cierre remoto es una herramienta de emergencia (la caja quedó abierta y no hay nadie en la tienda), no un sustituto del cuadre, y el reporte debe decirlo.

---

### CC7 🟡 — Consistencia del registro de gastos y del refresco tras cerrar

**Archivos:** [src/hooks/useGastosInternos.js](src/hooks/useGastosInternos.js), [src/views/DashboardView.jsx](src/views/DashboardView.jsx)

**7.1** `registrarGasto` ([useGastosInternos.js:65-67](src/hooks/useGastosInternos.js#L65-L67)) escribe el array completo partiendo del `sales` de React, sin lock:

```js
const updatedSales = [newGasto, ...sales];
await storageService.setItem(SALES_KEY, updatedSales);
```

Una venta concurrente se pierde. `registrarAutoconsumo`, en el mismo archivo, **sí** usa `withLock` con lectura fresca (líneas 86-99): aplicar ahí el mismo patrón. Con A1 corregido, el gasto pasa a afectar el arqueo, así que perderlo o duplicarlo ya no es cosmético.

**7.2** Tras el cierre, [DashboardView.jsx:413-415](src/views/DashboardView.jsx#L413-L415) guarda y actualiza su propio estado, pero no avisa a nadie. La apertura sí lo hace (`window.dispatchEvent(new CustomEvent('sales-updated'))`). Añadir el mismo despacho después del `setItem`, para que la pestaña Ventas vuelva a pedir la apertura sin esperar a un cambio de pestaña.

---

## 3. Decisiones

| ID | Decisión | Motivo |
|---|---|---|
| E1 | El turno, no el día, define el alcance del cierre | La apertura ya era por turno; sólo las métricas estaban por día. La incoherencia entre ambos criterios es el bug C1. |
| E8 | `GASTO_INTERNO` entra en el alcance del turno | Es plata que sale de la gaveta. `FinancialEngine` ya lo trata bien y distingue el autoconsumo por `afectaCaja`; el filtro de `todayCashFlow` era lo único que lo bloqueaba. |
| E9 | Un turno está abierto si y sólo si hay una `APERTURA_CAJA` sin cerrar | El respaldo «hay algo sin cerrar» del monitor confunde datos huérfanos con un turno vivo, y no se recupera nunca. |
| E2 | `todaySales`/`todayCashFlow` **no** se tocan | Alimentan las tarjetas «hoy» del dashboard, donde «hoy» sí significa hoy. Se añade un conjunto `shift*` en paralelo. |
| E3 | Los movimientos huérfanos (anteriores a la apertura vigente) se reportan, no se absorben | Arrastrarlos en silencio a un cierre que no los cuenta es exactamente el bug. Quedan abiertos y el usuario decide. |
| E4 | El monitor emite la orden; la caja calcula el cierre | La copia de `bodega_sales_v1` del monitor puede estar atrasada. La caja es la fuente de verdad, igual que en el inventario remoto (D4). |
| E5 | No se añade suscripción Realtime de la caja a `sync_documents` | El catch-up de `supervisor_commands` ya cubre el caso «caja apagada», que era lo que motivaba el atajo. Suscribirse costaría egreso en cada push propio. |
| E6 | Se elimina la vista optimista del cierre en el monitor | Mostrar un cierre que quizá nunca se aplique es peor que esperar dos segundos a que la caja lo confirme. |
| E7 | Los totales del cierre remoto los calcula la caja; los del monitor viajan como `referencia` | Elimina la posibilidad de que el resumen remoto y el local discrepen, y deja rastro para diagnosticar si discrepan. |

---

## 4. Riesgos

- **CC1 cambia cifras que el usuario ya vio.** Los cierres pasados no se recalculan (sería migración de datos): el cambio aplica de aquí en adelante. Dos efectos visibles desde el primer cierre, ambos correcciones: los totales de un turno nocturno serán **mayores** que antes (antes faltaba lo anterior a medianoche), y el efectivo esperado será **menor** en el monto de los gastos internos (antes no se restaban). Si el negocio venía «cuadrando» con un faltante habitual, ese faltante debería desaparecer — conviene avisarlo para que no se lea como un error nuevo.
- **Los gastos internos ya registrados quedan abiertos.** CC1 los cierra de aquí en adelante, pero los anteriores siguen con `cajaCerrada: false`. No afectan el arqueo (los cierres viejos ya pasaron) y CC1.6 impide que sigan falseando el estado del turno en el monitor. Cerrarlos retroactivamente sería migración de datos: **fuera de alcance**.
- **Los movimientos ya perdidos no se recuperan.** Las ventas marcadas `cajaCerrada: true` por cierres anteriores fuera de rango siguen fuera de todo reporte. Recuperarlas exigiría reabrirlas por `cierreId`, que es manipulación de datos financieros históricos: **fuera de alcance**, y decisión del usuario si la quiere.
- **CC2 antes que CC3, sin excepción.** Si el orden se invierte, el monitor recibe 23514 al insertar y el cierre remoto queda inservible hasta correr el SQL.
- **CC4/CC5 introducen `withLock` en el camino de cierre.** Si un lock quedara colgado, el cierre se bloquearía en vez de corromper datos — modo de fallo preferible, pero conviene confirmar que `withLock` tiene timeout.
- La ronda 4 (FS1, el 413 de Realtime) **no es requisito** de este plan, pero sí lo refuerza: mientras `bodega_sales_v1` se caiga del Realtime, la copia del monitor seguirá siendo poco fiable. Con CC3 eso ya no puede destruir datos, sólo desactualizar la vista.
- Ninguna fase toca la guarda FIN-022, `parseFloat` ni los métodos de pago COP.

## 5. Si algo no encaja

Si al abrir un archivo el código no coincide con las anclas — por ejemplo si `handleRemoteForceDailyClose` ya inserta en `supervisor_commands`, o si `useDashboardMetrics` ya expone un conjunto por turno — **detenerse y reportar la diferencia** antes de editar. Este plan describe el árbol de trabajo sobre `41d9c42`.
