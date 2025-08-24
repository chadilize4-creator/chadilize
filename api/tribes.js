// api/tribes.js
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
      const mode = String(req.query.mode || 'list');

      if (mode === 'mine') {
        const tribe = (await pool.query(`
          SELECT t.*, tm.role
          FROM tribe_members tm
          JOIN tribes t ON t.id = tm.tribe_id
          WHERE tm.user_id=$1 AND tm.banned=false
          LIMIT 1
        `, [me])).rows[0];

        let members = [], msgs = [];
        if (tribe) {
          members = (await pool.query(`
            SELECT tm.user_id, tm.role, u.name, u.avatar_url
            FROM tribe_members tm
            JOIN users u ON u.user_id = tm.user_id
            WHERE tm.tribe_id=$1 AND tm.banned=false
            ORDER BY (tm.role='founder') DESC, lower(u.name) ASC
          `, [tribe.id])).rows;

          msgs = (await pool.query(`
            SELECT m.id, m.from_id, u.name AS from_name, m.body, m.created_at
            FROM tribe_messages m
            JOIN users u ON u.user_id=m.from_id
            WHERE m.tribe_id=$1
            ORDER BY m.created_at ASC
            LIMIT 200
          `, [tribe.id])).rows;
        }
        return res.json({ ok:true, tribe, members, messages: msgs });
      }

      // list (public & private, basic info + member count)
      const q = (req.query.q || '').trim();
      const rows = (await pool.query(`
        SELECT t.id, t.name, t.description, t.is_public, t.founder_id,
               (SELECT count(*) FROM tribe_members tm WHERE tm.tribe_id=t.id AND tm.banned=false) AS members
        FROM tribes t
        WHERE ($1 = '' OR lower(t.name) LIKE lower($2))
        ORDER BY lower(t.name) ASC
        LIMIT 200
      `, [q, `%${q}%`])).rows;

      return res.json({ ok:true, tribes: rows });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const { mode } = body || {};

      if (mode === 'create') {
        const { name, description='', visibility='public' } = body;
        if (!name || String(name).length > 40) return res.status(400).json({ ok:false, reason:'name' });
        if (String(description).length > 160) return res.status(400).json({ ok:false, reason:'desc' });

        const r = await pool.query(
          `INSERT INTO tribes(name, description, is_public, founder_id)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [name.trim(), description.trim(), visibility !== 'requested', me]
        );
        const id = r.rows[0].id;
        await pool.query(
          `INSERT INTO tribe_members(tribe_id,user_id,role) VALUES ($1,$2,'founder')`,
          [id, me]
        );
        return res.json({ ok:true, id });
      }

      if (mode === 'join') {
        const { tribe_id } = body;
        if (!tribe_id) return res.status(400).json({ ok:false, reason:'id' });

        const t = (await pool.query(`SELECT is_public FROM tribes WHERE id=$1`, [tribe_id])).rows[0];
        if (!t) return res.status(404).json({ ok:false, reason:'not_found' });

        if (t.is_public) {
          await pool.query(`INSERT INTO tribe_members(tribe_id,user_id,role)
                            VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [tribe_id, me]);
          return res.json({ ok:true, joined:true });
        } else {
          // requested tribe – DM founder
          const founder = (await pool.query(`SELECT founder_id FROM tribes WHERE id=$1`, [tribe_id])).rows[0].founder_id;
          await pool.query(
            `INSERT INTO messages(from_id,to_id,body,kind) VALUES ($1,$2,$3,'text')`,
            [me, founder, JSON.stringify({ type:'join_request', tribe_id })]
          );
          return res.json({ ok:true, requested:true });
        }
      }

      if (mode === 'post_message') {
        const { tribe_id, text } = body;
        if (!tribe_id || !text) return res.status(400).json({ ok:false, reason:'bad' });

        const mem = await pool.query(`SELECT 1 FROM tribe_members WHERE tribe_id=$1 AND user_id=$2 AND banned=false`, [tribe_id, me]);
        if (!mem.rowCount) return res.status(403).json({ ok:false, reason:'not_member' });

        const r = await pool.query(
          `INSERT INTO tribe_messages(tribe_id, from_id, body) VALUES ($1,$2,$3) RETURNING id, created_at`,
          [tribe_id, me, String(text).slice(0,1200)]
        );
        return res.json({ ok:true, id:r.rows[0].id, created_at:r.rows[0].created_at });
      }

      if (mode === 'admin') {
        // founder moderation: kick/ban/unban
        const { tribe_id, action, user_id } = body;
        const founder = await pool.query(`SELECT 1 FROM tribe_members WHERE tribe_id=$1 AND user_id=$2 AND role='founder'`, [tribe_id, me]);
        if (!founder.rowCount) return res.status(403).json({ ok:false, reason:'no_rights' });

        if (action === 'kick') {
          await pool.query(`DELETE FROM tribe_members WHERE tribe_id=$1 AND user_id=$2`, [tribe_id, user_id]);
          return res.json({ ok:true });
        }
        if (action === 'ban') {
          await pool.query(`UPDATE tribe_members SET banned=true WHERE tribe_id=$1 AND user_id=$2`, [tribe_id, user_id]);
          return res.json({ ok:true });
        }
        if (action === 'unban') {
          await pool.query(`UPDATE tribe_members SET banned=false WHERE tribe_id=$1 AND user_id=$2`, [tribe_id, user_id]);
          return res.json({ ok:true });
        }
        return res.status(400).json({ ok:false, reason:'action' });
      }

      return res.status(400).json({ ok:false, reason:'mode' });
    }

    res.status(405).end();
  } catch (e) {
    console.error('tribes', e);
    res.status(500).json({ ok:false, error:'server' });
  }
}

function readJson(req){
  return new Promise((resolve)=> {
    let data=''; req.on('data', c=> data+=c);
    req.on('end', ()=> { try{ resolve(data? JSON.parse(data):{}); } catch { resolve({}); } });
  });
}
