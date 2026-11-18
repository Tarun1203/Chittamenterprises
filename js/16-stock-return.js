"use strict";

/* Stock Return template — acknowledges goods a customer has sent back:
   returned items with qty and value, reason, credit note no., and whether
   the amount has been credited to their account. */

pickers['sr-picker'] = buildPicker('sr-picker');

document.getElementById('sr-date').value = todayISO();

/* ---------------- returned item rows ---------------- */
function srAddItemRow(name, qty, amount){
  var wrap = document.getElementById('sr-items');
  var row = document.createElement('div');
  row.className = 'return-row';
  row.innerHTML =
    '<input type="text" class="sr-name" placeholder="Product name" value="' + escapeHtml(name||'') + '">' +
    '<input type="text" class="sr-qty" placeholder="Qty e.g. 2 pcs" value="' + escapeHtml(qty||'') + '">' +
    '<input type="number" class="sr-amount" placeholder="Value (₹)" value="' + (amount !== undefined && amount !== null && amount !== '' ? amount : '') + '">' +
    '<button type="button" class="row-del" title="Remove">✕</button>';
  row.querySelector('.row-del').addEventListener('click', function(){ wrap.removeChild(row); srUpdateTotal(); });
  row.querySelector('.sr-amount').addEventListener('input', srUpdateTotal);
  attachSuggest(row.querySelector('.sr-name'), productSuggestions);
  wrap.appendChild(row);
}

function srItems(){
  var items = [];
  document.querySelectorAll('#sr-items .return-row').forEach(function(row){
    var name = row.querySelector('.sr-name').value.trim();
    var qty = row.querySelector('.sr-qty').value.trim();
    var amount = Number(row.querySelector('.sr-amount').value) || 0;
    if(name) items.push({name: name, qty: qty, amount: amount});
  });
  return items;
}

function srUpdateTotal(){
  var t = srItems().reduce(function(sum, it){ return sum + it.amount; }, 0);
  document.getElementById('sr-total').textContent = inr(t);
}

document.getElementById('sr-add-item').addEventListener('click', function(){ srAddItemRow(); });
srAddItemRow();

/* ---------------- generator ---------------- */
function generateStockReturn(){
  var c = requireCustomer('sr-picker'); if(!c) return null;
  var s = getSettings();
  var items = srItems();
  if(items.length === 0){
    showToast('Add at least one returned item with a name first.');
    return null;
  }
  var date = formatDateForMsg(document.getElementById('sr-date').value);
  var cn = document.getElementById('sr-cn').value.trim();
  var invoice = document.getElementById('sr-invoice').value.trim();
  var reason = document.getElementById('sr-reason').value;
  var status = document.getElementById('sr-status').value;
  var notes = document.getElementById('sr-notes').value.trim();
  var total = items.reduce(function(sum, it){ return sum + it.amount; }, 0);
  var credit = Number(document.getElementById('sr-credit').value) || total;

  var lines = items.map(function(it){
    return "• " + it.name + (it.qty ? " × " + it.qty : "") + (it.amount ? " - " + inr(it.amount) : "");
  }).join("\n");

  var statusLine = {
    credited: "✅ The amount of " + inr(credit) + " has been credited to your account" + (cn ? " vide Credit Note No. " + cn : "") + ".",
    inspection: "🔍 The returned goods are under inspection. We will update you once the credit is processed.",
    replacement: "🔁 A replacement will be dispatched to you shortly."
  }[status];

  var signOff = s.businessName + (s.address ? ", " + s.address : "") + ",";
  return "↩️ *Stock Return Acknowledgement*\n\n" +
    "Namaste Anna/Sir 🙏\n" +
    "We have received the following returned goods from you.\n\n" +
    "📅 Date: " + date + "\n" +
    (cn ? "🧾 Credit Note No.: " + cn + "\n" : "") +
    (invoice ? "📄 Against Invoice No.: " + invoice + "\n" : "") +
    "📝 Reason: " + reason + "\n\n" +
    "*Returned Items:*\n" + lines + "\n" +
    (total ? "\n💰 *Total Return Value: " + inr(total) + "*\n" : "") +
    "\n" + statusLine + "\n" +
    (notes ? "\n📌 " + notes + "\n" : "") +
    "\nIf any detail above does not match your records, please let us know.\n\n" +
    "Thank you for your continued support. 🙏\n" +
    signOff;
}

generators['stock-return'] = {fn: generateStockReturn, previewId: 'sr-preview'};
