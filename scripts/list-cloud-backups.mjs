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
    console.log('Connecting to:', url);
    const res = await fetch(`${url}/rest/v1/cloud_backups?select=id,device_id,updated_at&order=updated_at.desc`, { headers: H });
    if (!res.ok) {
        console.error('Error fetching cloud_backups:', res.status, await res.text());
        return;
    }
    const data = await res.json();
    console.log(`Total cloud_backups: ${data.length}`);
    data.forEach((b, i) => {
        console.log(`[${i + 1}] ID: ${b.id} | Device: ${b.device_id} | Updated: ${b.updated_at}`);
    });

    // Also check pos_devices to see the active devices
    const resDevices = await fetch(`${url}/rest/v1/pos_devices?select=*&order=last_heartbeat.desc&limit=5`, { headers: H });
    if (resDevices.ok) {
        const devices = await resDevices.json();
        console.log('\n--- Active POS Devices ---');
        devices.forEach(d => {
            console.log(`Device: ${d.device_id} | Role: ${d.role} | Name: ${d.device_name || d.alias} | Last HB: ${d.last_heartbeat}`);
        });
    }

    // Also check sync_documents latest updates
    const resSync = await fetch(`${url}/rest/v1/sync_documents?select=device_id,collection,doc_id,updated_at&order=updated_at.desc&limit=10`, { headers: H });
    if (resSync.ok) {
        const syncDocs = await resSync.json();
        console.log('\n--- Latest Sync Documents ---');
        syncDocs.forEach(s => {
            console.log(`Device: ${s.device_id} | Collection: ${s.collection} | Doc: ${s.doc_id} | Updated: ${s.updated_at}`);
        });
    }
}

main().catch(console.error);
