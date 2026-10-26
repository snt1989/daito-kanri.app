// 現場管理アプリからの連携ログイン。
// 現場管理アプリが発行した署名付きチケット(60秒・1回限り)を確認し、大東アプリに同じ担当名のアカウントがあるときだけログインさせる。
// アカウントがない人は入れない(担当・作業員に登録し、パスワードを発行した人だけ)。
// 環境変数: SSO_SECRET(現場管理アプリと同じ値。16文字以上)
const crypto = require("crypto");
const { makeToken, setCookie, body, redis } = require("./_lib");
const USERS = "daito:users";
const nm = (v) => String(v == null ? "" : v).normalize("NFKC").trim().slice(0, 40);
const b64u = (buf) => Buffer.from(buf).toString("base64url");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false }); }
  const secret = process.env.SSO_SECRET;
  if (!secret || secret.length < 16) return res.status(200).json({ ok: false, error: "notconfigured" });
  try {
    const ticket = String(body(req).ticket || "");
    const parts = ticket.split(".");
    if (parts.length !== 2) return res.status(401).json({ ok: false, error: "invalid" });
    const want = b64u(crypto.createHmac("sha256", secret).update(parts[0]).digest());
    const a = Buffer.from(parts[1]), b = Buffer.from(want);
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return res.status(401).json({ ok: false, error: "invalid" });
    let o; try { o = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch (e) { return res.status(401).json({ ok: false, error: "invalid" }); }
    if (!o || o.k !== "d" || !(Number(o.exp) > Date.now())) return res.status(401).json({ ok: false, error: "expired" });
    const name = nm(o.n);
    if (!name) return res.status(401).json({ ok: false, error: "invalid" });
    // 1回限り(同じチケットの使い回しを防ぐ)
    const first = await redis(["SET", "daito:sso:" + String(o.j || "").slice(0, 32), "1", "NX", "EX", "180"]);
    if (!first) return res.status(401).json({ ok: false, error: "used" });
    // 大東アプリにアカウントがあるか
    const raw = await redis(["HGET", USERS, name]);
    if (!raw) return res.status(403).json({ ok: false, error: "noaccount", name });
    setCookie(res, makeToken("staff", name), 30 * 24 * 3600);
    return res.status(200).json({ ok: true, role: "staff", name });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server" });
  }
};
