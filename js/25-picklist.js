"use strict";

/* Pick lists for the godown: what to take off the shelves for one order
   (from the order screen) or for every open order of a day (from the Orders
   list), with the total quantity of each product and the per-order
   breakdown. Shown in a dialog that can be printed or copied for WhatsApp. */

  var PICK_DEFAULT_STATUSES = ['Pending', 'Confirmed', 'Packed'];
  var pickText = '';

  function pickQty(q){ return Number(q) || 0; }

  // orders → {products:[{name, qty, orders}], orders}
  function buildPickList(orders){
    var byName = {}, order = [];
    orders.forEach(function(o){
      (o.items || []).forEach(function(it){
        var k = normalizeName(it.name);
        if(!byName[k]){ byName[k] = {name: it.name, qty: 0, orders: []}; order.push(k); }
        byName[k].qty += pickQty(it.qty);
        if(byName[k].orders.indexOf(o.orderNo) === -1) byName[k].orders.push(o.orderNo);
      });
    });
    var products = order.map(function(k){ return byName[k]; }).sort(function(a, b){ return a.name.localeCompare(b.name); });
    return {products: products, orders: orders};
  }

  function renderPickList(title, orders){
    var pl = buildPickList(orders);
    var totalQty = pl.products.reduce(function(s, p){ return s + p.qty; }, 0);
    var body = document.getElementById('pickBody');
    if(orders.length === 0){
      body.innerHTML = '<div class="empty-state">No orders to pick for this selection.</div>';
      pickText = '';
      return;
    }
    body.innerHTML =
      '<div class="pick-head"><div class="pick-title">' + escapeHtml(title) + '</div>' +
        '<div class="pick-meta">' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + ' · ' + pl.products.length + ' product' + (pl.products.length === 1 ? '' : 's') + ' · ' + totalQty + ' pcs</div></div>' +
      '<p class="pick-section">Items to pick</p>' +
      '<table class="pick-table"><thead><tr><th></th><th>Product</th><th class="q">Qty</th></tr></thead><tbody>' +
        pl.products.map(function(p){
          return '<tr><td class="cb"><span class="pick-box"></span></td><td>' + escapeHtml(p.name) +
            (orders.length > 1 ? '<div class="pick-sub">' + escapeHtml(p.orders.join(', ')) + '</div>' : '') +
            '</td><td class="q">' + p.qty + '</td></tr>';
        }).join('') +
      '</tbody></table>' +
      (orders.length > 1 ? '<p class="pick-section">By order</p>' + orders.map(function(o){
        return '<div class="pick-order"><div class="pick-order-head"><strong>' + escapeHtml(o.orderNo || '') + '</strong> · ' + escapeHtml(o.customerName || '') +
          (o.transport ? ' · 🚛 ' + escapeHtml(o.transport) : '') + ' <span class="or-status s-' + String(o.status || 'pending').toLowerCase() + '">' + escapeHtml(o.status || '') + '</span></div>' +
          (o.items || []).map(function(it){ return '<div class="pick-line"><span class="pick-box"></span>' + escapeHtml(it.name) + ' <strong>× ' + pickQty(it.qty) + '</strong></div>'; }).join('') +
          '</div>';
      }).join('') : (orders[0].notes ? '<p class="pick-note">📝 ' + escapeHtml(orders[0].notes) + '</p>' : ''));

    // text version for WhatsApp / notes
    var lines = ["📋 *" + title + "*",
      orders.length === 1
        ? "Order " + orders[0].orderNo + " · " + orders[0].customerName + (orders[0].transport ? " · 🚛 " + orders[0].transport : "")
        : "Orders: " + orders.map(function(o){ return o.orderNo; }).join(", ") + " (" + orders.length + ")",
      "", "*Items to pick:*"];
    pl.products.forEach(function(p){ lines.push("☐ " + p.name + " — *" + p.qty + "*"); });
    lines.push("", "Total: " + totalQty + " pcs");
    if(orders.length > 1){
      lines.push("", "*By order:*");
      orders.forEach(function(o){
        lines.push(o.orderNo + " · " + o.customerName + (o.transport ? " · 🚛 " + o.transport : ""));
        (o.items || []).forEach(function(it){ lines.push("   ☐ " + it.name + " × " + pickQty(it.qty)); });
      });
    }else if(orders[0].notes){
      lines.push("", "📝 " + orders[0].notes);
    }
    pickText = lines.join("\n");
  }

  var pickModal = document.getElementById('pickModalOverlay');
  function openPickModal(withFilters){
    document.getElementById('pickFilters').style.display = withFilters ? '' : 'none';
    pickModal.classList.add('show');
  }
  function closePickModal(){ pickModal.classList.remove('show'); }

  /* ---- combined list for a day (Orders page) ---- */
  function refreshCombinedPick(){
    var date = document.getElementById('pick-date').value;
    var statuses = Array.prototype.filter.call(document.querySelectorAll('#pickStatuses input'), function(c){ return c.checked; }).map(function(c){ return c.value; });
    var orders = getOrders().filter(function(o){
      return (!date || o.date === date) && statuses.indexOf(o.status || 'Pending') > -1;
    }).sort(function(a, b){ return String(a.orderNo).localeCompare(String(b.orderNo)); });
    renderPickList('Pick List — ' + (date ? formatDateForMsg(date) : 'all dates'), orders);
  }
  document.getElementById('pickStatuses').innerHTML = OR_STATUSES.map(function(s){
    return '<label class="pick-chk"><input type="checkbox" value="' + s + '"' + (PICK_DEFAULT_STATUSES.indexOf(s) > -1 ? ' checked' : '') + '> ' + s + '</label>';
  }).join('');
  document.getElementById('pick-date').addEventListener('change', refreshCombinedPick);
  document.getElementById('pickStatuses').addEventListener('change', refreshCombinedPick);
  document.getElementById('btnPickList').addEventListener('click', function(){
    document.getElementById('pick-date').value = todayISO();
    openPickModal(true);
    refreshCombinedPick();
  });

  /* ---- one order (order screen) ---- */
  document.getElementById('btnOrderPickList').addEventListener('click', function(){
    var o = orderFromForm(); if(!o) return;
    openPickModal(false);
    renderPickList('Pick List — Order ' + o.orderNo, [o]);
  });

  /* ---- actions ---- */
  document.getElementById('pickClose').addEventListener('click', closePickModal);
  pickModal.addEventListener('click', function(e){ if(e.target === pickModal) closePickModal(); });
  document.getElementById('pickCopy').addEventListener('click', function(){
    if(!pickText){ showToast('Nothing to copy.'); return; }
    function done(){ showToast('Pick list copied — paste it in WhatsApp or notes.'); if(typeof dbLogEvent === 'function') dbLogEvent('picklist-copied', {}); }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pickText).then(done).catch(function(){ fallbackCopy(pickText); done(); });
    else { fallbackCopy(pickText); done(); }
  });
  document.getElementById('pickPrint').addEventListener('click', function(){
    if(!pickText){ showToast('Nothing to print.'); return; }
    document.body.classList.add('print-pick');
    if(typeof dbLogEvent === 'function') dbLogEvent('picklist-printed', {});
    window.print();
    setTimeout(function(){ document.body.classList.remove('print-pick'); }, 500);
  });
