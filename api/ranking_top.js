// api/ranking_top.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';
import { ensureCoreTables } from './_schema.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    await ensureCoreTables();

    const parsed = validateInitData(req.headers['telegram-init-data'] || '');
    if (!parsed?.user?.id) return res.status(401).json({ ok:false, reason:'auth' });

    const rows = (await pool.query(`
      WITH ranked AS (
        SELECT u.user_id, u.name, u.points,
               COALESCE(t.name,'') AS tribe_name,
               RANK() OVER (ORDER BY u.points DESC NULLS LAST) AS rnk
        FROM users u
        LEFT JOIN tribe_members tm ON tm.user_id = u.user_id AND tm.banned = FALSE
        LEFT JOIN tribes t ON t.id = tm.tribe_id
        WHERE u.name IS NOT NULL
      )
      SELECT * FROM ranked ORDER BY rnk ASC, lower(name) ASC LIMIT 100;
    `)).rows;

    res.json({ ok:true, ranking: rows });
  } catch (e) {
    console.error('ranking_top', e);
    res.status(500).json({ ok:false, error:'server' });
  }
}
