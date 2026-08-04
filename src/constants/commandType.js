/**
 * src/constants/commandType.js
 *
 * ESPEJO EXACTO de `supervisor_commands_command_type_check`
 * en `supabase_supervisor_commands_setup.sql`.
 *
 * F2/F3: 'reopen_shift' tenía handler en useSupervisorCommands y emisor en
 * OwnerMonitorView, pero el CHECK de Postgres lo rechazaba (23514) y nadie
 * lo notaba porque no existía un test espejo para command_type.
 *
 * REGLA: si añades un tipo aquí, añádelo también al CHECK del .sql.
 * `tests/commandType.test.js` falla si ambos se separan.
 */
export const COMMAND_TYPE = Object.freeze({
    RATE_CHANGE: 'rate_change',
    INVENTORY_UPDATE: 'inventory_update',
    VOID_SALE: 'void_sale',
    USER_UPDATE: 'user_update',
    FORCE_DAILY_CLOSE: 'force_daily_close',
    REOPEN_SHIFT: 'reopen_shift',
});

export const VALID_COMMAND_TYPES = Object.freeze(Object.values(COMMAND_TYPE));
