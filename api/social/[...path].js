// api/social/[...path].js
import { query } from '../../lib/db.js';
import { getUserId } from '../../lib/auth.js';

export default async function handler(req, res) {
  try {
    const userId = getUserId(req);              // throws on missing/invalid
    const method = req.method.toUpperCase();
    const path = (req.query.path || []).join('/');   // e.g. "players", "messages", "tribes/create"
    const body = req.body && typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    res.setHeader('Content-Type', 'application/json');

    // ---------- ROUTER ----------
    if (method === 'GET' && path === 'players') return listPlayers(req, res, userId);
    if (method === 'GET' && path === 'ranking') return getRanking(req, res);
    if (method === 'GET' && path === 'messages') return listThreads(req, res, userId);
    if (method === 'POST' && path === 'messages/send') return sendMessage(req, res, userId, body);

    if (method === 'POST' && path === 'chads/request') return requestChads(req, res, userId, body);  // ask other user to send you chads
    if (method === 'POST' && path === 'chads/send')    return requestSendChads(req, res, userId, body); // you propose to send chads
    if (method === 'POST' && path === 'chads/act')     return actOnChadsRequest(req, res, userId, body); // accept/decline

    // Tribes
    if (method === 'GET'  && path === 'tribes')        return listTribes(req, res);
    if (method === 'GET'  && path === 'tribes/mine')   return getMyTribe(req, res, userId);
    if (method === 'POST' && path === 'tribes/create') return createTribe(req, res, userId, body);
    if (method === 'POST' && path === 'tribes/join')   return joinTribe(req, res, userId, body);
    if (method === 'POST' && path === 'tribes/respond')return respondJoin(req, res, userId, body);
    if (method === 'POST' && path === 'tribes/kick')   return kickMember(req, res, userId, body);
    if (method === 'POST' && path === 'tribes/ban')    return banMember(req, res, userId, body);

    res.status(404).json({ ok: false, error: 'Not found', path, method });
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
}

// ====== HANDLERS ======

async function listPlayers(req, res) {
  const search = (req.query.search || '').trim();
  const rows = search
    ? await query(
        `SELECT user_id, name, points, gen_per_hour, level, COALESCE(avatar_url,'') avatar_url
         FROM users WHERE LOWER(name) LIKE LOWER($1) ORDER BY name ASC LIMIT 200`,
        [`%${search}%`]
      )
    : await query(
        `SELECT user_id, name, points, gen_per_hour, level, COALESCE(avatar_url,'') avatar_url
         FROM users WHERE name IS NOT NULL ORDER BY name ASC LIMIT 200`
      );
  res.json({ ok: true, players: rows });
}

async function getRanking(req, res) {
  const rows = await query(
    `SELECT u.user_id, u.name, u.points, COALESCE(t.name,'') tribe_name
     FROM users u
     LEFT JOIN tribe_members tm ON tm.user_id = u.user_id AND tm.role IN ('founder','member')
     LEFT JOIN tribes t ON t.id = tm.tribe_id
     ORDER BY u.points DESC NULLS LAST, u.user_id ASC
     LIMIT 100`
  );
  res.json({ ok: true, ranking: rows });
}

// ----- MESSAGES -----
async function listThreads(req, res, userId) {
  const rows = await query(
    `SELECT other_id, other_name, last_text, last_at, unread
     FROM dm_threads($1)`, [userId]
  );
  res.json({ ok: true, threads: rows });
}

async function sendMessage(req, res, userId, { to_user_id, text }) {
  if (!to_user_id || !text || !text.trim()) throw new Error('to_user_id and text required');
  const [row] = await query(
    `SELECT * FROM send_dm($1,$2,$3)`,
    [userId, Number(to_user_id), text.trim().slice(0, 2000)]
  );
  res.json({ ok: true, message_id: row.message_id });
}

// ----- CHADS TRANSFERS (REQUEST FLOW) -----
async function requestChads(req, res, userId, { from_user_id, amount }) {
  // You want to RECEIVE amount from from_user_id
  if (!from_user_id || !amount || amount <= 0) throw new Error('from_user_id and positive amount required');
  const [r] = await query(`SELECT * FROM create_chads_request($1,$2,$3,'receive')`, [userId, Number(from_user_id), Number(amount)]);
  res.json({ ok: true, request: r });
}

async function requestSendChads(req, res, userId, { to_user_id, amount }) {
  // You PROPOSE to SEND amount to to_user_id
  if (!to_user_id || !amount || amount <= 0) throw new Error('to_user_id and positive amount required');
  const [r] = await query(`SELECT * FROM create_chads_request($1,$2,$3,'send')`, [userId, Number(to_user_id), Number(amount)]);
  res.json({ ok: true, request: r });
}

async function actOnChadsRequest(req, res, userId, { request_id, accept }) {
  if (!request_id) throw new Error('request_id required');
  const [r] = await query(`SELECT * FROM act_on_chads_request($1,$2,$3)`, [userId, Number(request_id), !!accept]);
  res.json({ ok: true, result: r });
}

// ----- TRIBES -----
async function listTribes(req, res) {
  const rows = await query(
    `SELECT t.id, t.name, t.description, t.is_request_based, t.founder_id,
            COALESCE(m.cnt,0)::int AS members
     FROM tribes t
     LEFT JOIN LATERAL (SELECT COUNT(*)::int cnt FROM tribe_members WHERE tribe_id=t.id) m ON TRUE
     ORDER BY t.name ASC LIMIT 500`
  );
  res.json({ ok: true, tribes: rows });
}

async function getMyTribe(req, res, userId) {
  const [row] = await query(
    `SELECT t.*, tm.role
       FROM tribe_members tm
       JOIN tribes t ON t.id = tm.tribe_id
      WHERE tm.user_id = $1
      LIMIT 1`, [userId]
  );
  if (!row) return res.json({ ok: true, tribe: null });
  const members = await query(
    `SELECT u.user_id, u.name, tm.role
       FROM tribe_members tm
       JOIN users u ON u.user_id = tm.user_id
      WHERE tm.tribe_id = $1
      ORDER BY (tm.role='founder') DESC, u.name ASC`, [row.id]
  );
  res.json({ ok: true, tribe: row, members });
}

async function createTribe(req, res, userId, { name, description, is_request_based }) {
  if (!name || !name.trim()) throw new Error('name required');
  const [t] = await query(
    `INSERT INTO tribes (name, description, is_request_based, founder_id)
     VALUES ($1, LEFT($2,160), COALESCE($3,true), $4)
     RETURNING *`,
    [name.trim(), description || '', is_request_based !== false, userId]
  );
  await query(`INSERT INTO tribe_members (tribe_id, user_id, role) VALUES ($1,$2,'founder') ON CONFLICT DO NOTHING`, [t.id, userId]);
  res.json({ ok: true, tribe: t });
}

async function joinTribe(req, res, userId, { tribe_id }) {
  if (!tribe_id) throw new Error('tribe_id required');
  const [t] = await query(`SELECT * FROM tribes WHERE id=$1`, [tribe_id]);
  if (!t) throw new Error('Tribe not found');

  if (t.is_request_based) {
    const [jr] = await query(
      `INSERT INTO tribe_join_requests (tribe_id, user_id, status)
       VALUES ($1,$2,'pending')
       ON CONFLICT (tribe_id, user_id) DO UPDATE SET status='pending'
       RETURNING *`, [tribe_id, userId]
    );
    return res.json({ ok: true, requested: true, join_request: jr });
  } else {
    await query(
      `INSERT INTO tribe_members (tribe_id, user_id, role)
       VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [tribe_id, userId]
    );
    return res.json({ ok: true, joined: true });
  }
}

async function respondJoin(req, res, userId, { join_request_id, accept }) {
  const [jr] = await query(
    `UPDATE tribe_join_requests jr
        SET status = CASE WHEN $2 THEN 'accepted' ELSE 'rejected' END
      WHERE jr.id=$1
      AND EXISTS (SELECT 1 FROM tribes t WHERE t.id=jr.tribe_id AND t.founder_id=$3)
      RETURNING *`, [Number(join_request_id), !!accept, userId]
  );
  if (!jr) throw new Error('Not found or not authorized');
  if (accept) {
    await query(`INSERT INTO tribe_members (tribe_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [jr.tribe_id, jr.user_id]);
  }
  res.json({ ok: true });
}

async function kickMember(req, res, userId, { tribe_id, member_id }) {
  await query(
    `DELETE FROM tribe_members tm
      USING tribes t
      WHERE tm.tribe_id=$1 AND tm.user_id=$2 AND t.id=tm.tribe_id AND t.founder_id=$3 AND tm.role <> 'founder'`,
    [Number(tribe_id), Number(member_id), userId]
  );
  res.json({ ok: true });
}

async function banMember(req, res, userId, { tribe_id, member_id, banned = true }) {
  await query(
    `UPDATE tribe_members tm
       SET is_banned = $4
      FROM tribes t
     WHERE tm.tribe_id=$1 AND tm.user_id=$2 AND t.id=tm.tribe_id AND t.founder_id=$3
       AND tm.role <> 'founder'`,
    [Number(tribe_id), Number(member_id), userId, !!banned]
  );
  res.json({ ok: true });
}
