// Coffee++ seed — run with: npm run seed  (or: bun run seed)
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load DATABASE_URL from the project's own .env so the seed works under plain
// npm/node (Bun and Next.js load .env automatically; tsx does not).
// The project .env is authoritative — it wins over any inherited shell value.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (m[1] === "DATABASE_URL") process.env.DATABASE_URL = val;
  }
} catch {
  // .env is optional — fall back to whatever DATABASE_URL already exists
}

const db = new PrismaClient();

async function main() {
  // Products — the launch menu (kept in sync with src/data/menu.json on the client)
  const products = [
    {
      id: "CF-001",
      name: "Classic Coffee",
      description:
        "Freshly brewed bold coffee, hot or over ice.\n\nPromo:\nGet a FREE photobooth session for every 5 coffee orders",
      price: 25,
      image: "/images/products/ClassicCoffee.jpg",
      available: true,
      hasTemperature: true,
      category: "Drinks",
    },
    {
      id: "CF-002",
      name: "Spanish Latte",
      description: "Creamy espresso with condensed milk, served hot or iced.",
      price: 35,
      image: "/images/products/SpanishLatte.jpg",
      available: true,
      hasTemperature: false,
      defaultTemperature: "COLD",
      category: "Drinks",
    },
    {
      id: "CF-003",
      name: "Matcha",
      description: "Smooth ceremonial-grade matcha with milk, hot or iced.",
      price: 35,
      image: "/images/products/Matcha.jpg",
      available: true,
      hasTemperature: false,
      defaultTemperature: "COLD",
      category: "Drinks",
    },
    {
      id: "FD-001",
      name: "Jelly Flan Cake",
      description:
        "A delicious layered dessert combining creamy leche flan, soft cake, and a smooth, vibrant color jelly topping. Sweet, creamy, and refreshing in every bite!",
      price: 15,
      image: "/images/products/JellyFlanCake.jpg",
      available: true,
      hasTemperature: false,
      category: "Pastries",
    },
    {
      id: "PB-001",
      name: "Photobooth",
      description: "One photo-booth session with instant printed strip.",
      price: 50,
      image: "/images/products/Photobooth.jpg",
      available: true,
      hasTemperature: false,
      category: "Extras",
    },
    {
      id: "PR-001",
      name: "PROMO",
      description: "5 Coffee orders = Free Photobooth session",
      price: 125,
      image: "/images/products/Promo.jpg",
      available: true,
      hasTemperature: true,
      category: "Extras",
    },
  ];

  for (const p of products) {
    await db.product.upsert({ where: { id: p.id }, update: {}, create: p });
  }

  // Booth settings — the launch schedule (matches src/data/menu.json on the client)
  await db.booth.upsert({
    where: { id: "main" },
    update: {},
    create: {
      id: "main",
      boothName: "Coffee++",
      startDate: new Date("2026-09-22T00:00:00.000Z"),
      endDate: new Date("2026-09-24T09:30:00.000Z"),
      totalCost: 0,
      gcashNumber: "0917 123 4567",
      specsNumber: "09123456789",
      contactEmail: "parsu.specs@gmail.com",
      clientSiteUrl: "", // set after the client site is deployed — feeds the Scanner QR
    },
  });

  const count = await db.product.count();
  console.log(`Seeded ${count} products and booth settings. No accounts — the console opens straight in.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
