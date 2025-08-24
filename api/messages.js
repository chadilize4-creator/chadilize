// api/messages.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';
import { ensureCoreTables } from './_schema.js';

export default async function handler(req, res) {
  try {
    await ensureCoreTables();

    const parsed = validateInitData(req.headers['telegram-init-data'] || '');
    const me = parsed?.user?.id;
    if (!me) return res.status(401).json({ ok:false, reason:'auth' });

    if (req.method === 'GET') {
      const mode = String(req.query.mode || 'threads');

      if (mode === 'unread') {
        const r = await pool.query(`SELECT count(*)::int AS n FROM messages WHERE to_id=$1 AND read_by_to=false`, [me]);
        return res.json({ ok:true, unread: r.rows[0].n });
      }

      if (mode === 'history') {
        const peer = BigInt(req.query.peer || '0');
        if (!peer) return res.status(400).json({ ok:false, reason:'peer' });

        const rows = (await pool.query(`
          SELECT id, from_id, to_id, body, kind, transfer_id, created_at
          FROM messages
          WHERE (from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)
          ORDER BY created_at ASC
          LIMIT 200
        `, [me, peer])).rows;

        // mark received as read
        await pool.query(`UPDATE messages SET read_by_to=true WHERE to_id=$1 AND from_id=$2 AND read_by_to=false`, [me, peer]);
        return res.json({ ok:true, history: rows });
      }

      // threads (last message + unread)
      const rows = (await pool.query(`
        WITH last AS (
          SELECT DISTINCT ON (least(from_id,to_id), greatest(from_id,to_id))
                 least(from_id,to_id) AS a,
                 greatest(from_id,to_id) AS b,
                 id, from_id, to_id, body, kind, transfer_id, created_at
          FROM messages
          WHERE from_id=$1 OR to_id=$1
          ORDER BY least(from_id,to_id), greatest(from_id,to_id), created_at DESC, id DESC
        ),
        unread AS (
          SELECT from_id, count(*)::int AS n
          FROM messages
          WHERE to_id=$1 AND read_by_to=false
          GROUP BY from_id
        )
        SELECT l.*, 
               CASE WHEN l.a=$1 THEN l.b ELSE l.a END AS peer_id,
               COALESCE(u.name,'') AS peer_name,
               COALESCE(u.avatar_url,'') AS peer_avatar,
               COALESCE(un.n,0) AS unread
        FROM last l
        JOIN users u ON u.user_id = (CASE WHEN l.a=$1 THEN l.b ELSE l.a END)
        LEFT JOIN unread un ON un.from_id = (CASE WHEN l.a=$1 THEN l.b ELSE l.a END)
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 200
      `, [me])).rows;

      return res.json({ ok:true, threads: rows });
    }

    // POST send message
    if (req.method === 'POST') {
      const body = await readJson(req);
      const { to, text, kind='text', transfer_id=null } = body || {};
      if (!to || !text) return res.status(400).json({ ok:false, reason:'bad' });

      const r = await pool.query(
        `INSERT INTO messages(from_id,to_id,body,kind,transfer_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, created_at`,
        [me, to, String(text).slice(0, 1200), kind, transfer_id]
      );
      return res.json({ ok:true, id: r.rows[0].id, created_at: r.rows[0].created_at });
    }

    res.status(405).end();
  } catch (e) {
    console.error('messages', e);
    res.status(500).json({ ok:false, error:'server' });
  }
}

/* tiny local body reader to avoid import loop with _util */
function readJson(req){
  return new Promise((resolve)=> {
    let data=''; req.on('data', c=> data+=c);
    req.on('end', ()=> { try{ resolve(data? JSON.parse(data):{}); } catch { resolve({}); } });
  });
}
