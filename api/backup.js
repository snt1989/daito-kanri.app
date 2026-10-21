const { authed, body } = require("./_lib");
const bk = require("./_backup");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const me = authed(req);
  if (!me) return res.status(401).json({ error: { code: "not_granted", message: "ログインが必要です" } });
  if (me.role !== "admin") return res.status(403).json({ error: { code: "forbidden", message: "管理者のみ操作できます" } });
  const b = body(req);
  try {
    if (b.op === "list") return res.json({ ok: true, list: await bk.list() });
    if (b.op === "create") return res.json({ ok: true, meta: await bk.snapshot("手動") });
    if (b.op === "get") { const s = await bk.load(b.id); if (!s) return res.status(404).json({ error: { code: "not_found" } }); return res.json({ ok: true, meta: s.meta, data: s.data }); }
    if (b.op === "restore") return res.json({ ok: true, meta: await bk.restore(b.id) });
    if (b.op === "delete") { const L = await bk.list(), m = L.find((x) => x.id === String(b.id)); if (m) await bk.removeOne(m); return res.json({ ok: true }); }
    res.status(400).json({ error: { code: "bad_request" } });
  } catch (e) {
    res.status(500).json({ error: { code: "upstream_error", message: String(e.message || e).slice(0, 200) } });
  }
};
