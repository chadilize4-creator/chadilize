// api/ranking.js  (GET)
import { sql } from './_db.js';

export default async function handler(req, res) {
  try {
    const rows = await sql`
      select u.id, u.username, u.avatar_idx, u.chads,
             coalesce(t.name,'-') as tribe
      from users u
      left join tribe_members tm on tm.user_id = u.id and tm.status='active'
      left join tribes t on t.id = tm.tribe_id
      where u.username is not null and u.username <> ''
      order by u.chads desc
      limit 100
    `;
    res.json({ ranking: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}
