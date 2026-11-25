# artist_site: client artist portfolio + shop

Plan: `C:\Users\mt testing pc\.claude\plans\https-dessineart-com-srsltid-a-serialized-yao-of-88a9ecf1-983c-4704-93ff-3c3e24498a1e.md`

- **Git for this project = GitHub account `24pai001-ritik`, repo https://github.com/24pai001-ritik/art** (Ritik, 25 Nov 2026). This overrides the global ritik@reasonify.in rule for this folder only. Set it in the repo-local git config. If a push is rejected, report it and stop.
- Stack: Astro on Cloudflare Pages, D1 (`db/schema.sql`), R2 for images, Cloudflare Access on `/studio`. Everything stays on free tiers.
- Payment: UPI QR made per order + the artist marks orders paid by hand. No gateway.
- No-scroll rule: every screen fits the viewport. Moving around is by full-page snap.
- Builds and tests go through laptop B: `D:\LaptopMesh\offload.cmd "npm ci && npm run build"`.
