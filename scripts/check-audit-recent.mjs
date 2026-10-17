import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env');
    const env = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const i = t.indexOf('=');
        if (i > -1) {
            let v = t.substring(i + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            env[t.substring(0, i).trim()] = v;
        }
    });
    return env;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}` };

async function main() {
    console.log('Querying recent supervisor_commands...');
    const res = await fetch(`${url}/rest/v1/supervisor_commands?order=created_at.desc&limit=25`, { headers: H });
    if (res.ok) {
        const cmds = await res.json();
        console.log(`Retrieved ${cmds.length} commands:`);
        cmds.forEach(c => {
            console.log(`- [${c.created_at}] ID: ${c.id?.slice(0,8)} | Type: ${c.command_type} | Status: ${c.status} | Action: ${c.payload?.action || c.payload?.commandType || 'none'} | Error: ${c.error_reason || 'none'}`);
            if (c.command_type === 'inventory_update' && c.payload?.action === 'sale_number_claim') {
                console.log(`   Candidate: ${c.payload?.candidate} | Key: ${c.payload?.claimKey}`);
            }
        });
    }

    // Check pos_devices last heartbeat
    const resDev = await fetch(`${url}/rest/v1/pos_devices?select=*&order=last_heartbeat.desc&limit=5`, { headers: H });
    if (resDev.ok) {
        const devs = await resDev.json();
        console.log('\nDevices:');
        devs.forEach(d => console.log(`- ${d.device_id} | Role: ${d.role} | HB: ${d.last_heartbeat} | Paired: ${d.paired_device_id}`));
    }
}

main().catch(console.error);
