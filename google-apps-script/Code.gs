/**
 * Chittam Message Generator — Cloud Sync backend.
 *
 * This turns a Google Sheet into a tiny free API so the app can Push and
 * Pull customers, products, and settings between devices.
 *
 * SETUP (one-time):
 * 1. Go to https://sheets.new to create a fresh Google Sheet.
 *    (You can rename it, e.g. "Chittam Message Generator Data".)
 * 2. In the Sheet, click Extensions → Apps Script.
 * 3. Delete anything in the editor and paste this entire file in its place.
 * 4. Click Deploy → New deployment.
 *    - Click the gear icon next to "Select type" and choose "Web app".
 *    - Description: anything, e.g. "sync".
 *    - Execute as: Me.
 *    - Who has access: Anyone.
 *    - Click Deploy, then Authorize access (it's your own script, so this
 *      is safe) and approve the permissions Google asks for.
 * 5. Copy the "Web app URL" it gives you (ends in /exec).
 * 6. In the app, go to Settings → Cloud Sync, paste that URL into
 *    "Google Sheet Web App URL", then click "Push to Sheet" from your main
 *    device once. From then on, click "Pull from Sheet" on any other
 *    device to bring it up to date, and "Push to Sheet" whenever you want
 *    to save your latest changes back up.
 *
 * You can open the Sheet itself any time to see your Customers and
 * Products as plain rows, the same way you'd view them in Excel or Tally.
 *
 * TALLY DAILY TRANSACTIONS (optional):
 * 7. In Apps Script, open Project Settings (gear icon) → Script Properties
 *    → Add script property. Name: ACCESS_KEY, Value: any long password
 *    you make up (e.g. 20+ random letters and numbers). Save.
 * 8. Deploy → Manage deployments → edit (pencil) → Version: New version →
 *    Deploy. The /exec URL stays the same.
 * 9. Paste the same ACCESS_KEY into the app (Settings → Cloud Sync →
 *    Access Key) and into tally-bridge/tally-sync.config.json on the Tally
 *    PC. See tally-bridge/README.md for the rest.
 *    Vouchers land in a "Transactions" tab; only someone with the key can
 *    read or write them.
 *
 * If you ever change this script, you must create a New deployment (or
 * "Manage deployments" → edit → New version) for the changes to take
 * effect — saving the script alone is not enough.
 */

var TX_HEADERS = ['date', 'company', 'voucherType', 'voucherNo', 'party', 'amount', 'narration', 'items', 'guid', 'syncedAt'];

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var params = (e && e.parameter) || {};
  if (params.action === 'transactions') return json_(readTransactions_(ss, params));
  var data = {
    customers: readSheet_(ss, 'Customers', ['id', 'name', 'mobile']),
    products: readSheet_(ss, 'Products', ['id', 'name', 'category', 'price']),
    settings: readSettings_(ss)
  };
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Bad JSON body' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Tally bridge upload — never touches Customers / Products / Settings
  if (body.action === 'tallyTransactions') return json_(writeTransactions_(ss, body));

  writeSheet_(ss, 'Customers', body.customers || [], ['id', 'name', 'mobile']);
  writeSheet_(ss, 'Products', body.products || [], ['id', 'name', 'category', 'price']);
  writeSettings_(ss, body.settings || {});

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- helpers ---------------- */

function getOrCreateSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function readSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var fileHeaders = values[0];
  var rows = values.slice(1);
  return rows
    .filter(function (r) { return r[0] !== '' && r[0] !== null; })
    .map(function (r) {
      var obj = {};
      fileHeaders.forEach(function (h, i) { obj[h] = r[i]; });
      return obj;
    });
}

function writeSheet_(ss, name, items, headers) {
  var sh = getOrCreateSheet_(ss, name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (items.length) {
    var rows = items.map(function (it) {
      return headers.map(function (h) { return it[h] !== undefined ? it[h] : ''; });
    });
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function readSettings_(ss) {
  var sh = ss.getSheetByName('Settings');
  if (!sh) return {};
  var json = sh.getRange('A1').getValue();
  try { return JSON.parse(json || '{}'); } catch (e) { return {}; }
}

function writeSettings_(ss, settings) {
  var sh = getOrCreateSheet_(ss, 'Settings');
  sh.clearContents();
  sh.getRange('A1').setValue(JSON.stringify(settings));
  sh.getRange('B1').setValue('(raw settings JSON — edit only via the app, not here)');
}

/* ---------------- Tally daily transactions ---------------- */

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function keyOk_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  return !!expected && key === expected;
}

// Replaces every row for the companies + dates the bridge sent, so
// re-running a sync for the same day never creates duplicates.
function writeTransactions_(ss, body) {
  if (!keyOk_(body.key)) return { ok: false, error: 'Wrong or missing access key (set ACCESS_KEY in Script Properties).' };
  var dates = body.dates || [];
  var companies = body.companies || [];
  var txs = body.transactions || [];
  if (!dates.length) return { ok: false, error: 'No dates sent' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getOrCreateSheet_(ss, 'Transactions');
    var values = sh.getDataRange().getValues();
    var kept = values.length > 1 ? values.slice(1).filter(function (r) {
      return r[0] !== '' && !(dates.indexOf(String(r[0])) > -1 && companies.indexOf(String(r[1])) > -1);
    }) : [];
    var now = new Date().toISOString();
    var fresh = txs.map(function (t) {
      return [t.date, t.company || '', t.voucherType, t.voucherNo, t.party, Number(t.amount) || 0,
        t.narration || '', JSON.stringify(t.items || []), t.guid || '', now];
    });
    var rows = kept.concat(fresh);
    rows.sort(function (a, b) { return String(a[0]) < String(b[0]) ? -1 : (String(a[0]) > String(b[0]) ? 1 : 0); });

    sh.clearContents();
    // plain text so the sheet never turns "2026-11-18" or voucher nos into dates/numbers
    sh.getRange(1, 1, rows.length + 1, TX_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 6, rows.length + 1, 1).setNumberFormat('0.00');
    sh.getRange(1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS]);
    if (rows.length) sh.getRange(2, 1, rows.length, TX_HEADERS.length).setValues(rows);

    PropertiesService.getScriptProperties().setProperty('TALLY_LAST_SYNC', JSON.stringify({
      at: now, companies: companies, dates: dates, count: txs.length
    }));
    return { ok: true, written: fresh.length };
  } finally {
    lock.releaseLock();
  }
}

function readTransactions_(ss, params) {
  if (!keyOk_(params.key)) return { ok: false, error: 'Wrong or missing access key.' };
  var from = params.from || params.date || '';
  var to = params.to || params.date || from;
  var sh = ss.getSheetByName('Transactions');
  var list = [];
  if (sh) {
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      var d = String(r[0]);
      if (!d || (from && d < from) || (to && d > to)) continue;
      var items = [];
      try { items = JSON.parse(r[7] || '[]'); } catch (err) {}
      list.push({ date: d, company: r[1], voucherType: r[2], voucherNo: String(r[3]), party: r[4], amount: Number(r[5]) || 0,
        narration: r[6], items: items, guid: r[8], syncedAt: r[9] });
    }
  }
  var last = PropertiesService.getScriptProperties().getProperty('TALLY_LAST_SYNC');
  return { ok: true, transactions: list, lastSync: last ? JSON.parse(last) : null };
}
