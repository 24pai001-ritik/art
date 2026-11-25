# Artist portfolio + shop

A portfolio site for an artist, with a private dashboard (`/studio`) where she uploads her works and handles orders. It sells originals and prints, with payment by UPI QR. It runs on Cloudflare's free tier: Pages, D1, R2 and Access.

## Run locally
```
npm install
npm run dev
```

## Database
```
npx wrangler d1 execute artist-db --local --file=db/schema.sql
```
