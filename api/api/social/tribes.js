import { sql } from './_db';
export default async function handler(req, res){
const me = Number(req.headers['x-user-id']||0); if(!me) return res.status(401).end();
if(req.method==='GET'){
if(req.query.mine){
const [tribe] = await sql`select t.* from tribe_members tm join tribes t on t.id=tm.tribe_id where tm.user_id=${me} and tm.status='active' limit 1`;
return res.json({ tribe: tribe||null });
}
if(req.query.members){
const id = Number(req.query.members);
const members = await sql`select u.user_id, u.name, tm.role, tm.status from tribe_members tm join users u on u.user_id=tm.user_id where tm.tribe_id=${id} order by tm.role desc, u.name`;
return res.json({ members });
}
const rows = await sql`select id, name, description, is_request_based from tribes order by created_at desc limit 200`;
return res.json({ tribes: rows });
}


if(req.method==='POST'){
const { action } = req.body||{};
if(action==='create'){
const { name, description, is_request_based } = req.body; if(!name) return res.status(400).end();
if(description && description.length>160) return res.status(400).json({error:'desc>160'});
const [{id}] = await sql`insert into tribes (name, description, is_request_based, founder_id) values (${name}, ${description||''}, ${!!is_request_based}, ${me}) returning id`;
await sql`insert into tribe_members (tribe_id, user_id, role, status) values (${id}, ${me}, 'founder','active')`;
return res.json({ ok:true, id });
}
if(action==='join'){
const { id } = req.body; const [t] = await sql`select * from tribes where id=${id}`;
if(!t) return res.status(404).end(); if(t.is_request_based) return res.status(400).json({error:'request-only'});
await sql`insert into tribe_members (tribe_id, user_id, role, status) values (${id}, ${me}, 'member','active') on conflict (tribe_id,user_id) do update set status='active'`;
return res.json({ ok:true });
}
if(action==='request'){
const { id } = req.body; await sql`insert into tribe_join_requests (tribe_id, requester_id, status) values (${id}, ${me}, 'pending') on conflict do nothing`;
return res.json({ ok:true });
}
if(action==='kick' || action==='ban' || action==='unban'){
const { id, user } = req.body; // tribe id, target user id
const [meRole] = await sql`select role from tribe_members where tribe_id=${id} and user_id=${me}`;
if(!meRole || (meRole.role!=='founder')) return res.status(403).end();
if(action==='kick') await sql`delete from tribe_members where tribe_id=${id} and user_id=${user}`;
if(action==='ban') await sql`update tribe_members set status='banned' where tribe_id=${id} and user_id=${user}`;
if(action==='unban') await sql`update tribe_members set status='active' where tribe_id=${id} and user_id=${user}`;
return res.json({ ok:true });
}
}
res.status(405).end();
}
