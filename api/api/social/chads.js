import { sql } from './_db';
export default async function handler(req, res){
const me = Number(req.headers['x-user-id']||0); if(!me) return res.status(401).end();
if(req.method!=='POST') return res.status(405).end();
const { action, to, amount, id } = req.body||{};
if(action==='request'){
if(!to||!amount) return res.status(400).end();
const [{id:reqId}] = await sql`insert into chad_transfers (from_user_id, to_user_id, amount, status)
values (${to}, ${me}, ${amount}, 'requested') returning id`;
await sql`insert into messages (sender_id, recipient_id, body) values (${me}, ${to}, ${'Requested ' + amount + ' chads'})`;
return res.json({ ok:true, id:reqId });
}
if(action==='send'){
if(!to||!amount) return res.status(400).end();
const [{id:tx}] = await sql`insert into chad_transfers (from_user_id, to_user_id, amount, status)
values (${me}, ${to}, ${amount}, 'pending') returning id`;
await sql`insert into messages (sender_id, recipient_id, body) values (${me}, ${to}, ${'Wants to send ' + amount + ' chads'})`;
return res.json({ ok:true, id:tx });
}
if(action==='accept'){
// accept a transfer request
// id refers to chad_transfers.id
const [row] = await sql`select * from chad_transfers where id=${id} for update`;
if(!row) return res.status(404).end();
if(row.status!=='requested' && row.status!=='pending') return res.status(400).end();
// money flow: from -> to (positive for recipient)
const from = row.from_user_id, toU = row.to_user_id, amt = row.amount;
await sql.begin(async (tx)=>{
await tx`update users set points = points - ${amt} where user_id=${from}`;
await tx`update users set points = points + ${amt} where user_id=${toU}`;
await tx`update chad_transfers set status='accepted', decided_at=now() where id=${id}`;
});
return res.json({ ok:true });
}
if(action==='decline'){
await sql`update chad_transfers set status='declined', decided_at=now() where id=${id}`;
return res.json({ ok:true });
}
res.status(400).end();
}
