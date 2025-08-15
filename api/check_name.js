// api/check_name.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';

function validWords(name) {
  const words = (name || '').trim().split(/\s+/);
  if (words.length < 1 || words.length > 8) return false;
  return words.every(w => /^[A-Za-z0-9_-]{1,16}$/.test(w));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const parsed = validateInitData(req.headers['telegram-init-data'] || '');
    if (!parsed?.user?.id) return res.status(401).json({ ok:false, reason:'auth' });

    const { name } = req.body || {};
    const trimmed = (name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!validWords(trimmed)) return res.status(400).json({ ok:false, reason:'invalid' });

    const uid = parsed.user.id;

    try {
      await pool.query('BEGIN');
      const exists = await pool.query(
        'SELECT user_id FROM users WHERE lower(name)=lower($1) AND user_id<>$2 LIMIT 1',
        [trimmed, uid]
      );
      if (exists.rowCount) { await pool.query('ROLLBACK'); return res.json({ ok:false, reason:'taken' }); }

      await pool.query(
        `INSERT INTO users (user_id, name) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET name=EXCLUDED.name`,
        [uid, trimmed]
      );
      await pool.query('COMMIT');
      res.json({ ok:true, name: trimmed });
    } catch (e) {
      await pool.query('ROLLBACK');
      if (String(e.message||'').includes('users_name_ci')) {
        return res.json({ ok:false, reason:'taken' });
      }
      throw e;
    }
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, reason:'server' });
  }
}
