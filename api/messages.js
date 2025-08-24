// api/messages.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';
import util from './_util.js';
const { readJson } = util;

export default async function handler(req,res){
  const parsed = validateInitData(req.headers['telegram-init-data']||'');
  if (!parsed?.user?.id) return res.status(401).json({ ok:false, error:'auth' });
  const me = parsed.user.id;

  try{
    if (req.method === 'GET'){
      if (req.query.summary){
        const q = await pool.query(`SELECT COUNT(*)::int AS unread FROM messages WHERE to_user=$1 AND read_at IS NULL`, [me]);
        return res.json({ ok:true, unread: q.rows[0]?.unread||0 });
      }
      if (req.query.threads){
        const r = await pool.query(`
          WITH last AS (
            SELECT DISTINCT ON (LEAST(from_user,to_user), GREATEST(from_user,to_user))
              id, from_user, to_user, text, created_at
            FROM messages
            WHERE from_user=$1 OR to_user=$1
            ORDER BY LEAST(from_user,to_user), GREATEST(from_user,to_user), created_at DESC
          )
          SELECT
            CASE WHEN from_user=$1 THEN to_user ELSE from_user END AS peer_id,
            (SELECT name FROM users WHERE user_id = CASE WHEN from_user=$1 THEN to_user ELSE from_user END) AS peer_name,
            text AS preview,
            (SELECT COUNT(*) FROM messages m2
               WHERE m2.to_user=$1 AND ( (m2.from_user=last.from_user AND m2.to_user=last.to_user)
                                       OR (m2.from_user=last.to_user AND m2.to_user=last.from_user) )
                 AND m2.read_at IS NULL) AS unread
          FROM last
          ORDER BY created_at DESC
          LIMIT 200
        `,[me]);
        return res.json({ ok:true, threads:r.rows });
      }
      if (req.query.with){
        const peer = Number(req.query.with);
        const r = await pool.query(`
          SELECT id, from_user, to_user, text, kind, meta, created_at
          FROM messages
          WHERE (from_user=$1 AND to_user=$2) OR (from_user=$2 AND to_user=$1)
          ORDER BY created_at ASC
          LIMIT 500
        `,[me, peer]);
        // mark read
        await pool.query(`UPDATE messages SET read_at=now() WHERE to_user=$1 AND from_user=$2 AND read_at IS NULL`, [me, peer]);
        return res.json({ ok:true, messages: r.rows.map(m => ({
          id: m.id,
          mine: m.from_user===me,
          text: m.kind==='transfer_request' ? requestText(m) :
                m.kind==='transfer_accept'  ? acceptText(m)  :
                m.text,
          kind: m.kind==='text' ? 'text' : 'system'
        }))});
      }
      return res.json({ ok:true });
    }

    if (req.method === 'POST'){
      const body = await readJson(req);
      const to = Number(body.to||0); const text = String(body.text||'').slice(0,500).trim();
      if (!to || !text) return res.json({ ok:false, error:'bad_input' });

      await pool.query(`INSERT INTO messages(from_user,to_user,text,kind) VALUES ($1,$2,$3,'text')`, [me,to,text]);
      const r = await pool.query(`
        SELECT id, from_user, to_user, text, kind, meta, created_at
        FROM messages
        WHERE (from_user=$1 AND to_user=$2) OR (from_user=$2 AND to_user=$1)
        ORDER BY created_at ASC LIMIT 500
      `,[me,to]);
      return res.json({ ok:true, messages: r.rows.map(m=>({
        id:m.id, mine:m.from_user===me, text:m.text, kind:m.kind==='text'?'text':'system'
      }))});
    }

    res.status(405).end();
  }catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server' }); }
}

function requestText(m){
  const a = m.meta?.amount||m.meta?.amount===0 ? Number(m.meta.amount) : 0;
  const mode = m.meta?.mode || 'send';
  const uname = m.meta?.actor_name || 'player';
  if (mode==='send') return `${uname} offered to SEND ${a} chads to you. Tap accept in the thread to complete.`;
  return `${uname} REQUESTED ${a} chads from you. Tap accept to send.`;
}
function acceptText(m){
  const a = m.meta?.amount||0;
  const mode = m.meta?.mode||'send';
  return (mode==='send')
    ? `Transfer accepted: ${a} chads sent.`
    : `Transfer accepted: ${a} chads received.`;
}
