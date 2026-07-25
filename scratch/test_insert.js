import { createClient } from '@supabase/supabase-js';

const url = 'https://tbnondeyissgodyrwdvm.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRibm9uZGV5aXNzZ29keXJ3ZHZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4MTMwNzMsImV4cCI6MjA5OTM4OTA3M30.1FrhLY4cyVWPPKfQDgfLRtQBKO0rkZ2qbWnQ4fB35Lw';
const supabaseAnon = createClient(url, anonKey);

async function testInsert() {
  // Test 1: Using paired primary device PDA-V2-F5580D482A2E385ADE616574C461C251 and monitor PDA-V2-4EBD456DDD7FF2DC5EE2468C46D02357
  console.log('--- TEST 1: Paired Device ---');
  const res1 = await supabaseAnon.from('supervisor_commands').insert({
    primary_device_id: 'PDA-V2-F5580D482A2E385ADE616574C461C251',
    monitor_device_id: 'PDA-V2-4EBD456DDD7FF2DC5EE2468C46D02357',
    command_type: 'inventory_update',
    payload: { action: 'test' },
    status: 'pending'
  }).select();
  console.log('Res 1:', res1);

  // Test 2: Using unpaired primary device PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F
  console.log('--- TEST 2: Unpaired Device ---');
  const res2 = await supabaseAnon.from('supervisor_commands').insert({
    primary_device_id: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
    monitor_device_id: 'PDA-V2-4EBD456DDD7FF2DC5EE2468C46D02357',
    command_type: 'inventory_update',
    payload: { action: 'test' },
    status: 'pending'
  }).select();
  console.log('Res 2:', res2);
}

testInsert();
