import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzgxMzA3MywiZXhwIjoyMDk5Mzg5MDczfQ.ExA2vTlQS_58nhprdNDPZVwjIK4JCvYUCQW4T_um8fo';

const supabase = createClient(url, key);

async function generateTokenForDevice() {
  const targetDeviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
  
  // Call generate_pairing_token RPC
  const { data: token, error } = await supabase.rpc('generate_pairing_token', {
    p_device_id: targetDeviceId
  });

  if (error) {
    console.error('Error generating token:', error);
  } else {
    console.log('=== GENERATED PAIRING TOKEN ===');
    console.log('Token:', token);
    console.log('Target Device:', targetDeviceId);
  }

  // Check sync documents for this device
  const { data: docs } = await supabase.from('sync_documents').select('doc_id, collection, updated_at').eq('device_id', targetDeviceId).order('updated_at', { ascending: false }).limit(10);
  console.log('=== SYNC DOCUMENTS FOR DEVICE ===');
  console.log(JSON.stringify(docs, null, 2));
}

generateTokenForDevice();
