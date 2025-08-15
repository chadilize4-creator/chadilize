// api/click_logo.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const parsed = validateInitData(req.headers['telegram-init-data'] || '');
    if (!parsed?.user?.id) return res.status(401).json({ error: 'invalid initData' });

    const uid = parsed.user.id;
    const r = await pool.query(
      `UPDATE users SET points = points + 1 WHERE user_id=$1 RETURNING points`,
      [uid]
    );
    if (!r.rowCount) {
      const r2 = await pool.query(
        `INSERT INTO users (user_id, points) VALUES ($1, 1) RETURNING points`,
        [uid]
      );
      return res.json({ total_points: Number(r2.rows[0].points) });
    }
    res.json({ total_points: Number(r.rows[0].points) });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server' });
  }
}
