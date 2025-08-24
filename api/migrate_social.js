// api/migrate_social.js
import { validateInitData } from './_auth.js';
import { pool } from './_db.js';

const SQL = `
CREATE TABLE IF NOT EXISTS messages(
  id bigserial PRIMARY KEY,
  from_user bigint NOT NULL,
  to_user   bigint NOT NULL,
  text      text NOT NULL,
  kind      text NOT NULL DEFAULT 'text', -- 'text' | 'transfer_request' | 'transfer_accept' | 'system'
  meta      jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_messages_peer ON messages (to_user, from_user, created_at DESC);

CREATE TABLE IF NOT EXISTS chad_transfers(
  id bigserial PRIMARY KEY,
  from_user bigint NOT NULL,
  to_user   bigint NOT NULL,
  amount    numeric(20,0) NOT NULL CHECK (amount > 0),
  mode      text NOT NULL, -- 'send' | 'request'
  status    text NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'declined' | 'cancelled'
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_chad_transfers_peer ON chad_transfers (to_user, from_user, created_at DESC);

CREATE TABLE IF NOT EXISTS tribes(
  id bigserial PRIMARY KEY,
  founder_user bigint NOT NULL,
  name text UNIQUE NOT NULL,
  description text,
  open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tribe_members(
  tribe_id bigint NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  user_id  bigint NOT NULL,
  is_founder boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tribe_id, user_id)
);

CREATE TABLE IF NOT EXISTS tribe_bans(
  tribe_id bigint NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  user_id  bigint NOT NULL,
  banned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tribe_id, user_id)
);

CREATE TABLE IF NOT EXISTS tribe_join_requests(
  id bigserial PRIMARY KEY,
  tribe_id bigint NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  user_id  bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending/approved/rejected
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tribe_messages(
  id bigserial PRIMARY KEY,
  tribe_id bigint NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  user_id  bigint NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export default async function handler(req, res){
  // gate with valid initData but do not block on missing (no leak)
  try{
    const parsed = validateInitData(req.headers['telegram-init-data']||'');
    if (!parsed?.user?.id) { res.statusCode = 401; return res.end(); }
  }catch{}
  try{
    await pool.query(SQL);
    res.setHeader('Cache-Control','no-store');
    res.json({ ok:true });
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, error:'migrate_error' });
  }
}
