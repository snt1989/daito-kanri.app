// 書類ファイル(PDF・画像)の保管。本体は base64 文字列として Redis に保存
const { authed, pipeline, redis, body } = require("./_lib");
const META = "daito:fmeta", fk = (id) => "daito:file:" + id;
const MAX_B64 = 950000;
const okId = (v) => /^[A-Za-z0-9_\-]{1,100}$/.test(String(v || ""));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const me = authed(req);
  if (!me) return res.status(401).json({ error: { code: "not_granted", message: "ログインが必要です" } });
  const b = body(req);
  try {
    if (b.op === "list") {
      const flat = (await redis(["HGETALL", META])) || [], out = [];
      for (let i = 0; i + 1 < flat.length; i += 2) { try { out.push(JSON.parse(flat[i + 1])); } catch (e) {} }
      out.sort((a, c) => String(c.at || "").localeCompare(String(a.at || "")));
      return res.json({ ok: true, list: out });
    }
    if (b.op === "put") {
      if (!okId(b.id) || typeof b.b64 !== "string" || !b.b64) return res.status(400).json({ error: { code: "bad_request" } });
      if (b.b64.length > MAX_B64) return res.status(413).json({ error: { code: "too_large", message: "ファイルが大きすぎます(約700KBまで)" } });
      const m = b.meta || {};
      const meta = { id: b.id, name: String(m.name || "").slice(0, 120), mime: String(m.mime || "application/octet-stream").slice(0, 60), size: Math.round(b.b64.length * 0.75),
        type: String(m.type || "").slice(0, 40), typeName: String(m.typeName || "").slice(0, 60), summary: String(m.summary || "").slice(0, 120), sender: String(m.sender || "").slice(0, 80),
        date: String(m.date || "").slice(0, 30), at: new Date().toISOString(), by: me.name || "管理者" };
      await pipeline([["SET", fk(b.id), b.b64], ["HSET", META, b.id, JSON.stringify(meta)]]);
      return res.json({ ok: true, meta });
    }
    if (b.op === "get") {
      if (!okId(b.id)) return res.status(400).json({ error: { code: "bad_request" } });
      const r = await pipeline([["GET", fk(b.id)], ["HGET", META, b.id]]);
      if (!r[0]) return res.status(404).json({ error: { code: "not_found", message: "ファイルが見つかりません" } });
      let meta = {}; try { meta = JSON.parse(r[1]); } catch (e) {}
      return res.json({ ok: true, b64: r[0], meta });
    }
    if (b.op === "exists") {
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter(okId).slice(0, 50);
      if (!ids.length) return res.json({ ok: true, have: [] });
      const r = await pipeline(ids.map((i) => ["HEXISTS", META, i]));
      return res.json({ ok: true, have: ids.filter((_, k) => r[k] === 1 || r[k] === "1") });
    }
    if (b.op === "del") {
      if (!okId(b.id)) return res.status(400).json({ error: { code: "bad_request" } });
      await pipeline([["DEL", fk(b.id)], ["HDEL", META, b.id]]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: { code: "bad_request" } });
  } catch (e) {
    res.status(500).json({ error: { code: "upstream_error", message: String(e.message || e).slice(0, 200) } });
  }
};
