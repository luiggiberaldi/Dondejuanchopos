# Plan de implementación — Deudas y abonos desde el Supervisor

## Objetivo

Permitir que un Supervisor emparejado registre en un cliente una **deuda manual** o un **abono** desde la vista `Clientes y Cuentas por Cobrar`, y que el saldo, el historial financiero y la nube terminen consistentes con lo aplicado por la caja principal. Corregir los problemas detectados en el reinicio de saldo y en la aplicación de transacciones remotas. No cambiar reglas contables existentes sin verificarlas contra el flujo de caja.

## Estado confirmado en el código

- `MonitorDeudasTab` lista clientes, historial, WhatsApp y `Ajustar $0`; no expone acciones de deuda ni abono.
- `useSupervisorCommands` ya reconoce `inventory_update` con `action: 'register_customer_payment'` y guarda ventas e importe de saldo en la caja.
- No se encontró emisor de `register_customer_payment` en el frontend. El flujo local de referencia es `processCustomerTransaction` y `TransactionModal`.
- El reinicio remoto de saldo registra un error de inserción, pero luego continúa con escritura local del monitor y muestra éxito; intenta además escribir directamente `sync_documents`.
- El consumidor de `register_customer_payment` inserta records y guarda clientes aunque el selector no haya encontrado el cliente; no exige identidad de cliente ni comprueba el número de filas afectadas.
- No hay pruebas específicas del envío/aplicación de operaciones financieras remotas.

## Prioridades de implementación

### P0 — Seguridad e integridad antes de habilitar operaciones financieras

1. **Definir un contrato único e idempotente de comando.** Para deuda y abono enviar `command_type: 'inventory_update'` con `payload.action: 'register_customer_payment'`; incluir `commandId`, `operationId`, `customerId` (y `customerCode` solo como alternativa de compatibilidad), `transactionType` (`ABONO` o `CREDITO`), moneda, importe original, equivalente USD, tasa capturada, método de pago cuando sea abono, actor/supervisor y uno o más registros financieros completos con IDs estables. El saldo esperado debe derivarse del estado fresco de caja usando la misma función/modelo contable que el flujo normal, no confiar ciegamente en deuda/favor calculados por el monitor.
2. **Aplicación atómica en caja.** Bajo `pos_write_lock` y una transacción de `storageService`, leer cliente y ventas frescas; rechazar con `failed` si no existe exactamente un cliente inequívoco, si ID/código se contradicen, los montos/moneda/tasa son inválidos o los registros no corresponden al cliente/comando. Aplicar saldo y registros como una sola unidad; nunca persistir un historial sin saldo ni alterar clientes si no se guardó el movimiento.
3. **Idempotencia real del comando.** Deduplicar por `commandId` y `operationId` y por IDs de records. Un reintento o catch-up debe producir un solo cambio de saldo y una sola fila por movimiento. Si se detecta el mismo ID con diferente contenido, fallar de forma visible. No volver a ejecutar comandos ya aplicados cuando solo se reintenta el acuse.
4. **Confirmación posterior a persistencia.** La caja marcará `applied` solo después de completar almacenamiento local y espejo requerido. Si la escritura de nube falla después de aplicar localmente, conservar el patrón de comando aplicado/no confirmado: emitir estado recuperable y no repetir el débito/crédito. La confirmación debe contener detalle/error sin exponer información privada innecesaria.
5. **Corregir el reinicio de saldo.** Si no hay `pairedDeviceId`, Supabase o monitor identity, detener y reportar error. Si falla el insert, no mutar ni mostrar éxito. Retirar la escritura directa desde el monitor a `sync_documents` y evitar optimismo no reconciliable; consultar estado del comando y actualizar la UI tras acuse de caja. Mantener la acción solo si tiene una razón de negocio válida; si se conserva, exigir confirmación explícita y registrar actor/motivo en auditoría.
6. **Revisar RLS efectiva.** Confirmar que un monitor vigente solo pueda insertar comandos para su caja y que la caja solo procese comandos de su par; revisar `is_authorized_monitor` y el endurecimiento de `supervisor_commands`. No abrir políticas ni usar `service_role` en el cliente. Antes de tocar SQL remoto, inspeccionar el proyecto correcto, políticas activas y migraciones; no ejecutar DDL destructivo sin aprobación expresa.

### P1 — Experiencia del Supervisor

7. **Añadir acciones por cliente en `MonitorDeudasTab`.** Incorporar `Agregar deuda` y `Recibir abono` en tarjeta móvil y tabla desktop, visibles solo con emparejamiento válido. Usar un modal compartido o compatible con `TransactionModal` para mostrar cliente, tipo, moneda, importe, tasa/equivalencia, método de pago para abono, saldo previo y saldo esperado.
8. **Seguridad operativa del formulario.** Validar importe finito y positivo, tasa positiva, moneda soportada y método habilitado. Reutilizar límites y doble confirmación de importes altos del flujo normal. Enviar la solicitud una sola vez por confirmación; bloquear doble clic y conservar el mismo UUID si el resultado queda incierto. Mostrar estados `pendiente`, `aplicado`, `rechazado` y `sin confirmar`; no comunicar “éxito” antes del acuse de caja.
9. **Envío duradero y estado visible.** Integrar con la cola de comandos / `supervisor_commands`, persistir identidad y payload antes del primer intento, observar realtime y hacer catch-up/polling acotado por el ID conocido. Si se pierde la respuesta, consultar ese mismo comando antes de ofrecer reintento. Proporcionar reintento solo si se sabe que no se aplicó o repetir con el mismo ID idempotente.
10. **Actualizar lectura en monitor.** Después del estado terminal, recuperar el documento de clientes y ventas desde la fuente canónica de la caja. No escribir el saldo optimista como verdad; si la sincronización queda pendiente, mostrarlo claramente sin inducir un segundo movimiento.

### P2 — Auditoría, reversión y calidad de datos

11. Mantener el shape compatible con `COBRO_DEUDA` para abonos y `VENTA_FIADA` para deuda manual, incluyendo autor, dispositivo, fecha, moneda/importes, tasa, método, cliente y enlace a `operationId`/comando. Asegurar que ambas operaciones aparecen en historial y cierre/reportes según reglas actuales.
12. Confirmar que la reversión de ambos tipos restaura el saldo correctamente, que abonos excedentes van al saldo a favor conforme a `procesarImpactoCliente`, y que anulaciones no dupliquen ajustes. Tratar clientes inexistentes/duplicados como error sin side effects.
13. Añadir logs/auditoría con actor, customerId, cantidad y commandId; evitar registrar credenciales o datos sensibles que no sean necesarios.

## Pruebas y criterios de aceptación

### Unitarias / integración local

- La vista ofrece ambas acciones en móvil y desktop, abre el cliente correcto y no las habilita sin caja emparejada.
- Contrato de comando cubre `ABONO` y `CREDITO`, moneda USD/Bs/COP cuando esté habilitada, tasas, método de pago, conversión, límites y datos inválidos.
- Aplicación en caja: saldo correcto, historial completo, persistencia espejo, eventos de actualización y auditoría.
- Cliente inexistente, ID/código contradictorios, cliente duplicado, registro inválido o monto no finito: estado `failed`, saldo e historial sin cambios.
- Entrega repetida del mismo comando/operationId: un solo cambio y un solo movimiento. Mismo ID con distinto payload: falla segura.
- Fallos simulados en cada límite de escritura (venta, cliente, mirror, push cloud, confirmación): no se comunica éxito falso y el resultado incierto queda recuperable sin duplicación.
- Reinicio de saldo: insert fallido no modifica el monitor y no emite toast de éxito; estado solo cambia tras confirmación de caja.
- Reversión de abono/deuda conserva el saldo neto esperado y actualiza el historial una sola vez.

### Extremo a extremo con dos dispositivos emparejados

- Supervisor registra deuda → caja procesa → ambos muestran saldo/historial tras eco canónico.
- Supervisor registra abono (menor, igual y mayor que la deuda) → caja procesa → deuda/saldo a favor coherente.
- Probar USD y Bs con la tasa vigente; COP solo si está habilitado y configurado.
- Cerrar/reabrir monitor, desconectar/reconectar red y simular respuesta perdida; comprobar que no se duplica.
- Probar caja offline: comando queda pendiente, la UI lo indica y no afirma aplicación; al reconectar se aplica una vez.
- Verificar que una caja diferente o monitor revocado no puede insertar/leer/aplicar el comando.

### Criterio de salida

La función se considera lista cuando un Supervisor emparejado puede registrar y confirmar ambas operaciones, el saldo y el historial de la caja son canónicos, reintentos no duplican y pruebas cubren errores/permisos. No declarar lista con solo build o tests unitarios. Si no hay acceso a dos dispositivos, reportar explícitamente el bloqueo y no afirmar validación real.

## Orden sugerido de cambios

1. Añadir pruebas de caracterización del handler remoto y del reinicio para reproducir los riesgos.
2. Definir contrato compartido e implementar validación/idempotencia/atomicidad del receptor.
3. Corregir el reinicio y su confirmación.
4. Añadir el emisor durable y estados de la cola desde el monitor.
5. Añadir modal/acciones responsive y reglas de importes.
6. Completar pruebas, lint de archivos tocados y build; revisar diff y ejecutar E2E en par real.

## Archivos principales por revisar

- Vista y saldos: `src/components/Monitor/MonitorDeudasTab.jsx`, `src/components/Monitor/MonitorTabs.jsx`, `src/views/OwnerMonitorView.jsx`.
- Emisor/cola: `src/hooks/useSupervisorCommandQueue.js`, `src/utils/supervisorCommandModel.js`, `src/constants/commandStatus.js`.
- Consumidor de caja: `src/hooks/useSupervisorCommands.js`.
- Flujo contable de referencia: `src/views/CustomersView.jsx`, `src/components/Customers/TransactionModal.jsx`, `src/utils/customerTransactionProcessor.js`, `src/utils/financialLogic.js`, `src/components/Customers/VoidMovementModal.jsx`.
- RLS: `supabase_supervisor_commands_setup.sql`, `supabase_sync_supervisor_hardening.sql`.
- Pruebas relacionadas: `tests/customerIntegrity.test.js`, `tests/customerSyncGuard.test.js`, `tests/supervisorQueueLifecycle.test.js`, `tests/supervisorFeatureRouting.test.js`.
