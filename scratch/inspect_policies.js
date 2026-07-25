import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzgxMzA3MywiZXhwIjoyMDk5Mzg5MDczfQ.ExA2vTlQS_58nhprdNDPZVwjIK4JCvYUCQW4T_um8fo';

const supabaseAdmin = createClient(url, serviceKey);

async function inspectPolicies() {
  const { data: policies } = await supabaseAdmin.rpc('get_policies'); // or raw query via RPC if exists
  console.log('Policies:', policies);

  // Let's test completing pairing for this device with monitor_device_id
  const targetDeviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
  const token = 'E4E887';
  const monitorId = 'PDA-V2-MONITOR-USER';

  const { data: pairResult, error: pErr } = await supabaseAdmin.rpc('pair_monitor', {
    p_pairing_token: token,
    p_monitor_device_id: monitorId
  });

  console.log('Pair RPC Result:', pairResult, pErr);

  // Also let's check device_pairings again
  const { data: pairings } = await supabaseAdmin.from('device_pairings').select('*');
  console.log('Pairings:', pairings);
}

inspectPolicies();
