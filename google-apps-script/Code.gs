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
 * If you ever change this script, you must create a New deployment (or
 * "Manage deployments" → edit → New version) for the changes to take
 * effect — saving the script alone is not enough.
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
