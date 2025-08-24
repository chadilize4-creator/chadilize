// api/_schema.js
import { pool } from './_db.js';

// Runs fast; IF NOT EXISTS avoids churn. Safe to call on each request.
export async function ensureCoreTables() {
  const sql = `
  CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    name TEXT,
    avatar_url TEXT,
    points BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    from_id BIGINT NOT NULL,
    to_id   BIGINT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text', -- 'text' | 'transfer_request'
    transfer_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT now(),
    read_by_to BOOLEAN DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS chad_transfers (
    id BIGSERIAL PRIMARY KEY,
    requester_id BIGINT NOT NULL,     -- the user who initiated the request
    counterparty_id BIGINT NOT NULL,  -- the other user
    amount BIGINT NOT NULL CHECK (amount > 0),
    direction TEXT NOT NULL CHECK (direction IN ('send','request')),
    status TEXT NOT NULL DEFAULT 'requested', -- requested|accepted|declined|canceled
    created_at TIMESTAMPTZ DEFAULT now(),
    acted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS tribes (
    id BIGSERIAL PRIMARY KEY,
    founder_id BIGINT NOT NULL,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS tribe_members (
    tribe_id BIGINT REFERENCES tribes(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', -- 'founder'|'member'
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tribe_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tribe_messages (
    id BIGSERIAL PRIMARY KEY,
    tribe_id BIGINT REFERENCES tribes(id) ON DELETE CASCADE,
    from_id BIGINT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, read_by_to);
  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_id, to_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_transfers_status ON chad_transfers(status);
  `;
  await pool.query(sql);
}
