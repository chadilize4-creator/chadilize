// api/_db.js
import pkg from 'pg';
import { neon } from '@neondatabase/serverless';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // needed for Neon in serverless
});
export const sql = neon(process.env.DATABASE_URL); // set in Vercel env
