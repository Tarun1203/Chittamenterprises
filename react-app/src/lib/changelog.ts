// What changed in each version, newest first. Shown on the What's new page
// and, once, after a device updates. Add an entry with every release.
export interface Release { version: string; date: string; title: string; items: string[]; windows?: string }

export const RELEASES: Release[] = [
  {
    version: "3.9", date: "2026-11-19", title: "Tally stock in orders, Tally invoices in reminders", windows: "2.2",
    items: [
      "Orders: each line shows Tally stock (Chittam + Cash added up), and “Available now” fills in from it — the rest stays pending.",
      "Payment Reminder: picking a customer fills in their open invoices from Tally with bill dates and due dates, and the pending days.",
      "The Windows app (2.2) sends stock and open invoices from Tally along with the balances.",
    ],
  },
  {
    version: "3.8", date: "2026-11-19", title: "Thermal pick list slips",
    items: [
      "Pick list → Thermal: a receipt-printer slip per order (80 mm or 58 mm paper) with the order number, dates, customer name, mobile, transport, items to pack with tick boxes, pending items, notes and Packed by / Checked by.",
      "A day's pick list prints one slip per order. The paper width is remembered on each device.",
      "The normal full-page print is now the A4 button.",
    ],
  },
  {
    version: "3.7", date: "2026-11-19", title: "Pick list printing fixed",
    items: [
      "Print on the pick list works in the Windows app and on phones — no more “Allow pop-ups to print”.",
      "The printed pick list also lists the pending items (no stock, not packed).",
    ],
  },
  {
    version: "3.6", date: "2026-11-19", title: "Orders: pack what's in stock, keep the rest pending",
    items: [
      "Each order line has “Available now” and a “No stock” button; whatever isn't available stays pending in that order.",
      "The pick list packs only what's available and lists the pending items separately.",
      "The order confirmation message lists pending items: “Pending — will be sent when stock arrives”.",
      "Orders show a “pending” tag, and Pending items lists everything pending by product — “Mark available” when stock arrives.",
    ],
  },
  {
    version: "3.5", date: "2026-11-19", title: "What's new",
    items: [
      "This page: every update to the app, newest first.",
      "After an update, the app shows what changed — once on each device.",
    ],
  },
  {
    version: "3.4", date: "2026-11-19", title: "Tally Match: vouchers and payment modes", windows: "2.1",
    items: [
      "Shows how each Tally receipt was booked (Cash, or which bank).",
      "New “Matched, but details differ”: paid by UPI in the app but booked to Cash in Tally (or the other way round), a different amount, or dates far apart — with “Change app to Cash/UPI”.",
      "“Record in app” on a Tally receipt that isn't in the app: customer, date, amount, account and mode filled in, voucher number saved.",
      "“Link to Tally voucher”: a payment linked to a voucher number always matches that voucher.",
      "Payments Received: new Tally voucher no. field.",
    ],
  },
  {
    version: "3.3", date: "2026-11-19", title: "Tally Match and Windows app 2.0", windows: "2.0",
    items: [
      "New Tally Match page: payments in the app vs Tally receipts, what's missing on either side, possible duplicate transactions, and every customer's Tally balance.",
      "Windows app 2.0: sharp text at any display scaling, no more double cursor, opens the new app full-window, redesigned Tally Sync window.",
      "The Windows app also sends the last 90 days of Tally transactions.",
    ],
  },
  {
    version: "3.2", date: "2026-11-19", title: "History, Settings, Catalog; installable",
    items: [
      "History: latest messages (copy or send again) and every change, with what changed.",
      "Settings: business details, UPI and bank accounts, payment modes, Tally balance import, backup.",
      "Product Catalog: pick products and share on WhatsApp with photos.",
      "Install the app on a phone or PC, use it offline, and get a Reload bar when a new version is out.",
    ],
  },
  {
    version: "3.1", date: "2026-11-19", title: "Messages, Orders and Service Jobs",
    items: [
      "All message pages: Payment Updated, Payment Reminder, Balance Confirmation, Dispatch, Stock Update, Stock Return, Service Material.",
      "Payments Received report with day totals, copy and CSV.",
      "Tally balances fill in automatically.",
      "Orders with pick lists, and Service Jobs with repaired / replaced tracking.",
    ],
  },
  {
    version: "3.0", date: "2026-11-18", title: "The new app",
    items: ["New look and layout for desktop and phone: Dashboard, Customers, Products and Transports."],
  },
];

export const latestRelease = RELEASES[0];
