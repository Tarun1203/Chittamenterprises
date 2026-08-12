"use strict";

/* Service Material Dispatch template — sends service stock details to a
   dealer: items with product name, qty, serial no., issue, and charges,
   plus transport, delivery date, repair timeline, and notes. */

pickers['sm-picker'] = buildPicker('sm-picker');

document.getElementById('sm-date').value = todayISO();

/* ---------------- service item rows ---------------- */
var smItemRows = [];
var smItemSeq = 0;

function smAddItemRow(product, qty, serialNo, issue, charges){
  var id = 'smi' + (smItemSeq++);
  smItemRows.push(id);
  var wrap = document.getElementById('sm-items');
  var row = document.createElement('div');
  row.className = 'invoice-row';
  row.dataset.rowId = id;
  row.innerHTML =
    '<input type="text" class="sm-product" placeholder="Product name" value="' + escapeHtml(product||'') + '">' +
    '<input type="number" class="sm-qty" placeholder="Qty" value="' + (qty !== undefined && qty !== null ? qty : '') + '" style="min-width:0;">' +
    '<input type="text" class="sm-serial" placeholder="Serial No." value="' + escapeHtml(serialNo||'') + '">' +
    '<input type="text" class="sm-issue" placeholder="Issue description" value="' + escapeHtml(issue||'') + '">' +
    '<input type="number" class="sm-charges" placeholder="0" value="' + (charges !== undefined && charges !== null ? charges : '') + '">' +
    '<button type="button" class="row-del" title="Remove">✕</button>';
  row.querySelector('.row-del').addEventListener('click', function(){
    smItemRows = smItemRows.filter(function(r){ return r !== id; });
    wrap.removeChild(row);
  });
  wrap.appendChild(row);
}

document.getElementById('sm-add-item').addEventListener('click', function(){ smAddItemRow(); });

// Start with two blank rows
smAddItemRow(); smAddItemRow();

/* ---------------- generator ---------------- */
function generateServiceMaterial(){
  var c = requireCustomer('sm-picker'); if(!c) return null;
  var s = getSettings();
  var date = formatDateForMsg(document.getElementById('sm-date').value);
  var transport = document.getElementById('sm-transport').value.trim() || '—';
  var deliveryDate = formatDateForMsg(document.getElementById('sm-delivery-date').value);
  var timeline = document.getElementById('sm-timeline').value.trim();
  var notes = document.getElementById('sm-notes').value.trim();

  var rows = document.querySelectorAll('#sm-items .invoice-row');
  var items = [];
  var totalCharges = 0;
  rows.forEach(function(row){
    var product = row.querySelector('.sm-product').value.trim();
    var qty = row.querySelector('.sm-qty').value.trim();
    var serial = row.querySelector('.sm-serial').value.trim();
    var issue = row.querySelector('.sm-issue').value.trim();
    var charges = Number(row.querySelector('.sm-charges').value)||0;
    if(product || serial || issue){ items.push({product:product, qty:qty, serial:serial, issue:issue, charges:charges}); totalCharges += charges; }
  });
  if(items.length === 0){ showToast('Add at least one service item first.'); return null; }

  var signOff = s.businessName + (s.address ? ', ' + s.address : '');

  var msg = "🔧 *Service Material Dispatch*\n" +
    "Namaste Anna/Sir 🙏\n\n" +
    "We are sending the following service material to *" + escapeHtml(c.name) + "*.\n\n" +
    "📅 *Date:* " + date + "\n" +
    "🚛 *Transport:* " + transport + "\n" +
    (deliveryDate ? "📦 *Expected Delivery:* " + deliveryDate + "\n" : "") +
    (timeline ? "⏱ *Service Timeline:* " + timeline + "\n" : "") +
    "\n";

  msg += "📋 *Item Details*\n";
  items.forEach(function(it, i){
    msg += "\n*Item " + (i+1) + ":*\n";
    if(it.product) msg += "🛠 Product: " + it.product + "\n";
    if(it.qty)     msg += "📦 Qty: " + it.qty + "\n";
    if(it.serial)  msg += "🔢 Serial No.: " + it.serial + "\n";
    if(it.issue)   msg += "⚠️ Issue: " + it.issue + "\n";
    if(it.charges) msg += "💰 Charges: " + inr(it.charges) + "\n";
  });

  if(totalCharges > 0){
    msg += "\n💳 *Total Service Charges: " + inr(totalCharges) + "*\n";
  }

  if(notes){
    msg += "\n📝 *Note:* " + notes + "\n";
  }

  msg += "\nOnce the material is received, kindly confirm:\n" +
    "✅ Material Received\n" +
    "✅ Quantity Verified\n" +
    "✅ Serial Numbers Matched\n\n" +
    "If you notice any shortage or discrepancy, please inform us immediately.\n\n" +
    "Thank you for your continued support. 🙏\n" +
    signOff;

  return msg;
}

generators['service-material'] = {fn: generateServiceMaterial, previewId: 'sm-preview'};
