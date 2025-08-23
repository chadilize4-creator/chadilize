// api/players.js  (GET ?q=search)
import { sql } from './_db.js';

export default async function handler(req, res) {
  try {
    const q = (req.query.q || '').toLowerCase();
    const like = q ? `%${q}%` : '%';
    const rows = await sql`
      select u.id, u.username, u.avatar_idx, u.chads,
             coalesce(t.name,'-') as tribe
      from users u
      left join tribe_members tm on tm.user_id = u.id and tm.status='active'
      left join tribes t on t.id = tm.tribe_id
      where u.username is not null
        and u.username <> ''
        and u.last_active > now() - interval '14 days'
        and lower(u.username) like ${like}
      order by u.last_active desc
      limit 200
    `;
    res.json({ players: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}
