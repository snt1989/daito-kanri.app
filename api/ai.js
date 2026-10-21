// 書類読み取り: 画像+指示を Claude API(Messages)へ中継して本文を返す
const { authed, body } = require("./_lib");
const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!authed(req)) return res.status(401).json({ error: { code: "not_granted", message: "ログインが必要です" } });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: { code: "capability_disabled", message: "ANTHROPIC_API_KEY が設定されていません" } });
  const b = body(req);
  const content = [];
  (Array.isArray(b.images) ? b.images : []).slice(0, 6).forEach((d) => {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: String(d) } });
  });
  content.push({ type: "text", text: String(b.prompt || "") });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || MODELS[b.tier] || MODELS.default,
        max_tokens: 8000,
        system: "あなたは書類の読み取り担当です。指示された形式の出力だけを返し、前置きや説明は書かないでください。",
        messages: [{ role: "user", content }],
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      const code = r.status === 429 ? "rate_limited" : r.status === 401 || r.status === 403 ? "capability_disabled" : "upstream_error";
      return res.status(r.status === 429 ? 429 : 502).json({ error: { code, message: String((j.error && j.error.message) || r.status).slice(0, 200) } });
    }
    const text = (j.content || []).filter((x) => x.type === "text").map((x) => x.text).join("");
    res.json({ text, truncated: j.stop_reason === "max_tokens" });
  } catch (e) {
    res.status(502).json({ error: { code: "upstream_error", message: String(e.message || e).slice(0, 200) } });
  }
};
