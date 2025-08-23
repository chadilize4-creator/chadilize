import { sql } from './_db';
export default async function handler(req, res){
const rows = await sql`
select u.user_id, u.name, u.points, t.name as tribe_name
from users u
left join tribe_members tm on tm.user_id=u.user_id and tm.status='active'
left join tribes t on t.id=tm.tribe_id
order by u.points desc nulls last
limit 100`;
res.json({ ranking: rows });
}
