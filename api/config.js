// Public browser config (the anon key is designed to be public; access is governed by RLS).
module.exports = (req, res) => {
  const url = process.env.SUPABASE_URL, anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(500).json({ error: "Supabase env vars are not set" });
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ url, anonKey });
};
