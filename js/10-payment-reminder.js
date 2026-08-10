"use strict";

/* Payment Reminder template (also covers what used to be a separate
   Outstanding Reminder template -- merged into one). */

pickers['pr-picker'] = buildPicker('pr-picker');

bindTotal('pr-eb','pr-cb','pr-total');

document.getElementById('pr-date').value = todayISO();

  function onlyDefaultOrAll(list){
    var def = list.filter(function(x){ return x.isDefault; });
    return def.length ? def : list;
  }

  function pendingDaysLabel(days){
    days = Number(days)||0;
    var label = days + " Day" + (days === 1 ? "" : "s");
    var years = Math.floor(days/365);
    if(years >= 1) label += " (" + years + " Year" + (years > 1 ? "s" : "") + ")";
    return label;
  }

  /* -- invoice rows with individual due dates -- */
  var prInvoiceRows = [];
  var prInvoiceSeq = 0;
  function prAddInvoiceRow(invoiceNo, amount, dueDate, account){
    var id = 'inv' + (prInvoiceSeq++);
    prInvoiceRows.push(id);
    var wrap = document.getElementById('pr-invoices');
    var name = getSettings().businessName || 'Chittam Enterprises';
    var row = document.createElement('div');
    row.className = 'invoice-row';
    row.dataset.rowId = id;
    row.innerHTML =
      '<input type="text" class="inv-no" placeholder="Invoice No." value="' + escapeHtml(invoiceNo||'') + '">' +
      '<input type="number" class="inv-amt" placeholder="Amount (₹)" value="' + (amount !== undefined && amount !== null ? amount : '') + '">' +
      '<input type="date" class="inv-due" value="' + (dueDate || '') + '">' +
      '<select class="inv-account">' +
        '<option value="business"' + (account !== 'cash' ? ' selected' : '') + '>' + escapeHtml(name) + '</option>' +
        '<option value="cash"' + (account === 'cash' ? ' selected' : '') + '>Cash</option>' +
      '</select>' +
      '<button type="button" class="row-del" title="Remove">✕</button>';
    row.querySelector('.row-del').addEventListener('click', function(){
      prInvoiceRows = prInvoiceRows.filter(function(r){ return r !== id; });
      wrap.removeChild(row);
    });
    wrap.appendChild(row);
  }
  document.getElementById('pr-add-invoice').addEventListener('click', function(){ prAddInvoiceRow(); });

  function invoiceStatus(dueIso){
    if(!dueIso) return '';
    var today = new Date(todayISO() + 'T00:00:00');
    var due = new Date(dueIso + 'T00:00:00');
    var diffDays = Math.round((due - today) / 86400000);
    if(diffDays < 0) return '⚠️ Overdue by ' + Math.abs(diffDays) + ' day' + (Math.abs(diffDays) === 1 ? '' : 's');
    if(diffDays === 0) return '📌 Due today';
    return '🕒 Due in ' + diffDays + ' day' + (diffDays === 1 ? '' : 's');
  }

  function generatePaymentReminder(){
    var c = requireCustomer('pr-picker'); if(!c) return null;
    var s = getSettings();
    var date = formatDateForMsg(document.getElementById('pr-date').value);
    var dueDate = formatDateForMsg(document.getElementById('pr-duedate').value);
    var eb = Number(document.getElementById('pr-eb').value)||0;
    var ed = Number(document.getElementById('pr-ed').value)||0;
    var cb = Number(document.getElementById('pr-cb').value)||0;
    var cd = Number(document.getElementById('pr-cd').value)||0;
    var total = eb + cb;
    var signOff = s.businessName;

    var invoiceRows = document.querySelectorAll('#pr-invoices .invoice-row');
    var invoices = [];
    invoiceRows.forEach(function(row){
      var no = row.querySelector('.inv-no').value.trim();
      var amt = Number(row.querySelector('.inv-amt').value)||0;
      var due = row.querySelector('.inv-due').value;
      var account = row.querySelector('.inv-account').value;
      if(no || due || amt){ invoices.push({no: no, amt: amt, due: due, account: account}); }
    });
    var invoiceBlock = '';
    if(invoices.length){
      var name2 = s.businessName;
      var groups = [
        {label: '🏢 *' + name2 + '*', items: invoices.filter(function(inv){ return inv.account !== 'cash'; })},
        {label: '💵 *Cash*', items: invoices.filter(function(inv){ return inv.account === 'cash'; })}
      ];
      invoiceBlock = "🧾 *Invoice-wise Due Dates*\n";
      groups.forEach(function(g){
        if(!g.items.length) return;
        invoiceBlock += g.label + "\n";
        g.items.forEach(function(inv){
          var parts = [];
          if(inv.amt) parts.push(inr(inv.amt));
          if(inv.due){
            parts.push('Due ' + formatDateForMsg(inv.due) + ' (' + invoiceStatus(inv.due) + ')');
          }
          invoiceBlock += "• " + (inv.no || 'Invoice') + (parts.length ? " — " + parts.join(' — ') : '') + "\n";
        });
      });
      invoiceBlock += "\n";
    }

    var clearLine = dueDate
      ? ("Kindly clear the payment by *" + dueDate + "*.")
      : "Kindly clear the payment at the earliest.";
    var msg = "💳 *Payment Reminder*\n" +
      "*Namaste Anna/Sir* 🙏\n" +
      "As per our records, the following amount is pending as on *" + date + "*.\n\n" +
      "🏢 *" + s.businessName + "*\n" +
      "💰 *Outstanding:* *" + inr(eb) + "*\n" +
      "📅 *Pending:* *" + pendingDaysLabel(ed) + "*\n\n" +
      "💵 *Cash*\n" +
      "💰 *Outstanding:* *" + inr(cb) + "*\n" +
      "📅 *Pending:* *" + pendingDaysLabel(cd) + "*\n\n" +
      "🔹 *Total Outstanding:* " + inr(total) + "\n\n" +
      invoiceBlock +
      clearLine + " We are currently placing orders for the upcoming season, and your timely payment will help us ensure uninterrupted supply and better service.\n\n";
    if(s.upiList && s.upiList.length){
      var upiSorted = onlyDefaultOrAll(s.upiList);
      msg += "📲 *UPI (GPay/PhonePe):*\n" + upiSorted.map(function(u){
        return u.upiId + (u.payeeName ? " – " + u.payeeName : "");
      }).join("\n") + "\n\n";
    }
    if(s.bankList && s.bankList.length){
      var bankSorted = onlyDefaultOrAll(s.bankList);
      bankSorted.forEach(function(b, i){
        var heading = "🏦 *Bank Account Details" + (bankSorted.length > 1 ? " " + (i+1) : "") + "*";
        msg += heading + "\n" + s.businessName + (b.label ? " (" + b.label + ")" : "") + "\n" +
          (b.accountNo ? "A/C No.: " + b.accountNo + " (Current A/C)\n" : "") +
          (b.ifsc ? "IFSC: " + b.ifsc + "\n" : "") +
          (b.bankBranch ? b.bankBranch + "\n" : "") + "\n";
      });
    }
    msg += "Thank you for your continued support. 🙏\n" + signOff;
    return msg;
  }

generators['payment-reminder'] = {fn: generatePaymentReminder, previewId: 'pr-preview'};
