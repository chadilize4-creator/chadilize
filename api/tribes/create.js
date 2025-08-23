// api/tribes/create.js  (POST)
import { sql } from '../_db.js';

export default async function handler(req, res){
  try{
    if (req.method !== 'POST') return res.status(405).end();
    const { founderId, name, description, isRequestBased } = req.body||{};
    if (!founderId || !name) return res.status(400).json({ ok:false, reason:'missing data' });
    if ((description||'').length > 160) return res.status(400).json({ ok:false, reason:'desc-too-long' });

    const [tribe] = await sql`
      insert into tribes (name, description, is_request_based, founder_id)
      values (${name}, ${description||''}, ${!!isRequestBased}, ${founderId})
      returning id, name, description, is_request_based
    `;
    await sql`
      insert into tribe_members (tribe_id, user_id, role, status)
      values (${tribe.id}, ${founderId}, 'founder', 'active')
      on conflict do nothing
    `;
    res.json({ ok:true, tribe });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
}
