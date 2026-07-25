import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4MTMwNzMsImV4cCI6MjA5OTM4OTA3M30.1FrhLY4cyVWPPKfQDgfLRtQBKO0rkZ2qbWnQ4fB35Lw';
const supabaseAnon = createClient(url, anonKey);

async function testMonitorLookup() {
  const primaryDeviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';

  // 1. Fetch monitor_device_id from device_pairings for this primaryDeviceId
  const { data: pairing } = await supabaseAnon
    .from('device_pairings')
    .select('monitor_device_id')
    .eq('primary_device_id', primaryDeviceId)
    .single();

  console.log('Fetched pairing from cloud:', pairing);

  const monitorIdToUse = pairing?.monitor_device_id || localStorage.getItem('dj_device_id') || 'monitor_web';

  const { data, error } = await supabaseAnon.from('supervisor_commands').insert({
    primary_device_id: primaryDeviceId,
    monitor_device_id: monitorIdToUse,
    command_type: 'inventory_update',
    payload: { action: 'test_auto_lookup' },
    status: 'pending'
  }).select();

  console.log('Insert result using fetched monitorId:', data, error);
}

testMonitorLookup();
