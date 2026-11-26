// Jomy Johnson site: static pages from ./preview, plus a small API for the studio dashboard.
// Storage: one SQLite-backed Durable Object (free plan, no D1/KV/R2 to create by hand).
// Login: the password is the Worker secret ADMIN_PASSWORD (set in the Cloudflare dashboard, never in git).
import { DurableObject } from "cloudflare:workers";

export class Store extends DurableObject {
  async get(k) { return (await this.ctx.storage.get(k)) ?? null; }
  async put(k, v) { await this.ctx.storage.put(k, v); }
  async del(k) { await this.ctx.storage.delete(k); }
  /* login attempts per IP: at most 8 wrong tries in 15 minutes */
  async tries(ip, failed) {
    const k = "fail:" + ip, now = Date.now();
    let r = (await this.ctx.storage.get(k)) || { n: 0, t: now };
    if (now - r.t > 15 * 60e3) r = { n: 0, t: now };
    if (failed) { r.n++; await this.ctx.storage.put(k, r); }
    return r.n;
  }
}

const enc = new TextEncoder();
const json = (o, status = 200, h = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
const store = env => env.STORE.get(env.STORE.idFromName("site"));
const DAY = 86400;

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret + "|studio-session"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({ "+": "-", "/": "_", "=": "" }[c]));
}
async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}
async function authed(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = /(?:^|;\s*)studio=([^;]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return sameText(sig, await hmac(env.ADMIN_PASSWORD, exp));
}

/* ---------- checking what the dashboard sends ---------- */
const KINDS = ["Oil", "Watercolour", "Drawing"], STATUS = ["available", "sold", "study"];
const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const num = (v, lo, hi) => typeof v === "number" && isFinite(v) && v >= lo && v <= hi;
const NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;
function cleanArt(d) {
  if (!d || !Array.isArray(d.works) || d.works.length > 300 || !Array.isArray(d.prints) || !d.prints.length || d.prints.length > 6) return null;
  if (!num(d.shipping, 0, 100000)) return null;
  const seen = new Set(), works = [];
  for (const w of d.works) {
    if (!w || !NAME.test(w.slug || "") || seen.has(w.slug)) return null;
    seen.add(w.slug);
    if (!str(w.title, 120) || !str(w.medium, 120) || !KINDS.includes(w.kind) || !STATUS.includes(w.status)) return null;
    if (!Number.isInteger(w.year) || w.year < 1900 || w.year > 2100) return null;
    if (!Array.isArray(w.cm) || w.cm.length !== 2 || !w.cm.every(c => num(c, 1, 1000))) return null;
    if (!(w.price === null || (Number.isInteger(w.price) && w.price >= 0 && w.price <= 1e8))) return null;
    if (w.status === "available" && w.price === null) return null;
    const o = { slug: w.slug, title: w.title.trim(), medium: w.medium.trim(), year: w.year, kind: w.kind, cm: w.cm, price: w.price, status: w.status, prints: !!w.prints };
    if (typeof w.edge === "string" && HEX.test(w.edge)) o.edge = w.edge;
    /* frame: no fcolor = auto (dark shade of the painting's own ground); ftex missing = the site default */
    if (w.fcolor !== undefined) { if (!HEX.test(w.fcolor)) return null; o.fcolor = w.fcolor; }
    if (w.ftex !== undefined) { if (!TEX.includes(w.ftex)) return null; o.ftex = w.ftex; }
    if (w.img !== undefined) { if (!NAME.test(w.img)) return null; o.img = w.img; }
    o.detail = !!w.detail;
    works.push(o);
  }
  const prints = [];
  for (const p of d.prints) {
    if (!p || !str(p.name, 40) || !num(p.long, 5, 300) || !Number.isInteger(p.price) || p.price < 0 || p.price > 1e7) return null;
    prints.push({ name: p.name.trim(), long: p.long, price: p.price });
  }
  const out = { works, prints, shipping: Math.round(d.shipping) };
  if (d.site !== undefined) { const site = cleanSite(d.site, seen); if (!site) return null; out.site = site; }
  return out;
}
/* site settings edited in the studio: home wall, frames, About text, payment details */
const HEX = /^#[0-9a-f]{6}$/i, TEX = ["linen", "primed", "plain"], BLOCKS = ["bio", "approach", "cv"];
const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$/;
const opt = (v, max) => v === "" || str(v, max);
const link = v => v === "" || (typeof v === "string" && v.length <= 300 && /^https:\/\/[^\s<>"']+$/.test(v));
/* Real payments stay OFF until orders are saved and Ritik gives the word (26 Nov 2026). Only this line turns them on. */
const ALLOW_LIVE_PAY = false;
function cleanSite(s, slugs) {
  if (!s || typeof s !== "object") return null;
  const o = {};
  if (!Array.isArray(s.home) || s.home.length !== 7 || new Set(s.home).size !== 7 || !s.home.every(h => slugs.has(h))) return null;
  o.home = s.home.slice();
  if (!s.frame || !TEX.includes(s.frame.tex)) return null;
  o.frame = { tex: s.frame.tex };
  const a = s.about;
  if (!a || !str(a.name, 40) || !Array.isArray(a.bio) || a.bio.length < 1 || a.bio.length > 2 || !a.bio.every(p => str(p, 420))) return null;
  if (!a.approach || !str(a.approach.title, 40) || !Array.isArray(a.approach.items) || a.approach.items.length < 1 || a.approach.items.length > 3) return null;
  if (!a.approach.items.every(i => i && str(i.t, 30) && str(i.d, 170))) return null;
  if (!Array.isArray(a.cv) || a.cv.length > 5 || !a.cv.every(r => r && str(r.k, 16) && str(r.v, 110))) return null;
  if (!Array.isArray(a.order) || a.order.length !== 3 || !BLOCKS.every(b => a.order.includes(b))) return null;
  o.about = { name: a.name.trim(), bio: a.bio.map(p => p.trim()), approach: { title: a.approach.title.trim(), items: a.approach.items.map(i => ({ t: i.t.trim(), d: i.d.trim() })) },
    cv: a.cv.map(r => ({ k: r.k.trim(), v: r.v.trim() })), order: a.order.slice() };
  const p = s.pay;
  if (!p || !(p.upi === "" || (typeof p.upi === "string" && UPI.test(p.upi))) || !opt(p.payee, 60) || !(p.qr === "" || (typeof p.qr === "string" && NAME.test(p.qr)))) return null;
  if (!Array.isArray(p.methods) || p.methods.length > 3 || !p.methods.every(m => m && str(m.name, 40) && opt(m.text, 200) && link(m.url))) return null;
  o.pay = { upi: p.upi, payee: p.payee.trim(), qr: p.qr, methods: p.methods.map(m => ({ name: m.name.trim(), text: m.text.trim(), url: m.url })), live: ALLOW_LIVE_PAY && p.live === true };
  return o;
}
function imgType(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname, M = req.method;

    /* uploaded pictures: /img/<name>.webp when no file of that name is in ./preview */
    const im = /^\/img\/([a-z0-9-]{1,80})\.webp$/.exec(p);
    if (im && (M === "GET" || M === "HEAD")) {
      const v = await store(env).get("img:" + im[1]);
      if (!v) return new Response("Not found", { status: 404 });
      return new Response(M === "HEAD" ? null : v.buf, { headers: { "content-type": v.type, "cache-control": "public, max-age=31536000, immutable" } });
    }

    if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);

    if (p === "/api/art" && M === "GET") {
      let d = await store(env).get("art");
      if (!d) d = await (await env.ASSETS.fetch(new Request(url.origin + "/data/seed.json"))).json();
      /* payment details are not shown to visitors until real payments are switched on */
      if (d.site && d.site.pay && !d.site.pay.live && !(await authed(req, env))) d = { ...d, site: { ...d.site, pay: { live: false, methods: [] } } };
      return json(d);
    }
    if (p === "/api/me" && M === "GET") return json({ ok: await authed(req, env), ready: !!env.ADMIN_PASSWORD });

    /* everything below changes something: same-site only */
    if (M !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Bad request" }, 400);

    if (p === "/api/login" && M === "POST") {
      if (!env.ADMIN_PASSWORD) return json({ error: "The studio password is not set yet." }, 503);
      const ip = req.headers.get("cf-connecting-ip") || "x", s = store(env);
      if ((await s.tries(ip, false)) >= 8) return json({ error: "Too many tries. Wait 15 minutes." }, 429);
      let body = {};
      try { body = await req.json(); } catch (e) {}
      const ok = typeof body.password === "string" && body.password.length <= 200 && (await sameText(body.password, env.ADMIN_PASSWORD));
      if (!ok) { await s.tries(ip, true); return json({ error: "That password is not right." }, 401); }
      const exp = String(Math.floor(Date.now() / 1000) + 30 * DAY);
      return json({ ok: true }, 200, { "set-cookie": `studio=${exp}.${await hmac(env.ADMIN_PASSWORD, exp)}; Max-Age=${30 * DAY}; Path=/; HttpOnly; Secure; SameSite=Strict` });
    }
    if (p === "/api/logout" && M === "POST")
      return json({ ok: true }, 200, { "set-cookie": "studio=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict" });

    if (!(await authed(req, env))) return json({ error: "Please log in again." }, 401);

    if (p === "/api/art" && M === "PUT") {
      let d;
      try { d = cleanArt(await req.json()); } catch (e) { d = null; }
      if (!d) return json({ error: "Some details are missing or wrong." }, 400);
      await store(env).put("art", d);
      return json({ ok: true });
    }
    const up = /^\/api\/img\/([a-z0-9-]{1,80})$/.exec(p);
    if (up && M === "PUT") {
      const buf = await req.arrayBuffer();
      const type = imgType(buf);
      if (!type || buf.byteLength > 1.9e6) return json({ error: "That picture could not be used." }, 400);
      await store(env).put("img:" + up[1], { type, buf });
      return json({ ok: true });
    }
    if (up && M === "DELETE") { await store(env).del("img:" + up[1]); return json({ ok: true }); }

    return json({ error: "Not found" }, 404);
  },
};
