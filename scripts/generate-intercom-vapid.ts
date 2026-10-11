import {
  exportApplicationServerKey,
  exportVapidKeys,
  generateVapidKeys,
} from 'jsr:@negrel/webpush@0.5.0';

const keys = await generateVapidKeys({ extractable: true });
const exportedKeys = await exportVapidKeys(keys);
const publicKey = await exportApplicationServerKey(keys);
const privatePath = new URL('../.intercom-vapid-private.json', import.meta.url);

await Deno.writeTextFile(privatePath, `${JSON.stringify(exportedKeys, null, 2)}\n`, { mode: 0o600 });
console.log(publicKey);
