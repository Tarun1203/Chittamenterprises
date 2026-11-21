// What changed in each version, newest first. Shown on the What's new page
// and, once, after a device updates. Add an entry with every release.
export interface Release { version: string; date: string; title: string; items: string[]; windows?: string }

export const RELEASES: Release[] = [
  {
    version: "3.29", date: "2026-11-21", title: "Ledger Statement shows every company it checked",
    items: [
      "Under the customer, Ledger Statement now lists every Tally company (Chittam Enterprises, Cash, Vamana Enterprises…) marked “included” or “no account”.",
      "A company is in the statement when the customer has a Tally balance or transactions there; otherwise it shows “no account”, so you can see it was checked.",
    ],
  },
  {
    version: "3.28", date: "2026-11-20", title: "Added Tally companies show in Settings",
    items: [
      "Settings → Tally balances now lists every company synced from Tally (for example Vamana Enterprises), with when it was synced and how many customers it has — not just Chittam Enterprises and Cash.",
      "The Tally stock note on Orders now says it adds up all companies.",
    ],
  },
  {
    version: "3.27", date: "2026-11-20", title: "Encryption: the data in Firebase scrambled with your own passphrase", windows: "3.4",
    items: [
      "Settings → Encryption → Turn on encryption…: choose a passphrase for the team. Every record (customers, products, orders, payments, Tally balances and transactions, settings) is then stored scrambled, so not even Google can read it.",
      "Each phone, browser and the Windows app asks for the passphrase once. The old app works with it too.",
      "If the passphrase is forgotten on every device, the data can't be recovered — write it down.",
      "Windows app 3.4: Tally Sync → Passphrase… to enter it on the Tally PC. Until then the sync waits.",
      "History and saved messages from before encryption stay as they were; new ones are encrypted.",
    ],
  },
  {
    version: "3.26", date: "2026-11-20", title: "More Tally companies, and a “sync from” date per company", windows: "3.3",
    items: [
      "Windows app → Tally Sync → Companies…: add more Tally companies — give each a name (how the app shows it) and pick its Tally company. Each is synced like Chittam Enterprises and Cash: balances, open bills, transactions and stock.",
      "Every company can have its own “Sync from” date for transactions (blank = from 1 April).",
      "The added companies appear everywhere: customer balances, Payment Updated (its own previous balance and amount received), Payments Received, Balance Confirmation, Payment Reminder, Ledger Statement and PDF, Tally Match (filter, balances, Record) and Post to Tally.",
      "Messages read exactly as before when only Chittam Enterprises and Cash are used; an added company's lines appear only when it has a balance or amount.",
    ],
  },
  {
    version: "3.25", date: "2026-11-20", title: "Orders: open, delivered-with-pending and delivered in separate sections",
    items: [
      "Orders now shows open orders first.",
      "Delivered orders that still owe items get their own section, “Delivered — items still pending”, listing only the items still to be sent.",
      "Fully delivered and cancelled orders are hidden behind “Show delivered & cancelled”. Picking a status in the filter still shows just that status.",
    ],
  },
  {
    version: "3.24", date: "2026-11-20", title: "Post to Tally: choose Chittam Enterprises or Cash",
    items: [
      "Post to Tally now lets you pick the company — Chittam Enterprises or Cash. The customer's Tally ledger, their open bills and the cash / bank ledgers all switch to that company.",
      "Posting into the other company than the one the payment was entered under? A tick box (on by default) also moves the payment to that company in the app — only after Tally confirms the voucher — so Tally Match agrees. The move is noted on the payment and kept in History.",
    ],
  },
  {
    version: "3.23", date: "2026-11-20", title: "Phone layout fixes",
    items: [
      "Lists of cards (customers, orders, service jobs, Tally Match…) no longer run past the phone's edge when a name is long — long names end with “…” instead.",
      "Pop-up windows: the buttons at the bottom (Remove, Ledger statement, Cancel, Save…) no longer squash or get cut off — they move to a second line on small phones.",
      "Date boxes side by side (From / To, mode / date) stack one under the other on narrow phones, so the whole date shows.",
      "Orders and Service Jobs: the search box gets the full width on phones, with the status filter below it.",
      "Tally Match: all four tabs (Payments, Duplicates, Sales & returns, Balances) are visible on phones instead of hiding off to the right.",
    ],
  },
  {
    version: "3.22", date: "2026-11-20", title: "Find and merge duplicate customers; remove customers",
    items: [
      "Customers → Possible duplicates: finds customers saved twice — the same name written differently, a small spelling slip, or the same mobile number — and shows each one's orders, service jobs, payments and whether it's in Tally.",
      "Pick the one to keep and Merge: the others' orders, service jobs and payments move to it, and the others are kept as “merged” (nothing is deleted). Messages already sent stay as they were. “Not duplicates” stops a pair being suggested again.",
      "Remove a customer (edit → Remove): hidden from every list and picker but kept, and restorable under “Show removed & merged”.",
      "Ledger PDF: the Grand Total line now sits inside the balance summary box.",
    ],
  },
  {
    version: "3.21", date: "2026-11-20", title: "App receipts stand out in Tally's Day Book", windows: "3.2",
    items: [
      "Post to Tally now creates the voucher as type “App Receipt” (under Receipt), so receipts entered from the app show in their own Vch Type column in Tally's Day Book and can be filtered.",
      "The first post in each company creates the “App Receipt” voucher type once (numbered like your Receipt type); the confirmation says so.",
      "The narration also starts with “[Chittam App]”.",
    ],
  },
  {
    version: "3.20", date: "2026-11-20", title: "Ledger: pending bills with days, highlighted totals; buy-and-sell parties", windows: "3.1",
    items: [
      "Ledger Statement: “Include pending bills” adds each company's open bills — bill no., date, due date, number of days and days overdue — on screen, in the PDF and in the WhatsApp message.",
      "Ledger PDF: Particulars show the voucher type (Sales, Receipt…) instead of the list of ledgers; each company's closing balance is highlighted, and a summary box shows both companies and the grand total.",
      "If the ledger runs past one page, Chittam Enterprises and Cash each start on their own page.",
      "Parties you both buy from and sell to stay under Sundry Creditors in Tally: when such a party is a customer in the app, its balance and transactions are now synced too (Windows app 3.1). The earlier “move it to Debtors” warning is removed.",
    ],
  },
  {
    version: "3.19", date: "2026-11-19", title: "Warning for customers filed under Creditors in Tally", windows: "3.0",
    items: [
      "The Windows app now checks, on every sync, for customers whose Tally ledger is under Sundry Creditors instead of Sundry Debtors — their balance and transactions would otherwise be missed (shown as 0).",
      "A red note names the customer, the company and Tally's balance on Balance Confirmation, Payment Reminder, Payment Updated and Ledger Statement, and Tally Match lists them all. Fix: in Tally, alter the ledger and set “Under” to Sundry Debtors (or a group under it).",
    ],
  },
  {
    version: "3.18", date: "2026-11-19", title: "Any voucher as a PDF in Tally's format; ledger from 1 April", windows: "2.9",
    items: [
      "Ledger Statement: every transaction has a PDF button — send that voucher on WhatsApp, printed like Tally: sales invoices, credit notes and purchases as a Tax Invoice (items, HSN, quantity, rate, GST, HSN tax summary, amount in words), receipts and payments as Tally's Receipt / Payment Voucher (bills adjusted, bank details), journals with Dr / Cr.",
      "On the Tally PC (Windows app) the full voucher is read from Tally; on a phone the PDF is made from the synced summary.",
      "The ledger PDF now follows Tally's Ledger Account layout: To / By, Vch Type, Vch No., Debit, Credit, Current Total and Closing Balance.",
      "Transactions now sync from 1 April (start of the financial year), not only the last 90 days — so the ledger covers the whole year (Windows app 2.9).",
    ],
  },
  {
    version: "3.17", date: "2026-11-19", title: "PDFs straight to WhatsApp; advance payments in Tally", windows: "2.8",
    items: [
      "Ledger Statement: “Send ledger PDF on WhatsApp” makes a proper PDF of both accounts. On a phone, pick WhatsApp from the share sheet. In the Windows app, the PDF is saved and copied and the customer's WhatsApp chat opens — just press Ctrl+V, then Send.",
      "Payment receipts as PDF: “Send receipt PDF on WhatsApp” on Payment Updated (with both balances), and a PDF button on every payment in Payments Received.",
      "Post to Tally: any amount beyond the chosen bills can go On Account, as a New Ref, or as an Advance payment, under a reference you can name.",
      "Bank payments now default to one of Tally's bank ledgers.",
      "The Windows app keeps every PDF in Documents → Chittam Enterprises → Ledgers / Receipts.",
    ],
  },
  {
    version: "3.16", date: "2026-11-19", title: "Payment details and bill-wise posting to Tally", windows: "2.7",
    items: [
      "Payment Updated and Receipts: “Received by” for cash payments, and “Transaction ID / UTR / Cheque no.” for other modes. Shown in the customer's message and the receipts list.",
      "Post to Tally now asks which bills the payment settles: the customer's open Tally bills, filled oldest first, with amounts you can change; anything left goes On Account.",
      "When received into a bank ledger: type of payment (Cheque, e-Fund Transfer, Others), instrument no., instrument date and bank name go into the Tally voucher's bank details.",
      "The Windows app's confirmation lists the bills and transaction details before the voucher is created (Windows app 2.7, updates itself).",
    ],
  },
  {
    version: "3.15", date: "2026-11-19", title: "Ledger statement for both companies",
    items: [
      "New Messages → Ledger Statement: a customer's account in Chittam Enterprises and Cash — opening balance, every transaction with a running balance, closing balance and the total outstanding.",
      "Share it on WhatsApp, copy it, or Print / PDF (an A4 statement; choose “Save as PDF” to send it as a file).",
      "Opened straight from a customer (Customers → edit → Ledger statement), from Tally Match → Balances (tap the name) and from Payment Reminder.",
      "Built from the synced Tally transactions and balances; covers the synced period (last 90 days by default, up to 366 in the Windows app's Tally Sync settings).",
    ],
  },
  {
    version: "3.14", date: "2026-11-19", title: "Post receipts to Tally; Windows installer", windows: "2.6",
    items: [
      "Tally Match (in the Windows app on the Tally PC): “Post to Tally” on a payment that isn't in Tally creates the Receipt voucher — customer's Tally ledger, received into Cash or a bank ledger you pick, narration — after a confirmation showing the whole voucher. Logged in History.",
      "The Windows app now has a proper installer (ChittamEnterprisesSetup.exe): installs without admin rights, shows in Settings → Apps with Uninstall, adds shortcuts and can start with Windows.",
    ],
  },
  {
    version: "3.13", date: "2026-11-19", title: "Windows app updates itself; new financial year by itself", windows: "2.5",
    items: [
      "The Windows app checks for a new version at start-up and every 6 hours, downloads it in the background (checked against its checksum) and installs it the next time it starts — or right away from the tray: Restart to update.",
      "When Tally has a newer company of the same name open (e.g. “Chittam Enterprises - 2027”) with customer balances, the sync moves to it by itself and notes it in History.",
    ],
  },
  {
    version: "3.12", date: "2026-11-19", title: "Sales & returns check, out-of-date warning, reliable Tally transactions", windows: "2.4",
    items: [
      "Tally Match → Sales & returns: Tally invoices with no dispatch message, orders not invoiced in Tally, dispatch messages whose invoice isn't in Tally, credit notes with no stock return message, and stock returns with no credit note.",
      "A warning wherever Tally figures are used (Payment Updated, Reminder, Balance Confirmation, Orders, Tally Match) when they're over 2 hours old or Tally couldn't be reached.",
      "Windows app 2.4 reads Tally transactions straight from the vouchers, so they no longer depend on what's open on Tally's screen — this was why K K's receipt stopped matching. Amounts are no longer counted twice.",
    ],
  },
  {
    version: "3.11", date: "2026-11-19", title: "New customers and products come from Tally", windows: "2.3",
    items: [
      "A customer ledger created in Tally (under Sundry Debtors) appears in Customers by itself, with its mobile; a customer without a mobile gets Tally's.",
      "New Tally stock items you sell (in stock, or with a selling price; not assets or dummy items) appear in Products with their group and price.",
      "Prices follow Tally only where Tally has a selling price — Tally's item rate is the purchase cost, so your own prices aren't overwritten.",
      "Names spelled almost the same as an existing customer aren't added twice; the Tally Sync log lists them so one can be renamed.",
      "Every addition and change shows in History.",
    ],
  },
  {
    version: "3.10", date: "2026-11-19", title: "Tally Match: payments entered twice",
    items: [
      "A payment whose Tally receipt is already matched to another payment of the same customer now shows under “Recorded twice in the app”, saying which payment it repeats — instead of “not found in Tally”.",
      "“Cancel this payment” right there (kept in Payments Received, left out of totals).",
    ],
  },
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
