// ロゴ・アプリアイコン。設定画面(管理者)で作った画像を Redis の daito:brand(Hash)に保存し、
// GET /api/brand?s=192|512|180|m512 で画像、GET /api/brand?manifest=1 でアプリの manifest を返す(公開)
const { authed, pipeline, body } = require("./_lib");
const KEY = "daito:brand";
const SIZES = { "192": "i192", "512": "i512", "180": "i180", m512: "m512" };
const FALLBACK = { "192": "/icons/icon-192.png", "512": "/icons/icon-512.png", "180": "/icons/apple-touch-icon.png", m512: "/icons/maskable-512.png" };
const b64ok = (s) => typeof s === "string" && /^[A-Za-z0-9+/=]+$/.test(s) && s.length < 1400000;

module.exports = async (req, res) => {
  const q = req.query || {};
  if (req.method === "GET") {
    let r = null;
    try { r = await pipeline([["HMGET", KEY, "name", "v", SIZES[q.s] || "i192"]]); r = r[0]; } catch (e) { r = null; }
    const name = (r && r[0]) || "大東受注ナビ", v = (r && r[1]) || "0";
    if (q.manifest) {
      res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      const has = !!(r && r[1]), src = (s) => (has ? "/api/brand?s=" + s + "&v=" + v : FALLBACK[s]);
      return res.status(200).send(JSON.stringify({
        id: "/", name, short_name: name.slice(0, 12), description: "大東建託パートナーズの工事・緊急出動・維持管理を管理するアプリ", lang: "ja",
        start_url: "/", scope: "/", display: "standalone", orientation: "any", background_color: "#ffffff", theme_color: "#c8102e",
        icons: [
          { src: src("192"), sizes: "192x192", type: "image/png", purpose: "any" },
          { src: src("512"), sizes: "512x512", type: "image/png", purpose: "any" },
          { src: src("m512"), sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      }));
    }
    const s = SIZES[q.s] ? q.s : "192", data = r && r[2];
    if (!data) { res.setHeader("Cache-Control", "no-cache"); res.statusCode = 302; res.setHeader("Location", FALLBACK[s]); return res.end(); }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", q.v ? "public, max-age=31536000, immutable" : "no-cache");
    return res.status(200).send(Buffer.from(data, "base64"));
  }
  const me = authed(req);
  if (!me) return res.status(401).json({ error: "ログインが必要です" });
  if (me.role !== "admin") return res.status(403).json({ error: "管理者のみ変更できます" });
  const b = body(req);
  try {
    if (b.op === "reset") { await pipeline([["DEL", KEY]]); return res.json({ ok: true }); }
    if (b.op === "set") {
      const name = String(b.name || "").normalize("NFKC").trim().slice(0, 30) || "大東受注ナビ";
      const cmd = ["HSET", KEY, "name", name, "v", String(Date.now())];
      let icons = 0;
      ["i192", "i512", "i180", "m512"].forEach((k) => { if (b[k] != null) { if (!b64ok(b[k])) throw new Error("画像の形式が正しくありません"); cmd.push(k, b[k]); icons++; } });
      const cmds = [cmd];
      if (b.clearIcons) cmds.unshift(["HDEL", KEY, "i192", "i512", "i180", "m512"]);
      await pipeline(cmds);
      return res.json({ ok: true, icons });
    }
    res.status(400).json({ error: "bad request" });
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 200) }); }
};
