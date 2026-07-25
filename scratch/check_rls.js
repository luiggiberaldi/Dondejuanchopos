import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4MTMwNzMsImV4cCI6MjA5OTM4OTA3M30.1FrhLY4cyVWPPKfQDgfLRtQBKO0rkZ2qbWnQ4fB35Lw';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzgxMzA3MywiZXhwIjoyMDk5Mzg5MDczfQ.ExA2vTlQS_58nhprdNDPZVwjIK4JCvYUCQW4T_um8fo';

const supabaseAnon = createClient(url, anonKey);
const supabaseAdmin = createClient(url, serviceKey);

async function checkRLS() {
  const primaryDeviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
  const monitorDeviceId = 'test-monitor-device';

  // 1. Check if device_pairings record exists for primary & monitor
  const { data: pairings } = await supabaseAdmin
    .from('device_pairings')
    .select('*')
    .eq('primary_device_id', primaryDeviceId);

  console.log('=== DEVICE PAIRINGS ===');
  console.log(JSON.stringify(pairings, null, 2));

  // 2. Try inserting with Anon Client (same client frontend uses)
  const { data, error } = await supabaseAnon
    .from('supervisor_commands')
    .insert({
      primary_device_id: primaryDeviceId,
      monitor_device_id: monitorDeviceId,
      command_type: 'inventory_update',
      payload: { test: true },
      status: 'pending'
    })
    .select();

  console.log('=== ANON INSERT RESULT ===');
  console.log('Error:', error);
  console.log('Data:', data);
}

checkRLS();
