import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4MTMwNzMsImV4cCI6MjA5OTM4OTA3M30.1FrhLY4cyVWPPKfQDgfLRtQBKO0rkZ2qbWnQ4fB35Lw';
const supabaseAnon = createClient(url, anonKey);

async function testCloudPending() {
  const primaryDeviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
  const monitorDeviceId = 'PDA-V2-SUPERVISOR-WEB';

  // 1. Insert a test pending command
  const { data: inserted, error: iErr } = await supabaseAnon.from('supervisor_commands').insert({
    primary_device_id: primaryDeviceId,
    monitor_device_id: monitorDeviceId,
    command_type: 'inventory_update',
    payload: { action: 'adjust_stock', productId: 'p123', data: { delta: 5 }, issuedAt: new Date().toISOString() },
    status: 'pending'
  }).select();

  console.log('Inserted pending command:', inserted, iErr);

  // 2. Fetch pending commands
  const { data: pending, error: pErr } = await supabaseAnon
    .from('supervisor_commands')
    .select('*')
    .eq('primary_device_id', primaryDeviceId)
    .eq('status', 'pending');

  console.log('Fetch pending commands:', pending, pErr);

  // 3. Cancel / Annul the pending command
  if (pending && pending.length > 0) {
    const cmdId = pending[0].id;
    const { data: updated, error: uErr } = await supabaseAnon
      .from('supervisor_commands')
      .update({ status: 'cancelled' })
      .eq('id', cmdId)
      .select();

    console.log('Cancelled command result:', updated, uErr);
  }
}

testCloudPending();
