// スマホ通知(Web Push)。購読は Redis の daito:push(Hash)、通知の履歴は daito:notiflog(List)
// 必要な環境変数: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
const crypto = require("crypto");
const { authed, pipeline, body } = require("./_lib");
const webpush = require("./_webpush");
const SUBS = "daito:push", LOG = "daito:notiflog";
const KINDS = ["job", "emerg", "status", "report"];
const LABEL = { job: "新規案件", emerg: "緊急出動", status: "案件の進捗", report: "報告書" };
const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const keyOf = (ep) => "s_" + crypto.createHash("sha1").update(String(ep)).digest("hex").slice(0, 24);
const norm = (s) => String(s || "").normalize("NFKC").replace(/[\s　]+/g, "");
const cleanPrefs = (p) => { const o = {}; KINDS.forEach((k) => (o[k] = !(p && p[k] === false))); return o; };

// 通知を出す。names=担当(スタッフ)の名前。管理者には常に届く。actor は自分の操作で自分に出さないため
async function notify(kind, title, text, names, actor) {
  if (!configured() || KINDS.indexOf(kind) < 0) return 0;
  const want = {}; (names || []).forEach((n) => { if (norm(n)) want[norm(n)] = 1; });
  const flat = (await pipeline([["HGETALL", SUBS]]))[0] || [];
  const vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: "mailto:" + (process.env.VAPID_SUBJECT || "admin@example.com") };
  const payload = JSON.stringify({ title: "【" + LABEL[kind] + "】" + String(title || "").slice(0, 60), kind, body: String(text || "").replace(/\s+/g, " ").slice(0, 100), tag: kind + "-" + Date.now() });
  const to = {}; let sent = 0; const dead = [], jobs = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    let e; try { e = JSON.parse(flat[i + 1]); } catch (x) { continue; }
    const isAdm = e.role === "admin";
    if (!isAdm && !want[norm(e.name)]) continue;
    if (!isAdm && actor && actor.role === "staff" && norm(actor.name) === norm(e.name)) continue;
    if (e.prefs && e.prefs[kind] === false) continue;
    to[isAdm ? "admin" : "n:" + norm(e.name)] = 1;
    const k = flat[i];
    jobs.push(webpush.send(JSON.parse(e.sub), payload, vapid, 3600).then(() => { sent++; }, (err) => { if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(k); }));
  }
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 7000))]);
  const cmds = [];
  if (Object.keys(to).length) {
    const p = JSON.parse(payload);
    cmds.push(["LPUSH", LOG, JSON.stringify({ at: new Date().toISOString(), kind, title: p.title, body: p.body, to: Object.keys(to) })], ["LTRIM", LOG, 0, 299]);
  }
  dead.forEach((k) => cmds.push(["HDEL", SUBS, k]));
  if (cmds.length) await pipeline(cmds).catch(() => {});
  return sent;
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const me = authed(req);
  if (!me) return res.status(401).json({ error: "ログインが必要です" });
  const b = body(req);
  try {
    switch (b.action) {
      case "status": {
        const out = { configured: configured(), publicKey: process.env.VAPID_PUBLIC_KEY || "", admin: me.role === "admin" };
        if (b.endpoint) { const r = (await pipeline([["HGET", SUBS, keyOf(b.endpoint)]]))[0]; try { const e = r && JSON.parse(r); if (e) out.prefs = e.prefs || null; } catch (x) {} }
        return res.json(out);
      }
      case "subscribe": {
        if (!configured()) return res.status(400).json({ error: "通知がまだ設定されていません" });
        const sub = b.subscription; if (!sub || !sub.endpoint) return res.status(400).json({ error: "購読情報がありません" });
        await pipeline([["HSET", SUBS, keyOf(sub.endpoint), JSON.stringify({ name: me.name, role: me.role, sub: JSON.stringify(sub), prefs: cleanPrefs(b.prefs) })]]);
        return res.json({ ok: true });
      }
      case "prefs": {
        const k = keyOf(b.endpoint || ""), r = (await pipeline([["HGET", SUBS, k]]))[0]; let e = null; try { e = r && JSON.parse(r); } catch (x) {}
        if (!e || e.name !== me.name || e.role !== me.role) return res.status(404).json({ error: "この端末は登録されていません" });
        e.prefs = cleanPrefs(b.prefs); await pipeline([["HSET", SUBS, k, JSON.stringify(e)]]);
        return res.json({ ok: true });
      }
      case "unsubscribe": {
        if (b.endpoint) await pipeline([["HDEL", SUBS, keyOf(b.endpoint)]]);
        return res.json({ ok: true });
      }
      case "history": {
        const raw = (await pipeline([["LRANGE", LOG, 0, 299]]))[0] || [], cut = Date.now() - 30 * 86400000, mine = me.role === "admin" ? "admin" : "n:" + norm(me.name), list = [];
        raw.forEach((s) => { try { const x = JSON.parse(s); if (Date.parse(x.at) >= cut && x.to.indexOf(mine) >= 0) list.push({ at: x.at, kind: x.kind, title: x.title, body: x.body }); } catch (e) {} });
        return res.json({ list: list.slice(0, 100) });
      }
      default: return res.status(400).json({ error: "unknown action" });
    }
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 200) }); }
}
module.exports = handler;
module.exports.notify = notify;
