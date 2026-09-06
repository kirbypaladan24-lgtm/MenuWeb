// Coffee++ shared types — single source of truth for frontend & backend

export type PaymentMethod = "GCASH" | "BOOTH";
export type Temperature = "HOT" | "COLD";
export type OrderStatus = "PENDING" | "WAITING" | "SERVED" | "ABORTED";
export type PaymentStatus = "UNPAID" | "PAID";
export type BoothState = "BEFORE" | "OPEN" | "CLOSED";

/** Full product (booth/admin view) */
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  available: boolean;
  hasTemperature: boolean;
  /** Fixed serving temp shown to customers when hasTemperature is false. */
  defaultTemperature: Temperature | null;
  category: string;
  sold: number;
}

/** Public product (customer view — no sold count) */
export type PublicProduct = Omit<Product, "sold">;

export interface OrderItem {
  productId: string;
  productName: string;
  temperature: Temperature | null;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface Order {
  orderId: string;
  customerName: string;
  customerAlias: string; // call-out name ("" → fall back to the name)
  customerEmail: string; // "" when not provided
  items: OrderItem[];
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  abortReason: string | null;
  createdAt: string; // ISO
  scannedAt: string | null;
  completedAt: string | null;
}

/**
 * One customer row in a product's buyer list (dashboard drill-down).
 * Combines the order's customer credentials with THIS product's line-item
 * data (quantity / temperature / subtotal inside that order).
 */
export interface ProductBuyer {
  orderId: string;
  customerName: string;
  customerAlias: string;
  customerEmail: string;
  quantity: number; // units of THIS product in that order
  temperature: Temperature | null;
  subtotal: number; // ₱ paid for THIS product in that order
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  orderTotal: number; // whole-order total (context)
  createdAt: string; // ISO — when the customer placed the order
  scannedAt: string | null; // ISO — when the QR was scanned at the booth
  completedAt: string | null; // ISO — when the order was served
}

export interface BoothSettings {
  boothName: string;
  startDate: string; // ISO
  endDate: string; // ISO
  totalCost: number; // typed by the admin — feeds Net Profit & ROI
  gcashNumber: string;
  specsNumber: string;
  contactEmail: string; // exported to the client site's contact card
  clientSiteUrl: string; // deployed customer web menu URL — QR on the Scanner view
}

export interface BoothInfo {
  settings: BoothSettings;
  state: BoothState;
}

export interface ProductStat {
  productId: string;
  name: string;
  sold: number;
  revenue: number;
}

export interface HotColdStat {
  productId: string;
  name: string;
  hot: number;
  cold: number;
}

export interface DailySalesStat {
  date: string; // yyyy-MM-dd
  revenue: number;
  orders: number;
}

export type TimeOfDayBucket = "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT";

/** When people buy: orders registered per part of the day. */
export interface TimeOfDayStat {
  bucket: TimeOfDayBucket;
  buyers: number; // orders scanned in this bucket (aborted excluded)
  items: number; // units sold (served orders only)
  revenue: number; // ₱ (served orders only)
}

export interface DashboardStats {
  revenue: number;
  ordersServed: number;
  ordersWaiting: number;
  ordersAborted: number;
  ordersPending: number;
  itemsSold: number;
  totalCost: number; // typed by the admin in the Total Cost box
  netProfit: number; // revenue − totalCost
  roi: number;
  bestSeller: { name: string; sold: number } | null;
  productStats: ProductStat[];
  hotCold: HotColdStat[];
  paymentBreakdown: { gcash: number; booth: number };
  dailySales: DailySalesStat[];
  timeOfDay: TimeOfDayStat[]; // fixed order: MORNING → AFTERNOON → EVENING → NIGHT
}

/** API error payload */
export interface ApiErrorBody {
  error: string;
  code?: string;
  order?: Order;
}

/* ------------------------------------------------------------------ */
/* Hotspot / phone-scanner bridge (admin side)                          */
/* ------------------------------------------------------------------ */
// "Open Hotspot" turns the booth laptop into the local server: the laptop
// hosts a Wi-Fi hotspot, a separate phone scanner app joins it and posts
// decoded Order-QR text to /api/hotspot/scan. Everything stays on the
// local network — no internet needed. The laptop keeps its own camera
// scanner; the phone is just a second (sharper) pair of eyes.

/** How the OS hotspot was brought up. */
export type HotspotMode = "auto" | "manual";

/** What happened when a phone scan hit /api/hotspot/scan. */
export type HotspotScanOutcome =
  | "registered" // full Order QR → order registered (re-scan = another copy)
  | "lookup-waiting" // bare Order ID → already waiting in line
  | "lookup-served" // bare Order ID → order was already served
  | "lookup-aborted" // bare Order ID → order was already aborted
  | "not-found" // bare Order ID → nothing registered under that id
  | "invalid" // scanned text is not a Coffee++ Order QR
  | "error"; // payload rejected (booth closed, validation, …)

/** Manual Wi-Fi setup steps (manual mode) — server-provided, per platform. */
export interface HotspotInstructions {
  title: string;
  steps: string[];
  note: string;
}

/** The live hotspot session on the admin laptop (server memory). */
export interface HotspotSession {
  active: true;
  mode: HotspotMode;
  ssid: string;
  password: string;
  openedAt: string; // ISO
  /** Hotspot IP when the OS hotspot was auto-configured (e.g. 10.42.0.1). */
  autoIp: string | null;
  /** Why auto-configuration failed (manual mode fallback reason). */
  autoError: string | null;
  serverPort: number;
  /** Candidate http://<ip>:<port> URLs the phone app can talk to. */
  urls: string[];
  platform: string;
  /** Manual setup steps when mode is "manual" (null in auto mode). */
  instructions: HotspotInstructions | null;
}

/** A scanner phone that recently talked to the server (heartbeat). */
export interface HotspotPhone {
  deviceId: string;
  name: string;
  lastSeen: string; // ISO
  scanCount: number;
}

/** One received phone scan, as shown in the Scanner's live feed. */
export interface HotspotScanEvent {
  id: number;
  ts: string; // ISO
  deviceId: string | null;
  deviceName: string | null;
  outcome: HotspotScanOutcome;
  message: string | null;
  code: string | null;
  order: Order | null;
  warnings: string[];
  /** First ~40 chars of the raw scanned text (for invalid scans). */
  preview: string;
}

/** GET /api/hotspot/status (+ open) response. */
export interface HotspotStatusResponse {
  hotspot: HotspotSession | null;
  phones: HotspotPhone[];
  /** Present only when requested with withEvents=1 (admin UI poll). */
  events?: HotspotScanEvent[];
  lastEventId: number;
  totalScans: number;
}
