// api/_auth.js
import crypto from 'crypto';

const BOT_TOKEN = process.env.BOT_TOKEN;

function parseInitData(initData) {
  const map = new Map();
  for (const entry of initData.split('&')) {
    const idx = entry.indexOf('=');
    if (idx < 0) continue;
    const k = decodeURIComponent(entry.slice(0, idx));
    const v = decodeURIComponent(entry.slice(idx + 1));
    map.set(k, v);
  }
  const hash = map.get('hash') || '';
  map.delete('hash');
  const pairs = [];
  for (const [k, v] of [...map.entries()].sort((a,b)=> a[0].localeCompare(b[0]))) {
    pairs.push(`${k}=${v}`);
  }
  return { hash, data_check_string: pairs.join('\n'), data: Object.fromEntries(map) };
}

export function validateInitData(initData) {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');
  if (!initData) return null;

  const { hash, data_check_string, data } = parseInitData(initData);

  // secret = HMAC_SHA256(bot_token, "WebAppData")
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();

  // local = HMAC_SHA256(data_check_string, secret)
  const local = crypto.createHmac('sha256', secret).update(data_check_string).digest('hex');

  if (local !== hash) return null;

  // Optional freshness check (24h)
  const authDate = Number(data.auth_date || '0');
  if (!authDate || (Date.now()/1000 - authDate) > 3600*24) {
    // return null; // uncomment to enforce freshness
  }

  const user = data.user ? JSON.parse(data.user) : null;
  return { user, raw: data };
}
