import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4MTMwNzMsImV4cCI6MjA5OTM4OTA3M30.1FrhLY4cyVWPPKfQDgfLRtQBKO0rkZ2qbWnQ4fB35Lw';
const supabaseAnon = createClient(url, anonKey);

async function checkPosLastSeen() {
  const primaryDeviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';

  // 1. Query latest updated_at from sync_documents for primary device
  const { data: syncDocs, error: sErr } = await supabaseAnon
    .from('sync_documents')
    .select('updated_at, doc_id')
    .eq('device_id', primaryDeviceId)
    .order('updated_at', { ascending: false })
    .limit(1);

  console.log('Latest sync_documents update for POS:', syncDocs, sErr);

  // 2. Query supervisor_commands applied_at or created_at for primary device
  const { data: cmdDocs, error: cErr } = await supabaseAnon
    .from('supervisor_commands')
    .select('created_at, applied_at, status')
    .eq('primary_device_id', primaryDeviceId)
    .order('created_at', { ascending: false })
    .limit(1);

  console.log('Latest supervisor_commands for POS:', cmdDocs, cErr);
}

checkPosLastSeen();
