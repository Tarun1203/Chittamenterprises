"use strict";

/* Payments received (the report under the Payment Updated form): every
   payment, saved in the database, shown date-wise. Entries come from
     - Payment Updated: generating the message records the receipt
       (one per customer per day — generating again after a correction
       updates it instead of adding a second one),
     - Orders: an advance paid on an order,
     - "+ Add Payment" for anything else.
   Receipts can be edited and cancelled, never deleted. */

pickers['rc-picker'] = buildPicker('rc-picker');

  var editingReceiptId = null;

  function receiptTotal(r){ return (Number(r.business) || 0) + (Number(r.cash) || 0); }

  // insert or update one receipt by id
  function upsertReceipt(rec){
    var list = getReceipts();
    var i = list.findIndex(function(r){ return r.id === rec.id; });
    if(i > -1) list[i] = Object.assign({}, list[i], rec);
    else list.push(rec);
    saveReceipts(list);
    renderReceipts();
  }

  // called by Payment Updated when its message is generated
  function recordPaymentReceipt(c, dateISO, mode, business, cash){
    if(!c || (!business && !cash)) return;
    upsertReceipt({
      id: 'pu_' + c.id + '_' + dateISO,
      date: dateISO, customerId: c.id, customerName: c.name,
      mode: mode, business: business, cash: cash,
      source: 'Payment Updated', ref: '', note: '', cancelled: false
    });
  }

  // called by Orders on save: the advance paid on that order
  function recordOrderAdvance(orderId, o){
    var id = 'ord_' + orderId;
    var exists = getReceipts().some(function(r){ return r.id === id; });
    if(!o.advance && !exists) return;
    upsertReceipt({
      id: id, date: o.date, customerId: o.customerId, customerName: o.customerName,
      mode: 'Advance', business: Number(o.advance) || 0, cash: 0,
      source: 'Order advance', ref: o.orderNo, note: '', cancelled: !o.advance
    });
  }

  /* ---------------- report ---------------- */
  function monthStartISO(){ return todayISO().slice(0, 8) + '01'; }
  document.getElementById('rcFrom').value = monthStartISO();
  document.getElementById('rcTo').value = todayISO();

  function filteredReceipts(){
    var from = document.getElementById('rcFrom').value, to = document.getElementById('rcTo').value;
    var mode = document.getElementById('rcMode').value;
    var q = document.getElementById('rcSearch').value.trim().toLowerCase();
    return getReceipts().filter(function(r){
      if(from && r.date < from) return false;
      if(to && r.date > to) return false;
      if(mode && r.mode !== mode) return false;
      if(q && [r.customerName, r.ref, r.note, r.mode].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function(a, b){ return b.date.localeCompare(a.date) || String(a.customerName).localeCompare(String(b.customerName)); });
  }

  function refreshModeFilter(){
    var sel = document.getElementById('rcMode');
    var cur = sel.value;
    var modes = [];
    getReceipts().forEach(function(r){ if(r.mode && modes.indexOf(r.mode) === -1) modes.push(r.mode); });
    modes.sort();
    sel.innerHTML = '<option value="">All Modes</option>' + modes.map(function(m){ return '<option>' + escapeHtml(m) + '</option>'; }).join('');
    sel.value = modes.indexOf(cur) > -1 ? cur : '';
  }

  function renderReceipts(){
    refreshModeFilter();
    var list = filteredReceipts();
    var live = list.filter(function(r){ return !r.cancelled; });
    var total = 0, business = 0, cash = 0, byMode = {};
    live.forEach(function(r){
      business += Number(r.business) || 0; cash += Number(r.cash) || 0;
      total += receiptTotal(r);
      byMode[r.mode || '—'] = (byMode[r.mode || '—'] || 0) + receiptTotal(r);
    });
    var biz = getSettings().businessName || 'Business';
    document.getElementById('rcSummary').innerHTML = list.length ?
      '<span class="or-chip">Total received<strong>' + inr(total) + '</strong></span>' +
      '<span class="or-chip">' + escapeHtml(biz) + ' a/c<strong>' + inr(business) + '</strong></span>' +
      '<span class="or-chip">Cash a/c<strong>' + inr(cash) + '</strong></span>' +
      '<span class="or-chip">Payments<strong>' + live.length + '</strong></span>' +
      Object.keys(byMode).sort().map(function(m){ return '<span class="or-chip">' + escapeHtml(m) + '<strong>' + inr(byMode[m]) + '</strong></span>'; }).join('') : '';

    var wrap = document.getElementById('rcList');
    if(list.length === 0){
      wrap.innerHTML = '<div class="empty-state">No payments in this period. A payment is added when you generate a Payment Updated message above, save an order with an advance, or click "+ Add Payment".</div>';
      return;
    }
    // group by date
    var days = [];
    list.forEach(function(r){
      var d = days[days.length - 1];
      if(!d || d.date !== r.date){ d = {date: r.date, rows: []}; days.push(d); }
      d.rows.push(r);
    });
    wrap.innerHTML = days.map(function(d){
      var dayTotal = d.rows.filter(function(r){ return !r.cancelled; }).reduce(function(s, r){ return s + receiptTotal(r); }, 0);
      return '<div class="rc-day"><div class="rc-day-head"><span>' + escapeHtml(formatDateForMsg(d.date)) + '</span><strong>' + inr(dayTotal) + '</strong></div>' +
        '<table class="cust-table"><thead><tr><th>Customer</th><th>Mode</th><th style="text-align:right;">' + escapeHtml(biz) + '</th><th style="text-align:right;">Cash</th><th style="text-align:right;">Total</th><th>From</th><th></th></tr></thead><tbody>' +
        d.rows.map(function(r){
          return '<tr class="' + (r.cancelled ? 'rc-cancelled' : '') + '">' +
            '<td>' + escapeHtml(r.customerName || '—') + (r.note ? '<div class="tx-narr">' + escapeHtml(r.note) + '</div>' : '') + '</td>' +
            '<td>' + escapeHtml(r.mode || '—') + '</td>' +
            '<td class="num">' + (r.business ? inr(r.business) : '—') + '</td>' +
            '<td class="num">' + (r.cash ? inr(r.cash) : '—') + '</td>' +
            '<td class="num"><strong>' + inr(receiptTotal(r)) + '</strong>' + (r.cancelled ? ' <span class="or-status s-cancelled">Cancelled</span>' : '') + '</td>' +
            '<td style="font-size:12.5px; color:var(--ink-soft);">' + escapeHtml(r.source + (r.ref ? ' ' + r.ref : '')) + '</td>' +
            '<td><div class="row-actions"><button class="icon-btn" data-rc-edit="' + escapeHtml(r.id) + '">Edit</button></div></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
  }

  ['rcFrom', 'rcTo', 'rcMode'].forEach(function(id){ document.getElementById(id).addEventListener('change', renderReceipts); });
  document.getElementById('rcSearch').addEventListener('input', renderReceipts);

  /* ---------------- copy / CSV ---------------- */
  function reportText(){
    var list = filteredReceipts().filter(function(r){ return !r.cancelled; });
    var from = document.getElementById('rcFrom').value, to = document.getElementById('rcTo').value;
    var s = getSettings();
    var lines = ["💵 *Payments Received — " + (s.businessName || 'Chittam Enterprises') + "*",
      formatDateForMsg(from) + (to && to !== from ? " to " + formatDateForMsg(to) : ""), ""];
    var grand = 0, day = null, dayTotal = 0, dayLines = [];
    function flush(){ if(day){ lines.push("📅 *" + formatDateForMsg(day) + " — " + inr(dayTotal) + "*"); lines.push.apply(lines, dayLines); lines.push(""); } }
    list.forEach(function(r){
      if(r.date !== day){ flush(); day = r.date; dayTotal = 0; dayLines = []; }
      dayTotal += receiptTotal(r); grand += receiptTotal(r);
      dayLines.push("• " + r.customerName + " — " + inr(receiptTotal(r)) + " (" + (r.mode || '—') + ")");
    });
    flush();
    lines.push("*Total received: " + inr(grand) + "* (" + list.length + " payment" + (list.length === 1 ? "" : "s") + ")");
    return lines.join("\n");
  }
  document.getElementById('btnRcCopy').addEventListener('click', function(){
    var t = reportText();
    function done(){ showToast('Payments report copied.'); if(typeof dbLogEvent === 'function') dbLogEvent('receipts-report-copied', {}); }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(function(){ fallbackCopy(t); done(); });
    else { fallbackCopy(t); done(); }
  });
  document.getElementById('btnRcCsv').addEventListener('click', function(){
    var biz = getSettings().businessName || 'Business';
    var rows = [['Date', 'Customer', 'Mode', biz + ' (Rs)', 'Cash (Rs)', 'Total (Rs)', 'From', 'Ref', 'Note', 'Cancelled']];
    filteredReceipts().slice().reverse().forEach(function(r){
      rows.push([r.date, r.customerName, r.mode, r.business || 0, r.cash || 0, receiptTotal(r), r.source, r.ref || '', r.note || '', r.cancelled ? 'Yes' : '']);
    });
    var csv = rows.map(function(row){ return row.map(function(v){ v = String(v === undefined ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'payments-' + document.getElementById('rcFrom').value + '-to-' + document.getElementById('rcTo').value + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    if(typeof dbLogEvent === 'function') dbLogEvent('receipts-report-downloaded', {rows: rows.length - 1});
  });

  /* ---------------- add / edit ---------------- */
  var rcModal = document.getElementById('rcModalOverlay');
  function openReceiptModal(r){
    editingReceiptId = r ? r.id : null;
    document.getElementById('rcModalTitle').textContent = r ? 'Edit Payment' : 'Add Payment';
    var modes = (getSettings().paymentModes || []).slice();
    if(r && r.mode && modes.indexOf(r.mode) === -1) modes.push(r.mode);
    document.getElementById('rm-mode').innerHTML = modes.map(function(m){ return '<option>' + escapeHtml(m) + '</option>'; }).join('');
    var c = r ? getCustomers().find(function(x){ return x.id === r.customerId; }) : null;
    pickers['rc-picker'].select(c || (r ? {id: r.customerId, name: r.customerName} : null));
    document.getElementById('rm-date').value = r ? r.date : todayISO();
    document.getElementById('rm-mode').value = r ? (r.mode || modes[0] || '') : (modes[0] || '');
    document.getElementById('rm-business').value = r && r.business ? r.business : '';
    document.getElementById('rm-cash').value = r && r.cash ? r.cash : '';
    document.getElementById('rm-note').value = r ? (r.note || '') : '';
    document.getElementById('rm-cancelled').checked = !!(r && r.cancelled);
    document.getElementById('rm-source').textContent = r ? 'From: ' + r.source + (r.ref ? ' ' + r.ref : '') : '';
    rcModal.classList.add('show');
  }
  document.getElementById('btnAddReceipt').addEventListener('click', function(){ openReceiptModal(null); });
  document.getElementById('rm-cancel').addEventListener('click', function(){ rcModal.classList.remove('show'); });
  rcModal.addEventListener('click', function(e){ if(e.target === rcModal) rcModal.classList.remove('show'); });
  document.getElementById('rcList').addEventListener('click', function(e){
    var id = e.target.dataset.rcEdit;
    if(!id) return;
    var r = getReceipts().find(function(x){ return x.id === id; });
    if(r) openReceiptModal(r);
  });
  document.getElementById('rm-save').addEventListener('click', function(){
    var c = pickers['rc-picker'].getSelected();
    if(!c){ showToast('Please select a customer first.'); return; }
    var business = Number(document.getElementById('rm-business').value) || 0;
    var cash = Number(document.getElementById('rm-cash').value) || 0;
    if(!business && !cash){ showToast('Enter the amount received.'); return; }
    var old = editingReceiptId ? getReceipts().find(function(x){ return x.id === editingReceiptId; }) : null;
    upsertReceipt({
      id: editingReceiptId || ('rc_' + uid().slice(2)),
      date: document.getElementById('rm-date').value || todayISO(),
      customerId: c.id, customerName: c.name,
      mode: document.getElementById('rm-mode').value,
      business: business, cash: cash,
      source: old ? old.source : 'Manual', ref: old ? (old.ref || '') : '',
      note: document.getElementById('rm-note').value.trim(),
      cancelled: document.getElementById('rm-cancelled').checked
    });
    rcModal.classList.remove('show');
    renderReceipts();
    showToast('Payment saved.');
  });
