// /lib/auth.js
export function getUserId(req) {
  // Try header first, then cookie, then query – adapt to your app.
  const h = req.headers;
  const id =
    h['x-user-id'] ||
    (req.cookies && req.cookies.user_id) ||
    (req.query && req.query.user_id);
  if (!id) throw new Error('Unauthorized: missing user id');
  const n = Number(id);
  if (!Number.isFinite(n)) throw new Error('Invalid user id');
  return n;
}
