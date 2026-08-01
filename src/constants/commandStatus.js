// ESPEJO EXACTO de supervisor_commands_status_check en supabase_supervisor_commands_setup.sql.
// Si añades un valor aquí, corre también el ALTER en Supabase o la BD lo rechazará en silencio.
export const COMMAND_STATUS = Object.freeze({
    PENDING: 'pending',
    APPLIED: 'applied',
    APPLIED_WITH_WARNINGS: 'applied_with_warnings',
    FAILED: 'failed',
});

export const VALID_COMMAND_STATUSES = Object.freeze(Object.values(COMMAND_STATUS));
