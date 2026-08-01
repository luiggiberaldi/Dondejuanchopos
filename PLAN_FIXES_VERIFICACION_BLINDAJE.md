# Plan de Fixes — Verificación de `PLAN_FIXES_BS_CONGELADO_Y_BLINDAJE.md`

Origen: revisión de los 8 commits `cb3050d`..`14d2046` que implementaron el plan anterior.
El resultado global fue bueno — este documento sólo cubre lo que quedó pendiente o mal.

## 0. Estado verificado del árbol (medido, no asumido)

| Comprobación | Resultado |
|---|---|
| A/B vitest `8ee624d` vs `main` | **0 fallos nuevos, 2 tests arreglados** (los dos D4 de `remoteInventory.test.js`) |
| A/B ESLint `--no-cache src tests` | **88 errores antes, 88 después**, perfil idéntico por regla: 79 `no-restricted-syntax`, 4 `no-undef`, 4 `react-hooks/preserve-manual-memoization`, 1 `no-extra-boolean-cast` |
| `npm run build` | ✓ 56.56 s, PWA generada |
| Tests nuevos/afectados (8 archivos) | 42/42 pasan |
| Archivos de test del plan | Los 5 existen (`commandStatus`, `frozenPrices`, `storageGuard`, `bsCongeladoAlert`, `cloudSyncFlush`) + `commit8ee624d.regression` |

Los 88 errores de ESLint son **preexistentes** y no son objetivo de este plan.

### Fases que quedaron correctas (no tocar)

- **F1** SQL DROP+ADD, `commandStatus.js`, throw en DEV, `applied_at` para ambos status, sin reintento en 23514/23503/22P02.
- **F2** `frozenPrices.js` con `sellByBox` / `p.sellByBox && p.sellByHalfBox`, cero `hasBox` residual en `src/`.
- **F3** `Math.max`, snapshot por tiempo, nunca al encoger, caducidad de 60 s del flag, `try/finally`.
- **F4** guarda `isLoadingProducts` + dependencia.
- **F6** `pricingModes.js`, modos fantasma eliminados, D4 restaurado resolviendo `'inherit'`.
- **F7** `Map` O(N+M) con la misma semántica de clave (`===`); el `products.map(p => byId.get(p.id) || p)` final preserva orden y longitud.
- **F8** el invariante 1 lee el SQL real y compara el `CHECK` de `status` 1-a-1 contra `VALID_COMMAND_STATUSES`: un desfase futuro entre BD y JS rompe el arnés.

---

## 1. Hallazgos

| # | Sev | Qué |
|---|---|---|
| V1 | 🔴 | `visibilitychange` registrado en `window`: el flush móvil nunca corre |
| V2 | 🟠 | `unmarkApplied` no discrimina por acción → `adjust_stock` con `delta` puede duplicarse |
| V3 | 🟡 | El punto 4.3 del plan anterior se omitió: recorrido O(n) del catálogo en cada venta |
| V4 | 🟢 | El guarda-raíl de `hasBox` es `warn`, no `error`: no bloquea nada |

---

## 2. Protocolo

Igual que el plan anterior, y es vinculante:

1. Localizar el código por **anclas de texto**, nunca por número de línea.
2. **Una fase a la vez**, un commit por fase.
3. Arnés por fase: `npx eslint --no-cache <archivos tocados>` → `npx vitest run <tests de la fase>` → al cerrar, `npm run build`.
4. Antes de dar una fase por buena, comparar contra la línea base de arriba: **88 errores de ESLint y los 10 fallos preexistentes de vitest** (`checkoutBsManual` ×1, `financialEngine` ×3, `hooks` ×2, `shiftScope` ×2, `withLock` ×2). Cualquier número distinto es una regresión.
5. **DETENTE** si el código no coincide con lo que este documento describe: reportar, no improvisar.

Restricciones que siguen vigentes: no tocar la guarda FIN-022; no borrar los métodos de pago COP de fábrica (`efectivo_cop`, `transferencia_cop`), sólo ocultarlos con `copEnabled=false`; **nada de código de migración de datos**; SEC-002, SEC-009, SEC-010; `parseFloat` prohibido en código financiero.

---

## 3. Fases

### H1 🔴 — El flush diferido nunca se dispara en móvil

**Dónde:** [useSupervisorCommands.js:494-511](src/hooks/useSupervisorCommands.js#L494-L511), ancla `const handleVisibility = () => {`.

**Qué pasa.** El evento `visibilitychange` se emite en `document` y **no burbujea** hasta `window`. El handler registrado en `window` no corre nunca. Es justo el camino que importa: cuando el cajero manda la app a segundo plano, el debounce de 400 ms de `scheduleCloudProductsSync` queda colgado y el push a la nube no sale. Todo el propósito de F5 se pierde en el escenario para el que se escribió.

Queda sólo `beforeunload`, que en móvil muchas veces ni se dispara. El resto del repo ya lo hace bien — [useAutoLock.js:140](src/hooks/useAutoLock.js#L140), [useMonitorSync.js:291](src/hooks/useMonitorSync.js#L291) y [useSalesData.js:127](src/hooks/useSalesData.js#L127) usan `document.addEventListener`. Éste es el único `window.addEventListener('visibilitychange')` del código.

**Cambio:**

```js
document.addEventListener('visibilitychange', handleVisibility);
window.addEventListener('pagehide', handleUnload);
window.addEventListener('beforeunload', handleUnload);
```

y simétrico en el cleanup (`document.removeEventListener` para el primero). Se añade `pagehide` porque en Safari iOS es el único de los tres que se emite de forma fiable al cerrar la pestaña.

**Lo que este fix NO resuelve, y hay que dejar escrito en el comentario.** `flushCloudProductsSync` es `async` y hace `await import(...)` antes del push; durante un `beforeunload`/`pagehide` real el navegador no garantiza que la cadena termine. La ruta que sí funciona es `visibilitychange → hidden`, que se emite **antes** de que la app se congele y deja tiempo de completar. `beforeunload` y `pagehide` quedan como best-effort, no como garantía. No se introduce `sendBeacon`: `pushCloudSync` no es un POST plano y reimplementarlo para el unload sería una segunda ruta de escritura a la nube — exactamente el tipo de duplicación que causó B1/B2.

**Test** (extender `tests/cloudSyncFlush.test.js`): assert estático sobre el fuente, mismo patrón que el invariante 1 de F8.

```js
const src = fs.readFileSync(path.resolve(__dirname, '../src/hooks/useSupervisorCommands.js'), 'utf-8');
expect(src).toMatch(/document\.addEventListener\(\s*['"]visibilitychange/);
expect(src).not.toMatch(/window\.addEventListener\(\s*['"]visibilitychange/);
```

Un test de comportamiento requeriría montar el hook con Supabase mockeado; el assert de fuente cubre la regresión concreta (el target del listener) a coste cero, que es lo que falló aquí.

---

### H2 🟠 — `unmarkApplied` puede duplicar un ajuste de stock

**Dónde:** [useSupervisorCommands.js:162-170](src/hooks/useSupervisorCommands.js#L162-L170), ancla `unmarkApplied(command.id);`.

**Qué pasa.** Cuando no se puede escribir el status, se desmarca el comando para que el catch-up lo reintente. El catch-up selecciona por `.eq('status', 'pending')` ([useSupervisorCommands.js:447](src/hooks/useSupervisorCommands.js#L447)) y, si la escritura falló, el status **sigue** en `pending` — así que el comando se vuelve a aplicar. Correcto para `batch_edit`, que reescribe los mismos valores. Pero el desmarcado no mira la acción, y `adjust_stock` con `delta` es aditivo:

```js
next = allowNeg ? current + delta : Math.max(0, current + delta);   // remoteInventoryProcessor.js
```

Un `+5` que falle al marcar se convierte en `+10`, con su segundo movimiento de Kardex. La cabecera del propio archivo ya advierte que los deltas de stock corromperían datos. G3 del plan anterior pedía excluir los handlers no idempotentes o dejarlo escrito; no se hizo ninguna de las dos.

**Qué acciones son re-aplicables de verdad** (revisado handler por handler en `remoteInventoryProcessor.js`):

| Acción | ¿Re-aplicable? | Por qué |
|---|---|---|
| `batch_edit` | **Sí** | Reescribe los mismos valores; sin versionado optimista |
| `adjust_stock` con `targetStock` | **Sí** | Fija un absoluto; en el reintento `actualQtyChange === 0` y ni siquiera registra Kardex |
| `adjust_stock` con `delta` | **No** | Aditivo: corrompe stock |
| `add` | No | El reintento choca con `'Ya existe un producto con ese ID'` |
| `edit` | No | El versionado optimista `baseUpdatedAt` rechaza el reintento |
| `delete` | No | El reintento no encuentra el producto |

Las tres últimas no corrompen datos, pero el reintento devuelve `success: false` y el comando termina marcado `failed` en la nube **aunque se aplicó bien** — el dueño ve un fallo que no ocurrió.

**Cambio.** Exportar el predicado desde `remoteInventoryProcessor.js`, junto a `VALID_ACTIONS`, para que la regla viva al lado de los handlers que la determinan:

```js
/**
 * ¿Es seguro que el catch-up vuelva a aplicar este comando?
 * Sólo lo es si repetirlo deja el mismo estado. `adjust_stock` con delta es
 * aditivo y duplicaría el stock; 'add'/'edit'/'delete' no corrompen pero el
 * reintento falla y marcaría como 'failed' algo que sí se aplicó.
 */
export function isReappliableCommand(payload) {
    const action = payload?.action;
    if (action === 'batch_edit') return true;
    if (action === 'adjust_stock') {
        const t = payload?.data?.targetStock;
        return t !== undefined && t !== null && t !== '';
    }
    return false;
}
```

y en el call site:

```js
if (!ok) {
    if (isReappliableCommand(command.payload)) {
        unmarkApplied(command.id);
        appliedIds.delete(command.id);
    } else {
        console.error(`[SupervisorCommands] ${command.id} se aplicó localmente pero no se pudo marcar, y no es re-aplicable: se deja marcado. Quedará 'pending' en la nube.`);
    }
}
```

**El trade-off, explícito.** Para las acciones no re-aplicables la fila queda en `pending` en la nube para siempre y el monitor la muestra como no aplicada, aunque sí lo esté. Es un defecto cosmético en una pantalla, contra corromper el stock del inventario. Se elige el cosmético. El riesgo residual es que `APPLIED_IDS_MAX` haga rodar el ID fuera de la lista local y un catch-up posterior lo re-aplique; queda anotado, no se ataca aquí — la solución de fondo es un reintento diferido de la escritura de status, que es otro alcance.

**Test** (`tests/remoteInventory.test.js`, o archivo nuevo `tests/commandReapply.test.js`): `isReappliableCommand` es una función pura; cubrir las 6 filas de la tabla, incluyendo `targetStock: 0` (que debe dar `true`, no caer por falsy).

---

### H3 🟡 — El catálogo se recorre entero en cada venta

**Dónde:** [ProductContext.jsx:227-250](src/context/ProductContext.jsx#L227-L250), ancla `const lastKnown = parseFloat(localStorage.getItem('dj_last_effective_rate')`.

**Qué pasa.** El efecto depende de `products`, así que corre en cada venta, y el `reduce` con `getFrozenFormats` recorre el catálogo completo aunque la tasa no haya cambiado. Es el punto 4.3 del plan anterior, omitido. No es un bug — es coste O(n) por venta en el dispositivo más lento del negocio.

**Cambio:** salir antes de recorrer nada cuando la tasa no se movió.

```js
if (!(lastKnown > 0 && Math.abs(lastKnown - effectiveRate) > 0.05)) {
    localStorage.setItem('dj_last_effective_rate', String(effectiveRate));
    return;
}
```

El `setItem` se mantiene en la rama de salida: es lo que ya hacía el código al final del bloque, y quitarlo dejaría el baseline sin inicializar en el primer arranque.

**Cuidado:** `parseFloat` está prohibido en código financiero por ESLint, pero `src/context/**` no está en el ámbito de esa regla y el `parseFloat` ya existe en la línea. No cambiarlo en esta fase — tocarlo obliga a revisar el baseline completo y no es el objetivo.

**Test** (extender `tests/bsCongeladoAlert.test.js`): tercer caso con `dj_last_effective_rate = 120` y `effectiveRate = 120`; afirmar que el contador de productos evaluados es 0 y que el baseline sigue en `120`.

---

### H4 🟢 — Endurecer el guarda-raíl de F2

**Dónde:** [eslint.config.js:72-79](eslint.config.js#L72-L79).

La regla que prohíbe `hasBox` / `hasHalfBox` está en un bloque `'no-restricted-syntax': ['warn', ...]`. Avisa pero no bloquea, y hoy hay 1783 warnings: nadie va a ver uno más. El guarda-raíl de F2 existe pero no guarda.

**Cambio:** subir ese bloque a `'error'`. Contiene también el selector de `document.write` (SEC-020).

**Verificar antes de commitear:** correr `npx eslint --no-cache src tests` y confirmar que el total sigue en **88 errores**. Si sube, hay un `hasBox` o un `document.write` real que el warning estaba tapando — en ese caso **DETENTE** y reporta: ese hallazgo es más importante que el cambio de severidad.

**Guarda-raíl adicional en el mismo bloque**, para que V1 no pueda repetirse:

```js
{ selector: "CallExpression[callee.object.name='window'][callee.property.name='addEventListener'][arguments.0.value='visibilitychange']",
  message: "visibilitychange se emite en document, no en window. Usa document.addEventListener." },
```

---

## 4. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| K1 | `visibilitychange` a `document` + `pagehide`, sin `sendBeacon` | Alinea con los otros 3 hooks del repo. `sendBeacon` obligaría a una segunda ruta de escritura a la nube: la duplicación es la causa raíz de este plan, no la cura. |
| K2 | El límite del flush en unload se documenta, no se oculta | `visibilitychange → hidden` es la ruta que de verdad completa; prometer garantías en `beforeunload` sería mentir en un comentario. |
| K3 | Ante un status no escribible, se prefiere una fila `pending` huérfana antes que re-aplicar | Un dato cosmético incorrecto en el monitor se ve y se corrige; un stock duplicado se propaga al Kardex y al cierre de caja. |
| K4 | `isReappliableCommand` vive en `remoteInventoryProcessor.js`, no en el hook | La idempotencia la determinan los handlers. Si mañana alguien añade una acción, la regla está en el archivo que está editando. |
| K5 | El bloque de ESLint sube a `error` sólo si el conteo no se mueve | Un guarda-raíl que rompe el build el día que se instala se desactiva ese mismo día. |
| K6 | No se toca el `parseFloat` de `ProductContext` | Fuera del ámbito de la regla y fuera del alcance de este plan. |

---

## 5. Riesgos

- **H1** cambia el ciclo de vida de un listener en el hook de comandos del supervisor. Si el cleanup queda asimétrico (`document.addEventListener` con `window.removeEventListener`) el handler se acumula en cada remount. Revisar los dos lados en el mismo diff.
- **H2** puede dejar comandos visibles como `pending` en el monitor. Es esperado (K3), pero conviene avisarle al dueño antes de que lo reporte como bug.
- **H3** toca un efecto que escribe `dj_last_effective_rate`. Si el `return` temprano se coloca antes del `setItem`, el baseline nunca se inicializa y la alerta de Bs congelado deja de dispararse. El test del tercer caso existe justamente para eso.
- **H4** es el único cambio que puede romper el build de otra persona. Va al final y con el conteo verificado.

## 6. Si algo no encaja

Si al abrir un archivo el código no coincide con lo descrito arriba, **detente y reporta**. Estas anclas se verificaron contra `main` en el árbol limpio posterior a `14d2046`; una discrepancia significa que hay un cambio intermedio que este plan no vio.
