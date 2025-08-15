// api/profile.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';

export default async function handler(req, res) {
  try {
    const initData = req.headers['telegram-init-data'] || '';
    const parsed = validateInitData(initData);
    if (!parsed?.user?.id) return res.status(401).json({ error: 'invalid initData' });

    const uid = parsed.user.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [uid]);
      const r = await client.query(
        'SELECT user_id, name, points, gen_per_hour, level FROM users WHERE user_id=$1',
        [uid]
      );
      await client.query('COMMIT');
      const u = r.rows[0];
      res.json({
        user_id: u.user_id,
        name: u.name,
        points: Number(u.points),
        gen_per_hour: Number(u.gen_per_hour),
        level: u.level
      });
    } finally { client.release(); }
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server' });
  }
}
