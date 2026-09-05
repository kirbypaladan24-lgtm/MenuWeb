// Coffee++ shared constants

export const BOOTH_DAYS = ["Day 1", "Day 2", "Day 3"] as const;

export const ABORT_REASONS = [
  "Customer cancelled",
  "Payment issue",
  "Wrong order",
  "Product unavailable",
  "Other",
] as const;

export const PRODUCT_CATEGORIES = ["Drinks", "Pastries", "Extras"] as const;

/** Booth app navigation (order matters — speed-first layout) */
export const BOOTH_NAV = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { id: "scanner", label: "Scanner", icon: "scan-line" },
  { id: "waiting", label: "Waiting Line", icon: "list-ordered" },
  { id: "orders", label: "Orders", icon: "receipt-text" },
  { id: "products", label: "Products", icon: "package" },
  { id: "reports", label: "Reports", icon: "file-spreadsheet" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const;

export type BoothView = (typeof BOOTH_NAV)[number]["id"];

export const HOW_TO_ORDER_STEPS = [
  {
    title: "Pick your drink or treat",
    text: "Browse the menu and tap ORDER on any available item.",
  },
  {
    title: "Customize your order",
    text: "Choose HOT or COLD where offered, set your quantity, and pick a payment method.",
  },
  {
    title: "Tell us what to call you",
    text: "Add a call-out name with your order — that's what our staff shouts when it's ready.",
  },
  {
    title: "Apply your order",
    text: "Confirm the summary — you'll instantly get an Order QR.",
  },
  {
    title: "Show your QR at the booth",
    text: "Our staff scans it, verifies payment, and prepares your order on the spot. Want more? Scan the same QR again.",
  },
] as const;
