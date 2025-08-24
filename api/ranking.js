// api/ranking.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';

export default async function handler(req,res){
  if (req.method!=='GET') return res.status(405).end();
  const parsed = validateInitData(req.headers['telegram-init-data']||'');
  if (!parsed?.user?.id) return res.status(401).json({ ok:false, error:'auth' });

  try{
    const r = await pool.query(`
      WITH ranked AS (
        SELECT user_id, name, COALESCE(points,0) AS points,
               RANK() OVER (ORDER BY COALESCE(points,0) DESC) AS rnk
        FROM users
        WHERE name IS NOT NULL AND name <> ''
      )
      SELECT rnk AS rank, name, points,
             NULL::text AS tribe_name
      FROM ranked
      WHERE rnk <= 100
      ORDER BY rnk ASC
    `);
    // Cache for 24h on CDN (so it "updates every 24h")
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=60');
    res.json({ ok:true, top: r.rows });
  }catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server' }); }
}
