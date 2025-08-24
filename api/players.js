// api/players.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';

export default async function handler(req,res){
  if (req.method !== 'GET') return res.status(405).end();
  const parsed = validateInitData(req.headers['telegram-init-data']||'');
  if (!parsed?.user?.id) return res.status(401).json({ ok:false, error:'auth' });

  const me = parsed.user.id;
  const q = (req.query.q||'').toString().trim();

  try{
    const args = [];
    let sql = `SELECT user_id, name, COALESCE(points,0) AS points
               FROM users WHERE name IS NOT NULL AND name <> ''`;
    if (q){
      args.push(q + '%');
      sql += ` AND lower(name) LIKE lower($${args.length})`;
    }
    sql += ` ORDER BY points DESC NULLS LAST LIMIT 200`;
    const r = await pool.query(sql, args);
    // unread count
    const c = await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE to_user=$1 AND read_at IS NULL`, [me]);
    res.json({ ok:true, players: r.rows, unread: c.rows[0]?.n||0 });
  }catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server' }); }
}
