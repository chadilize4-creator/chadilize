// api/tribes.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';
import util from './_util.js';
const { readJson } = util;

export default async function handler(req,res){
  const parsed = validateInitData(req.headers['telegram-init-data']||'');
  if (!parsed?.user?.id) return res.status(401).json({ ok:false, error:'auth' });
  const me = parsed.user.id;

  try{
    if (req.method==='GET'){
      if (req.query.list){
        const r = await pool.query(`
          SELECT t.id, t.name, t.description, t.open,
            EXISTS(SELECT 1 FROM tribe_members m WHERE m.tribe_id=t.id AND m.user_id=$1) AS in_tribe
          FROM tribes t
          ORDER BY t.created_at DESC
          LIMIT 300
        `,[me]);
        return res.json({ ok:true, tribes: r.rows });
      }
      if (req.query.my){
        const t = await pool.query(`
          SELECT t.id, t.name, t.description,
                 m.is_founder, m.user_id
          FROM tribes t
          JOIN tribe_members m ON m.tribe_id=t.id
          WHERE m.user_id=$1
        `,[me]);
        if (!t.rowCount) return res.json({ ok:false, error:'no_tribe' });
        const tribe = { id: t.rows[0].id, name: t.rows[0].name, description: t.rows[0].description };
        const meRow = { user_id: me, is_founder: t.rows[0].is_founder };
        const members = (await pool.query(`
          SELECT m.user_id, u.name, m.is_founder
          FROM tribe_members m LEFT JOIN users u ON u.user_id=m.user_id
          WHERE m.tribe_id=$1 ORDER BY m.is_founder DESC, u.name
        `,[tribe.id])).rows;
        const chat = (await pool.query(`SELECT user_id, kind, text, created_at FROM tribe_messages WHERE tribe_id=$1 ORDER BY created_at ASC LIMIT 400`, [tribe.id])).rows;
        return res.json({ ok:true, tribe, me: meRow, members, chat });
      }
      return res.status(400).json({ ok:false, error:'bad_get' });
    }

    if (req.method==='POST'){
      const body = await readJson(req);
      const action = String(body.action||'');

      if (action==='create'){
        const name = (body.name||'').toString().trim().slice(0,32);
        const description = (body.description||'').toString().trim().slice(0,160);
        const open = !!body.open;
        if (!name) return res.json({ ok:false, error:'name_required' });

        await pool.query('BEGIN');
        const ins = await pool.query(
          `INSERT INTO tribes(founder_user,name,description,open) VALUES ($1,$2,$3,$4) RETURNING id`, [me,name,description,open]);
        const id = ins.rows[0].id;
        await pool.query(`INSERT INTO tribe_members(tribe_id,user_id,is_founder) VALUES ($1,$2,true)`, [id,me]);
        await pool.query('COMMIT');
        return res.json({ ok:true, id });
      }

      if (action==='join'){
        const tribe_id = Number(body.tribe_id||0);
        if (!tribe_id) return res.json({ ok:false, error:'bad_input' });
        // open joins directly
        const t = await pool.query(`SELECT open FROM tribes WHERE id=$1`, [tribe_id]);
        if (!t.rowCount) return res.json({ ok:false, error:'not_found' });
        if (!t.rows[0].open) return res.json({ ok:false, error:'not_open' });
        await pool.query(`INSERT INTO tribe_members(tribe_id,user_id) VALUES ($1,$2)
                          ON CONFLICT (tribe_id,user_id) DO NOTHING`, [tribe_id, me]);
        return res.json({ ok:true });
      }

      if (action==='request'){
        const tribe_id = Number(body.tribe_id||0);
        const t = await pool.query(`SELECT open, founder_user FROM tribes WHERE id=$1`, [tribe_id]);
        if (!t.rowCount) return res.json({ ok:false, error:'not_found' });
        if (t.rows[0].open) return res.json({ ok:false, error:'already_open' });
        await pool.query(`INSERT INTO tribe_join_requests(tribe_id,user_id) VALUES ($1,$2)`, [tribe_id, me]);
        // ping founder with system message
        await pool.query(`INSERT INTO messages(from_user,to_user,text,kind,meta)
                          VALUES ($1,$2,$3,'system',$4::jsonb)`,
          [me, t.rows[0].founder_user, 'tribe_join_request', JSON.stringify({ tribe_id })]);
        return res.json({ ok:true });
      }

      if (action==='kick' || action==='ban' || action==='unban'){
        // only founder can do these
        const trib = await pool.query(`SELECT t.id FROM tribes t JOIN tribe_members m ON m.tribe_id=t.id AND m.user_id=$1 AND m.is_founder=true`, [me]);
        if (!trib.rowCount) return res.json({ ok:false, error:'not_founder' });
        const tribe_id = trib.rows[0].id;
        const uid = Number(body.user_id||0);
        if (!uid) return res.json({ ok:false, error:'bad_input' });

        if (action==='kick'){
          await pool.query(`DELETE FROM tribe_members WHERE tribe_id=$1 AND user_id=$2`, [tribe_id, uid]);
        }else if (action==='ban'){
          await pool.query(`INSERT INTO tribe_bans(tribe_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [tribe_id, uid]);
          await pool.query(`DELETE FROM tribe_members WHERE tribe_id=$1 AND user_id=$2`, [tribe_id, uid]);
        }else{
          await pool.query(`DELETE FROM tribe_bans WHERE tribe_id=$1 AND user_id=$2`, [tribe_id, uid]);
        }
        return res.json({ ok:true });
      }

      if (action==='chat_send'){
        const t = await pool.query(`SELECT m.tribe_id FROM tribe_members m WHERE m.user_id=$1`, [me]);
        if (!t.rowCount) return res.json({ ok:false, error:'no_tribe' });
        const text = (body.text||'').toString().trim().slice(0,600);
        if (!text) return res.json({ ok:false, error:'bad_input' });
        await pool.query(`INSERT INTO tribe_messages(tribe_id,user_id,text) VALUES ($1,$2,$3)`, [t.rows[0].tribe_id, me, text]);
        return res.json({ ok:true });
      }

      return res.json({ ok:false, error:'unknown_action' });
    }

    res.status(405).end();
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, error:'server' });
  }
}
