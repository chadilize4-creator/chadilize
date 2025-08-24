// api/chads.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';
import { ensureCoreTables } from './_schema.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = await readJson(req);
  const { mode, to, amount, transfer_id } = body || {};

  try {
    await ensureCoreTables();

    const parsed = validateInitData(req.headers['telegram-init-data'] || '');
    const me = parsed?.user?.id;
    if (!me) return res.status(401).json({ ok:false, reason:'auth' });

    if (mode === 'request' || mode === 'send') {
      const direction = mode; // 'request' or 'send'
      const amt = Number(amount || 0);
      if (!to || !amt || amt <= 0) return res.status(400).json({ ok:false, reason:'invalid' });

      // create pending transfer + message to counterparty
      const tx = await pool.query(
        `INSERT INTO chad_transfers(requester_id, counterparty_id, amount, direction)
         VALUES ($1,$2,$3,$4) RETURNING id`, [me, to, amt, direction]
      );
      const tid = tx.rows[0].id;

      await pool.query(
        `INSERT INTO messages(from_id,to_id,body,kind,transfer_id)
         VALUES ($1,$2,$3,'transfer_request',$4)`,
        [me, to, JSON.stringify({ direction, amount: amt }), tid]
      );

      return res.json({ ok:true, transfer_id: tid });
    }

    if (mode === 'accept' || mode === 'decline') {
      // fetch transfer
      const r = await pool.query(`SELECT * FROM chad_transfers WHERE id=$1`, [transfer_id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, reason:'not_found' });
      const tr = r.rows[0];
      if (tr.status !== 'requested') return res.status(400).json({ ok:false, reason:'not_request' });

      const isCounterparty = (me == tr.counterparty_id);
      const isRequester    = (me == tr.requester_id);

      // only the counterparty can accept/decline a request
      if (!isCounterparty) return res.status(403).json({ ok:false, reason:'forbidden' });

      if (mode === 'decline') {
        await pool.query(`UPDATE chad_transfers SET status='declined', acted_at=now() WHERE id=$1`, [transfer_id]);
        return res.json({ ok:true, status:'declined' });
      }

      // ACCEPT: move points
      // If direction='send', requester -> counterparty (requester pays).
      // If direction='request', counterparty -> requester (counterparty pays).
      const payer   = (tr.direction === 'send') ? tr.requester_id : tr.counterparty_id;
      const payee   = (tr.direction === 'send') ? tr.counterparty_id : tr.requester_id;
      const amount  = Number(tr.amount);

      await pool.query('BEGIN');
      try {
        const bal = await pool.query(`SELECT points FROM users WHERE user_id=$1 FOR UPDATE`, [payer]);
        const have = Number(bal.rows?.[0]?.points || 0);
        if (have < amount) {
          await pool.query('ROLLBACK');
          return res.status(400).json({ ok:false, reason:'insufficient' });
        }
        await pool.query(`UPDATE users SET points = points - $2 WHERE user_id=$1`, [payer, amount]);
        await pool.query(`UPDATE users SET points = points + $2 WHERE user_id=$1`, [payee, amount]);
        await pool.query(`UPDATE chad_transfers SET status='accepted', acted_at=now() WHERE id=$1`, [transfer_id]);
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK'); throw e;
      }

      return res.json({ ok:true, status:'accepted' });
    }

    return res.status(400).json({ ok:false, reason:'mode' });
  } catch (e) {
    console.error('chads', e);
    res.status(500).json({ ok:false, error:'server' });
  }
}

function readJson(req){
  return new Promise((resolve)=> {
    let data=''; req.on('data', c=> data+=c);
    req.on('end', ()=> { try{ resolve(data? JSON.parse(data):{}); } catch { resolve({}); } });
  });
}
