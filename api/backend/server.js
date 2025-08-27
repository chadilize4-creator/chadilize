import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import pkg from 'pg';

const { Pool } = pkg;

// Postgres (Neon) — Pool uses SSL via the connection string (?sslmode=require)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors());
app.use(express.json());

/* ----------------------- tiny helpers ----------------------- */
const q = async (text, params=[]) => (await pool.query(text, params)).rows;
const dmRoomOf = (a, b) => {
  const [x,y] = [a,b].sort();
  return `dm:${x}:${y}`;
};

/* -------------------------- REST ---------------------------- */
app.post('/users/upsert', async (req, res) => {
  const username = (req.body.username || 'Player').slice(0, 40);
  const rows = await q(
    `insert into users(username)
     values ($1)
     on conflict (username) do update set username=excluded.username
     returning id, username`, [username]
  );
  // ensure wallet row
  await q(`insert into wallets(user_id) values ($1) on conflict do nothing`, [rows[0].id]);
  res.json(rows[0]);
});

app.get('/messages/group', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit||'60', 10), 200);
  const rows = await q(
    `select id, sender_id, sender_name, body, created_at
     from messages where room='group'
     order by created_at desc
     limit $1`, [limit]
  );
  res.json(rows.reverse());
});

app.get('/friends/:userId', async (req, res) => {
  const userId = req.params.userId;
  const rows = await q(
    `select u.id, u.username
       from friends f
       join users u on u.id = f.friend_id
      where f.user_id = $1
      order by u.username asc`, [userId]
  );
  res.json(rows);
});

app.post('/friends/add', async (req, res) => {
  const { userId, friendId } = req.body;
  if (!userId || !friendId || userId === friendId) return res.sendStatus(400);
  await q(`insert into friends(user_id, friend_id) values ($1,$2) on conflict do nothing`, [userId, friendId]);
  await q(`insert into friends(user_id, friend_id) values ($1,$2) on conflict do nothing`, [friendId, userId]);
  res.json({ ok: true });
});

app.get('/messages/dm', async (req, res) => {
  const { userId, peerId } = req.query;
  const limit = Math.min(parseInt(req.query.limit||'60', 10), 200);
  if (!userId || !peerId) return res.sendStatus(400);
  const room = dmRoomOf(userId, peerId);
  const rows = await q(
    `select id, sender_id, sender_name, body, created_at
       from messages
      where room = $1
      order by created_at desc
      limit $2`, [room, limit]
  );
  res.json(rows.reverse());
});

app.post('/chads/send', async (req, res) => {
  const { fromId, toId, amount } = req.body;
  if (!fromId || !toId || !Number.isFinite(+amount) || +amount <= 0) return res.sendStatus(400);
  await q(`insert into chad_transactions(sender_id, receiver_id, amount) values ($1,$2,$3)`,
          [fromId, toId, +amount]);
  // (Optional) server-side balance: uncomment to enforce balances
  // await q(`update wallets set balance = balance - $2 where user_id=$1`, [fromId, +amount]);
  // await q(`update wallets set balance = balance + $2 where user_id=$1`, [toId, +amount]);
  res.json({ ok: true });
});

/* ------------------------ Socket.IO ------------------------- */
/**
 * We use Socket.IO for realtime group + DMs.
 * The official docs show the same primitives: server init, rooms, and events. :contentReference[oaicite:1]{index=1}
 */
const httpServer = createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: '*' }
});

// Track sockets by user id
const socketsByUser = new Map();

io.use((socket, next) => {
  const { userId, username } = socket.handshake.auth || {};
  if (!userId || !username) return next(new Error('unauthorized'));
  socket.userId = userId;
  socket.username = username;
  next();
});

io.on('connection', async (socket) => {
  // Map
  const set = socketsByUser.get(socket.userId) || new Set();
  set.add(socket.id);
  socketsByUser.set(socket.userId, set);

  socket.on('disconnect', () => {
    const s = socketsByUser.get(socket.userId);
    if (s) { s.delete(socket.id); if (!s.size) socketsByUser.delete(socket.userId); }
  });

  socket.on('join-group', () => socket.join('group'));

  socket.on('group:send', async ({ body }) => {
    const text = (body||'').slice(0,300);
    if (!text) return;
    const rows = await q(
      `insert into messages(room, sender_id, sender_name, body)
       values ('group', $1, $2, $3)
       returning id, sender_id, sender_name, body, created_at`,
       [socket.userId, socket.username, text]
    );
    io.to('group').emit('group:new', rows[0]); // broadcast to everyone in group
  });

  socket.on('dm:send', async ({ toId, body }) => {
    const text = (body||'').slice(0,300);
    if (!text || !toId) return;
    const room = dmRoomOf(socket.userId, toId);
    const rows = await q(
      `insert into messages(room, sender_id, sender_name, body)
       values ($1, $2, $3, $4)
       returning id, sender_id, sender_name, body, created_at`,
       [room, socket.userId, socket.username, text]
    );
    const msg = rows[0];
    // emit to both participants if connected
    const emitToUser = (uid) => {
      const ids = socketsByUser.get(uid);
      if (ids) ids.forEach(sid => io.to(sid).emit('dm:new', msg));
    };
    emitToUser(socket.userId);
    emitToUser(toId);
  });
});

/* -------------------------- START --------------------------- */
const port = process.env.PORT || 8080;
httpServer.listen(port, () => {
  console.log('Server listening on :' + port);
});
