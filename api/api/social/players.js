import { sql } from './_db';
export default async function handler(req, res){
const q = (req.query.q||'').trim();
const where = q ? sql`where name ilike ${'%' + q + '%'}` : sql``;
const rows = await sql`select user_id, name, points, avatar_url from users ${where} order by name asc limit 200`;
res.json({ players: rows });
}
