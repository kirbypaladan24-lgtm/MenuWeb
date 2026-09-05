# Coffee++ — Booth Console (Admin)

The staff-side half of the **Coffee++** booth ordering system. Run it on the
booth laptop: it scans customer Order QRs, registers their orders, runs the
waiting line, and tracks sales, net profit and reports across the 3-day event.

Customers order on the **published client site** (separate project,
`coffeepp-client`). Their Order QR carries the complete order — call-out
name, name, email, items, total, payment — so this console needs no connection
to the client app.

## Setup

```bash
npm install            # or: bun install
npm run db:push        # creates db/custom.db (SQLite)
npm run seed           # 7 default products + booth settings
npm run dev            # http://localhost:3001
```

> Node 20+ required (or Bun — either works). Everything above runs with plain
> `npm`: the seed script reads `.env` by itself, no extra setup. The database is
> a single SQLite file at `db/custom.db` — no other infrastructure.

## Run it in VS Code

1. Unzip the download, then **File → Open Folder… → `coffeepp-admin`**.
2. Open the built-in terminal (**Ctrl + `**) and run the four commands above.
3. Ctrl+Click the `http://localhost:3001` link in the terminal output.

## No sign-in

There is **no login page and no accounts** — the console opens straight into
the Dashboard. That's safe because it only ever runs on the booth laptop
(localhost). **Never host this project on the public internet**; it has no
protection. The publishable half is the separate `coffeepp-client` site.

## Daily booth flow

1. **Scanner** — point the camera at the customer's Order QR. The QR carries
   their call-out name, name, email, items and total; scanning **registers the
   order** into the waiting line. The console re-prices items against your
   current product list and warns you (amber notes) if prices changed, an item
   is unavailable, or a product is unknown — warnings never block.
   - **Want more of the same order? Scan the same QR again.** Every scan of a
     customer's QR registers another copy (`ORD-K7F2Q9-2`, `-3`, …) — handy
     when a customer ordered 1 but decides they want 2.
   - No camera? **Paste the QR payload** (JSON) or type an Order ID of an
     already-registered order.
   - Walk-in customer? **Manual Order** — pick products, enter what to call
     them + their name, assign payment; the ID is generated for you.
2. **Waiting Line** — live queue of registered orders (auto-refreshes). Each
   card leads with the **call-out name in big bold type** (same weight as the
   order number) — that's what the staff shouts when the drink is ready.
3. **Serve** when the order is handed over (marks PAID, counts as a sale) —
   or **Abort** with a reason (never counted as a sale).
   GCash payments are verified manually at this point.
4. **Dashboard** — revenue, the **Total Cost box**, net profit, ROI, best
   sellers, HOT vs COLD, GCash vs Booth, daily sales.
5. **Reports** — Excel export (4 sheets) + full JSON backup.

## Net Profit = Revenue − Total Cost

There is no stock tracking and no per-product cost bookkeeping. Instead, the
Dashboard has a **Total Cost box**: type how much you've spent running the
booth (ingredients, supplies, everything) and the dashboard keeps
**Net Profit = Total Revenue − Total Cost** and **ROI = Net Profit ÷ Total
Cost** accurate and up to date. Update the number any time as you spend.

## Keeping the client site in sync

Products, prices, availability, booth dates and the contact email
are edited here (**Products** / **Settings**). To push changes to the published
client site:
**Settings → Client site menu → Export coffeepp-menu.json**, then replace
`src/data/menu.json` in the `coffeepp-client` project and redeploy it.

## Notes

- Keep the console running on `localhost` (or an HTTPS host) — camera access
  requires a secure context; `localhost` is already secure.
- Orders live only in this database; the client site works without it.
- Backup often (Reports → Backup JSON) — it contains products, orders
  and settings.
- Reset everything: delete `db/custom.db` → `npm run db:push` → `npm run seed`.

## Tech

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui ·
Prisma + SQLite · jsQR (camera scanning) · SheetJS (Excel export) ·
Zustand + TanStack Query.
