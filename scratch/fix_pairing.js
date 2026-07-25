import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzgxMzA3MywiZXhwIjoyMDk5Mzg5MDczfQ.ExA2vTlQS_58nhprdNDPZVwjIK4JCvYUCQW4T_um8fo';
const supabaseAdmin = createClient(url, serviceKey);

async function fixPairing() {
  const primaryDeviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
  const monitorDeviceId = 'PDA-V2-SUPERVISOR-WEB'; // dedicated supervisor monitor ID

  const { data, error } = await supabaseAdmin
    .from('device_pairings')
    .update({
      monitor_device_id: monitorDeviceId,
      paired_at: new Date().toISOString()
    })
    .eq('primary_device_id', primaryDeviceId);

  console.log('Fix pairing update result:', data, error);

  // Re-test anon insert for ED46F23C375734BF8DF4CC7DC4A4D39F with monitorDeviceId
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4MTMwNzMsImV4cCI6MjA5OTM4OTA3M30.1FrhLY4cyVWPPKfQDgfLRtQBKO0rkZ2qbWnQ4fB35Lw';
  const supabaseAnon = createClient(url, anonKey);

  const res = await supabaseAnon.from('supervisor_commands').insert({
    primary_device_id: primaryDeviceId,
    monitor_device_id: monitorDeviceId,
    command_type: 'inventory_update',
    payload: { action: 'test_after_fix' },
    status: 'pending'
  }).select();

  console.log('--- RETEST INSERT FOR ED46F23C375734BF8DF4CC7DC4A4D39F ---');
  console.log(res);
}

fixPairing();
