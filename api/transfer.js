// api/transfer.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';
import util from './_util.js';
const { readJson } = util;

export default async function handler(req,res){
  if (req.method!=='POST') return res.status(405).end();
  const parsed = validateInitData(req.headers['telegram-init-data']||'');
  if (!parsed?.user?.id) return res.status(401).json({ ok:false, error:'auth' });
  const me = parsed.user.id;

  try{
    const body = await readJson(req);
    const action = String(body.action||'');
    if (action==='create'){
      const to = Number(body.to||0);
      const amount = Math.floor(Number(body.amount||0));
      const mode = (body.mode==='request') ? 'request' : 'send';
      if (!to || !amount || amount<=0) return res.json({ ok:false, error:'bad_input' });

      const myName = await nameOf(me);
      await pool.query('BEGIN');
      const ins = await pool.query(`
        INSERT INTO chad_transfers(from_user,to_user,amount,mode,status)
        VALUES ($1,$2,$3,$4,'pending') RETURNING id
      `,[me,to,amount,mode]);
      // leave a system message to peer
      await pool.query(`
        INSERT INTO messages(from_user,to_user,text,kind,meta)
        VALUES ($1,$2,$3,'transfer_request', $4::jsonb)
      `,[me,to,'transfer_request', JSON.stringify({ amount, mode, actor_name: myName })]);
      await pool.query('COMMIT');
      return res.json({ ok:true, id: ins.rows[0].id });
    }

    if (action==='accept'){
      const id = Number(body.id||0);
      if (!id) return res.json({ ok:false, error:'bad_input' });

      await pool.query('BEGIN');

      const t = await pool.query(`SELECT * FROM chad_transfers WHERE id=$1 FOR UPDATE`, [id]);
      if (!t.rowCount){ await pool.query('ROLLBACK'); return res.json({ ok:false, error:'not_found' }); }
      const tr = t.rows[0];
      if (tr.status!=='pending'){ await pool.query('ROLLBACK'); return res.json({ ok:false, error:'not_pending' }); }

      // who must accept?
      // mode=send -> recipient accepts; mode=request -> requester wants to receive, so sender (the other user) must accept
      const mustBe = (tr.mode==='send') ? tr.to_user : tr.from_user;
      if (mustBe !== me){ await pool.query('ROLLBACK'); return res.json({ ok:false, error:'forbidden' }); }

      const sender = (tr.mode==='send') ? tr.from_user : tr.to_user;
      const receiver = (tr.mode==='send') ? tr.to_user : tr.from_user;
      const amount = Number(tr.amount);

      // ensure sender has enough points
      const bal = await pool.query(`SELECT COALESCE(points,0) AS p FROM users WHERE user_id=$1 FOR UPDATE`, [sender]);
      const have = Number(bal.rows[0]?.p||0);
      if (have < amount){
        await pool.query(`UPDATE chad_transfers SET status='declined', decided_at=now() WHERE id=$1`, [id]);
        await pool.query('COMMIT');
        return res.json({ ok:false, error:'not_enough_chads' });
      }

      await pool.query(`UPDATE users SET points=points-$1 WHERE user_id=$2`, [amount, sender]);
      await pool.query(`
        INSERT INTO users(user_id, points) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET points = users.points + EXCLUDED.points
      `, [receiver, amount]);

      await pool.query(`UPDATE chad_transfers SET status='accepted', decided_at=now() WHERE id=$1`, [id]);

      // system accept message both ways
      const meta = { amount, mode: tr.mode };
      await pool.query(`INSERT INTO messages(from_user,to_user,text,kind,meta) VALUES ($1,$2,$3,'transfer_accept',$4::jsonb)`,
        [receiver, sender, 'transfer_accept', JSON.stringify(meta)]);
      await pool.query(`INSERT INTO messages(from_user,to_user,text,kind,meta) VALUES ($1,$2,$3,'transfer_accept',$4::jsonb)`,
        [sender, receiver, 'transfer_accept', JSON.stringify(meta)]);

      await pool.query('COMMIT');
      return res.json({ ok:true });
    }

    if (action==='decline'){
      const id = Number(body.id||0);
      await pool.query(`UPDATE chad_transfers SET status='declined', decided_at=now() WHERE id=$1 AND (to_user=$2 OR from_user=$2)`, [id,me]);
      return res.json({ ok:true });
    }

    return res.json({ ok:false, error:'unknown_action' });
  }catch(e){
    try{ await pool.query('ROLLBACK'); }catch{}
    console.error(e); res.status(500).json({ ok:false, error:'server' });
  }
}

async function nameOf(uid){
  try{ const r = await pool.query(`SELECT name FROM users WHERE user_id=$1`, [uid]); return r.rows[0]?.name || 'player'; }
  catch{ return 'player'; }
}
