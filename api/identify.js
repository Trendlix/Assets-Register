// Proxies photo identification / value estimation to the Anthropic API.
// Needs ANTHROPIC_API_KEY in the Vercel project environment.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const OK_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: "ANTHROPIC_API_KEY not set" });

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt || prompt.length > 8000) return res.status(400).json({ error: "bad prompt" });
  if (!Array.isArray(images) || images.length > 4) return res.status(400).json({ error: "too many images" });
  for (const im of images) {
    if (!im || !OK_MEDIA.has(im.media) || typeof im.data !== "string" || im.data.length > 3_000_000) return res.status(415).json({ error: "bad image" });
  }

  const content = [
    ...images.map(im => ({ type: "image", source: { type: "base64", media_type: im.media, data: im.data } })),
    { type: "text", text: prompt + "\n\nReply with the JSON object only, no prose and no code fences." }
  ];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content }] })
    });
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: "upstream " + r.status });
    const j = await r.json();
    const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: "no json" });
    res.status(200).json(JSON.parse(m[0]));
  } catch (e) {
    res.status(502).json({ error: "failed" });
  }
};
