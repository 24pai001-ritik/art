// API test for the studio dashboard: runs `wrangler dev` with a dummy password and checks every route.
// Run on laptop B: offload.cmd "npm ci && node tools/studio_test.mjs"
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = 8799, B = `http://127.0.0.1:${PORT}`, PW = "dummy-test-pass-42";
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--var", `ADMIN_PASSWORD:${PW}`, "--persist-to", ".wrangler-test"], { shell: true, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; dev.stdout.on("data", d => (log += d)); dev.stderr.on("data", d => (log += d));
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const H = { "x-studio": "1" };

try {
  for (let i = 0; i < 90; i++) { try { await fetch(B + "/api/me"); break; } catch (e) { await wait(1000); } }
  let r = await fetch(B + "/api/art"); let d = await r.json();
  ok(r.status === 200 && d.works.length === 9 && d.prints.length === 3, "seed art served (" + d.works?.length + ")");
  r = await fetch(B + "/api/me"); ok((await r.json()).ready === true, "me: ready, not logged in");
  r = await fetch(B + "/api/art", { method: "PUT", headers: H, body: "{}" }); ok(r.status === 401, "PUT art without login = 401");
  r = await fetch(B + "/api/img/x", { method: "PUT", headers: H, body: "x" }); ok(r.status === 401, "PUT img without login = 401");
  r = await fetch(B + "/api/login", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) });
  ok(r.status === 401, "wrong password = 401");
  r = await fetch(B + "/api/login", { method: "POST", body: JSON.stringify({ password: PW }) }); ok(r.status === 400, "login without x-studio header = 400");
  r = await fetch(B + "/api/login", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ password: PW }) });
  const sc = r.headers.get("set-cookie") || ""; ok(r.status === 200 && /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), "right password = cookie");
  const C = { ...H, cookie: sc.split(";")[0] };
  r = await fetch(B + "/api/me", { headers: C }); ok((await r.json()).ok === true, "me: logged in");
  r = await fetch(B + "/api/art", { method: "PUT", headers: { ...H, cookie: "studio=9999999999.forged" }, body: "{}" }); ok(r.status === 401, "forged cookie = 401");

  const webp = readFileSync("preview/img/grief-sm.webp");
  r = await fetch(B + "/api/img/test-new-abc", { method: "PUT", headers: C, body: webp }); ok(r.status === 200, "upload webp");
  r = await fetch(B + "/api/img/test-bad", { method: "PUT", headers: C, body: "not an image" }); ok(r.status === 400, "upload junk = 400");
  r = await fetch(B + "/img/test-new-abc.webp"); const got = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && r.headers.get("content-type") === "image/webp" && got.equals(webp), "uploaded picture served at /img/<name>.webp");
  r = await fetch(B + "/img/grief.webp"); ok(r.status === 200 && (await r.arrayBuffer()).byteLength > 10000, "static picture still served");

  r = await fetch(B + "/api/art"); let pub = await r.json();
  ok(pub.site && pub.site.home.length === 7 && pub.site.pay.live === false && pub.site.pay.upi === undefined, "visitors get site settings without pay details");
  d = await (await fetch(B + "/api/art", { headers: C })).json();
  ok(d.site && d.site.pay.upi === "" && d.site.about.order.length === 3, "studio gets the full site settings");
  d.works[0].price = 25000;
  d.works.unshift({ slug: "test-new", title: "Test New", medium: "Oil on paper", year: 2026, kind: "Oil", cm: [21, 15], price: 5000, status: "available", prints: true, img: "test-new-abc", edge: "#223344", detail: false });
  d.prints[0].price = 950; d.shipping = 200;
  r = await fetch(B + "/api/art", { method: "PUT", headers: { ...C, "content-type": "application/json" }, body: JSON.stringify(d) }); ok(r.status === 200, "save art");
  r = await fetch(B + "/api/art"); const d2 = await r.json();
  ok(d2.works.length === 10 && d2.works[0].slug === "test-new" && d2.works[1].price === 25000 && d2.prints[0].price === 950 && d2.shipping === 200, "saved art read back");
  const bad = structuredClone(d2); bad.works[0].status = "maybe";
  r = await fetch(B + "/api/art", { method: "PUT", headers: { ...C, "content-type": "application/json" }, body: JSON.stringify(bad) }); ok(r.status === 400, "bad status = 400");
  const dup = structuredClone(d2); dup.works.push(dup.works[0]);
  r = await fetch(B + "/api/art", { method: "PUT", headers: { ...C, "content-type": "application/json" }, body: JSON.stringify(dup) }); ok(r.status === 400, "duplicate slug = 400");
  const put = x => fetch(B + "/api/art", { method: "PUT", headers: { ...C, "content-type": "application/json" }, body: JSON.stringify(x) });
  const s1 = structuredClone(d2);
  s1.site.home = ["vacant", "hibiscus", "acceptance", "test-new", "old-man", "roses", "paper-weight"];
  s1.site.frame.tex = "primed"; s1.works[1].fcolor = "#112233"; s1.works[1].ftex = "plain"; s1.works[2].fstyle = "gilt";
  s1.site.about.order = ["approach", "bio", "cv"]; s1.site.about.bio = ["New bio."];
  s1.site.pay = { upi: "jomy.art@okaxis", payee: "Jomy Johnson", qr: "qr-abc", methods: [{ name: "Bank transfer", text: "Ask for details", url: "" }, { name: "Pay link", text: "", url: "https://example.com/pay" }], live: true };
  r = await put(s1); ok(r.status === 200, "save site settings");
  const d3 = await (await fetch(B + "/api/art", { headers: C })).json();
  ok(d3.site.home[3] === "test-new" && d3.site.frame.tex === "primed" && d3.works[1].fcolor === "#112233" && d3.works[1].ftex === "plain" && d3.works[2].fstyle === "gilt" && d3.site.about.order[0] === "approach" && d3.site.pay.upi === "jomy.art@okaxis" && d3.site.pay.methods.length === 2, "site settings read back");
  ok(d3.site.pay.live === false, "real payments stay off even when sent as on");
  const pub2 = await (await fetch(B + "/api/art")).json(); ok(pub2.site.pay.upi === undefined && pub2.site.home[3] === "test-new", "visitors still don't see pay details");
  const bad1 = structuredClone(d3); bad1.site.pay.methods = [{ name: "x", text: "", url: "javascript:alert(1)" }]; r = await put(bad1); ok(r.status === 400, "javascript: link = 400");
  const bad2 = structuredClone(d3); bad2.site.home[0] = bad2.site.home[1]; r = await put(bad2); ok(r.status === 400, "duplicate home slot = 400");
  const bad3 = structuredClone(d3); bad3.site.home[0] = "nope"; r = await put(bad3); ok(r.status === 400, "unknown home painting = 400");
  const bad4 = structuredClone(d3); bad4.site.about.bio = ["x".repeat(421)]; r = await put(bad4); ok(r.status === 400, "over-long bio = 400");
  const bad5 = structuredClone(d3); bad5.site.pay.upi = "not a upi"; r = await put(bad5); ok(r.status === 400, "bad UPI id = 400");
  const bad6 = structuredClone(d3); bad6.works[0].fcolor = "red"; r = await put(bad6); ok(r.status === 400, "bad frame colour = 400");
  const bad7 = structuredClone(d3); bad7.works[0].fstyle = "gold"; r = await put(bad7); ok(r.status === 400, "unknown carved frame = 400");
  r = await fetch(B + "/api/img/test-new-abc", { method: "DELETE", headers: C }); ok(r.status === 200, "delete picture");
  r = await fetch(B + "/img/test-new-abc.webp"); ok(r.status === 404, "deleted picture = 404");
  r = await fetch(B + "/studio"); ok(r.status === 200 && (await r.text()).includes("Open the studio"), "/studio page served");
  r = await fetch(B + "/"); ok(r.status === 200 && (await r.text()).includes("applyData"), "home page served");
  for (let i = 0; i < 8; i++) await fetch(B + "/api/login", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ password: "nope" + i }) });
  r = await fetch(B + "/api/login", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ password: PW }) }); ok(r.status === 429, "too many tries = 429");
} catch (e) { console.log("FAIL exception " + e); fails++; console.log(log.slice(-2000)); }
finally {
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(dev.pid), "/T", "/F"]); else dev.kill();
}
console.log(fails ? `RESULT ${fails} FAILED` : "RESULT ALL PASS");
setTimeout(() => process.exit(fails ? 1 : 0), 1500);
