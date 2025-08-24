// /lib/db.js
// Neon over HTTP = perfect for serverless
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL env var is required');
}

export const sql = neon(process.env.DATABASE_URL);

// helper
export async function query(text, params = []) {
  return sql(text, params);
}
