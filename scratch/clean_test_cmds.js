import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzgxMzA3MywiZXhwIjoyMDk5Mzg5MDczfQ.ExA2vTlQS_58nhprdNDPZVwjIK4JCvYUCQW4T_um8fo';
const supabaseAdmin = createClient(url, serviceKey);

async function cleanTest() {
  await supabaseAdmin.from('supervisor_commands').delete().eq('status', 'pending');
  console.log('Cleaned test commands.');
}

cleanTest();
