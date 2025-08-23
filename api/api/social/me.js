import { sql } from './_db';
export default async function handler(req, res){
// Your auth should set req.headers['x-user-id'] to the current player id
const userId = Number(req.headers['x-user-id']||0);
if(!userId) return res.status(401).json({error:'unauthorized'});
const [me] = await sql`select user_id, name, points from users where user_id=${userId}`;
res.json({ me });
}
