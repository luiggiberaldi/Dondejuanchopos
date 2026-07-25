import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzgxMzA3MywiZXhwIjoyMDk5Mzg5MDczfQ.ExA2vTlQS_58nhprdNDPZVwjIK4JCvYUCQW4T_um8fo';

const supabase = createClient(url, key);

async function check() {
  try {
    const { data: commands } = await supabase
      .from('realtime_commands')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    console.log('=== RECENT REALTIME COMMANDS ===');
    console.log(JSON.stringify(commands, null, 2));
  } catch (e) {
    console.error(e);
  }
}

check();
