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
   - Laptop camera struggling (glare, autofocus)? **Open Hotspot** below and
     scan with a phone instead — see the next section.
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
   The **Products** grid lists every product with its photo and name —
   **press a product to see the customers who bought it**: one table row per
   order with the call-out name, name, email, quantity, temperature, this
   item's subtotal, the order total, payment method + status, order status
   and dates. Search it, filter by status, click any column to sort, or
   export the current view. **Excel** is the primary export: every
   column is auto-fitted to its longest cell (long emails and names are
   never cut off in Excel), the header row gets Excel filter dropdowns,
   and money lands as real peso-formatted numbers you can sort and sum.
   **CSV** stays available from the format dropdown next to the Excel
   button.
   Every email shown anywhere in the console (buyers table, orders,
   waiting line, scanner, serve confirmation) has a small **copy icon** —
   one press puts the address on the clipboard.
5. **Reports** — Excel export (4 sheets) + full JSON backup.

## Scan with a phone — Open Hotspot (works offline)

The **Scanner** view has a second scanning option for when the laptop camera
can't keep up (glare, slow autofocus, tiny QRs): press **Open Hotspot** and a
separate **phone scanner app** becomes the camera.

1. **Open Hotspot** (under the Manual Order button). On Linux +
   NetworkManager the laptop's Wi-Fi hotspot comes up automatically (shared
   access point, WPA2). On Windows/macOS the panel shows three short manual
   steps (Mobile hotspot / Internet Sharing) — the bridge works either way.
2. The panel shows the **Wi-Fi name + password** (remembered between
   sessions, plus a join-QR the phone's stock camera app can scan) and the
   **server address** the scanner app needs, e.g. `http://10.42.0.1:3001`.
3. Join the phone to that Wi-Fi and point the scanner app at the server
   address. Every QR the phone decodes is sent to this laptop and goes
   through the **exact same pipeline as the laptop camera** — same
   validation, re-pricing, duplicate-copy behavior — then pops the same
   order card here and lands in the **Received scans** feed. Confirm
   SERVE/ABORT on the laptop exactly as with camera scans.

Everything runs **on the local network only — no internet needed**. The
laptop stays the server and the source of truth; the phone is just a
wireless camera. The laptop's own camera scanning is never affected while
the hotspot is open, and **Close Hotspot** tears it all down.

The hotspot endpoints answer on the LAN with open CORS and no credentials —
by design, so any phone app can talk to them offline. They only ever run on
the booth's own Wi-Fi (protected by its WPA2 password), consistent with the
console's no-sign-in design. Keep `Close Hotspot` handy when you're done.

### Phone scanner app API contract

The phone app (its own separate project) only needs plain HTTP against the
server address shown on the panel:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/hotspot/status?deviceId=…&deviceName=…` | Heartbeat + session info — this is also how the panel lists the phone as connected. |
| `POST /api/hotspot/scan` | Send a decoded QR: body `{ "payload": "<decoded QR text>", "deviceId": "…", "deviceName": "…" }` (payload may also be the parsed order object). |
| `GET /api/hotspot/status?withEvents=1&since=<id>` | Optional: the scan-event feed the console panel itself polls. |
| `POST /api/hotspot/open` · `POST /api/hotspot/close` | Console-only (the panel's buttons). |

`POST /api/hotspot/scan` always answers JSON the phone can render directly:

- `201 { ok: true, outcome: "registered", order, warnings, message }` —
  full Order-QR JSON registered (re-scan adds another copy, like the camera)
- `200 { ok: true, outcome: "lookup-waiting" | "lookup-served" | "lookup-aborted", order, message }` — bare `ORD-…` ids
- `404 { ok: false, outcome: "not-found", message }` — id has no registered order
- `400 { ok: false, outcome: "invalid", message }` — not a Coffee++ Order QR
- `403 / 400 { ok: false, outcome: "error", error, code, message }` — rejected (booth closed, bad fields, …)

Scans that arrive while the Scanner view is closed still register — they
show up in **Orders**; open the Scanner to see the live feed again.

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
Prisma + SQLite · jsQR (camera scanning) · qrcode (Wi-Fi join QR) ·
SheetJS (Excel export) · offline phone-scanner hotspot bridge
(`/api/hotspot/*`) · Zustand + TanStack Query.
