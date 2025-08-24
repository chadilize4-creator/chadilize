// api/users_list.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';
import { ensureCoreTables } from './_schema.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    await ensureCoreTables();

    const parsed = validateInitData(req.headers['telegram-init-data'] || '');
    if (!parsed?.user?.id) return res.status(401).json({ ok:false, reason:'auth' });

    const q = (req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit || 100), 500);

    let rows;
    if (q) {
      rows = (await pool.query(
        `SELECT user_id, name, points, avatar_url
         FROM users
         WHERE name IS NOT NULL AND lower(name) LIKE lower($1)
         ORDER BY lower(name) ASC
         LIMIT $2`,
        [ `%${q}%`, limit ]
      )).rows;
    } else {
      rows = (await pool.query(
        `SELECT user_id, name, points, avatar_url
         FROM users
         WHERE name IS NOT NULL
         ORDER BY lower(name) ASC
         LIMIT $1`,
        [ limit ]
      )).rows;
    }
    res.json({ ok:true, players: rows });
  } catch (e) {
    console.error('users_list', e);
    res.status(500).json({ ok:false, error:'server' });
  }
}
