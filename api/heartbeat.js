// api/heartbeat.js  (POST)
import { sql } from './_db.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const { id, username, avatarIdx, chads, gen, acc } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, reason:'missing id' });

    await sql`
      insert into users (id, username, avatar_idx, chads, gen, acc, last_active)
      values (${id}, ${username||null}, ${avatarIdx??null}, ${chads??0}, ${gen??0}, ${acc??0}, now())
      on conflict (id) do update set
        username     = coalesce(excluded.username, users.username),
        avatar_idx   = coalesce(excluded.avatar_idx, users.avatar_idx),
        chads        = excluded.chads,
        gen          = excluded.gen,
        acc          = excluded.acc,
        last_active  = now()
    `;
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}
