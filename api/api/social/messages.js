import { sql } from './_db';
export default async function handler(req, res){
const me = Number(req.headers['x-user-id']||0); if(!me) return res.status(401).end();
if(req.method==='GET'){
if(req.query.with){
const peer = Number(req.query.with);
// mark peer->me unread as read
await sql`update messages set seen=true where recipient_id=${me} and sender_id=${peer} and seen=false`;
const messages = await sql`
select id, sender_id, recipient_id, body, created_at,
case when sender_id=${me} then true else false end as me
from messages
where (sender_id=${me} and recipient_id=${peer}) or (sender_id=${peer} and recipient_id=${me})
order by id asc limit 500`;
const [p] = await sql`select user_id, name from users where user_id=${peer}`;
return res.json({ peer: p, messages });
}
// inbox summary
const threads = await sql`
with last_msg as (
select distinct on (least(sender_id,recipient_id), greatest(sender_id,recipient_id))
least(sender_id,recipient_id) as a,
greatest(sender_id,recipient_id) as b,
id, sender_id, recipient_id, body, created_at
from messages
where sender_id=${me} or recipient_id=${me}
order by least(sender_id,recipient_id), greatest(sender_id,recipient_id), id desc
)
select u.user_id, u.name,
(select count(*) from messages m where m.recipient_id=${me} and m.sender_id=u.user_id and m.seen=false) as unread
from last_msg lm
join users u on u.user_id = case when lm.a=${me} then lm.b else lm.a end
order by lm.id desc`;
return res.json({ threads });
}
if(req.method==='POST'){
const { to, body } = req.body||{}; if(!to||!body) return res.status(400).json({error:'bad'});
await sql`insert into messages (sender_id, recipient_id, body) values (${me}, ${to}, ${body})`;
return res.json({ ok:true });
}
res.status(405).end();
}
