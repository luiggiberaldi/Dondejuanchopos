import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzgxMzA3MywiZXhwIjoyMDk5Mzg5MDczfQ.ExA2vTlQS_58nhprdNDPZVwjIK4JCvYUCQW4T_um8fo';
const supabaseAdmin = createClient(url, serviceKey);

async function checkAllPairings() {
  const { data: pairings } = await supabaseAdmin.from('device_pairings').select('*');
  console.log('=== ALL DEVICE PAIRINGS ===');
  console.log(pairings);
}

checkAllPairings();
