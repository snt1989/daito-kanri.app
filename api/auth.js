const { authed, makeToken, setCookie, body, redis, hashPw, checkPw } = require("./_lib");
const USERS = "daito:users"; // Hash: 担当名 -> {salt,hash}
const nm = (v) => String(v == null ? "" : v).normalize("NFKC").trim().slice(0, 40);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const b = body(req);
  if (!process.env.APP_PASSWORD) return res.status(200).json({ ok: false, nopw: true, error: "APP_PASSWORD が設定されていません" });
  const me = authed(req);
  try {
    if (b.op === "check") return res.status(200).json(me ? { ok: true, role: me.role, name: me.name } : { ok: false });
    if (b.op === "logout") { setCookie(res, "", 0); return res.status(200).json({ ok: true }); }
    if (b.op === "login") {
      await new Promise((r) => setTimeout(r, 400));
      const name = nm(b.name), pw = typeof b.password === "string" ? b.password : "";
      if (!name) {
        if (pw === process.env.APP_PASSWORD) { setCookie(res, makeToken("admin", ""), 30 * 24 * 3600); return res.status(200).json({ ok: true, role: "admin", name: "" }); }
      } else {
        const raw = await redis(["HGET", USERS, name]);
        let rec = null; try { rec = raw ? JSON.parse(raw) : null; } catch (e) {}
        if (rec && checkPw(pw, rec)) { setCookie(res, makeToken("staff", name), 30 * 24 * 3600); return res.status(200).json({ ok: true, role: "staff", name }); }
      }
      return res.status(401).json({ ok: false, error: "担当名またはパスワードが違います" });
    }
    if (!me) return res.status(401).json({ ok: false, error: "ログインが必要です" });
    // 管理者: 担当のパスワード発行・削除・一覧
    if (b.op === "users" || b.op === "setpw" || b.op === "delpw") {
      if (me.role !== "admin") return res.status(403).json({ ok: false, error: "管理者のみ操作できます" });
      if (b.op === "users") { const r = await redis(["HKEYS", USERS]); return res.status(200).json({ ok: true, names: r || [] }); }
      const name = nm(b.name);
      if (!name) return res.status(400).json({ ok: false, error: "担当名がありません" });
      if (b.op === "delpw") { await redis(["HDEL", USERS, name]); return res.status(200).json({ ok: true }); }
      if (typeof b.password !== "string" || b.password.length < 6) return res.status(400).json({ ok: false, error: "パスワードは6文字以上にしてください" });
      await redis(["HSET", USERS, name, JSON.stringify(hashPw(b.password))]);
      return res.status(200).json({ ok: true });
    }
    // 本人: パスワード変更
    if (b.op === "chpw") {
      if (me.role !== "staff") return res.status(400).json({ ok: false, error: "担当でログインしているときだけ変更できます" });
      await new Promise((r) => setTimeout(r, 400));
      const raw = await redis(["HGET", USERS, me.name]);
      let rec = null; try { rec = raw ? JSON.parse(raw) : null; } catch (e) {}
      if (!rec || !checkPw(String(b.old || ""), rec)) return res.status(401).json({ ok: false, error: "現在のパスワードが違います" });
      if (typeof b.password !== "string" || b.password.length < 6) return res.status(400).json({ ok: false, error: "パスワードは6文字以上にしてください" });
      await redis(["HSET", USERS, me.name, JSON.stringify(hashPw(b.password))]);
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
  res.status(400).json({ ok: false });
};
