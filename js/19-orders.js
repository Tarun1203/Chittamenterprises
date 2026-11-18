"use strict";

/* Orders: list with search / status filter, an editor for new and existing
   orders (customer, items from the Product Database, advance, status), and
   an Order Confirmation message. Orders are saved through saveOrders(), so
   they go to the Firebase database and the activity log like everything
   else. There is no delete — an order is cancelled by setting its status. */

pickers['or-picker'] = buildPicker('or-picker');

  var OR_STATUSES = ['Pending', 'Confirmed', 'Packed', 'Dispatched', 'Delivered', 'Cancelled'];
  var editingOrderId = null;

  document.getElementById('or-status').innerHTML = OR_STATUSES.map(function(s){ return '<option>' + s + '</option>'; }).join('');
  document.getElementById('orStatusFilter').innerHTML = '<option value="">All Statuses</option>' +
    OR_STATUSES.map(function(s){ return '<option>' + s + '</option>'; }).join('');

  function orStatusBadge(s){
    return '<span class="or-status s-' + String(s || 'pending').toLowerCase() + '">' + escapeHtml(s || 'Pending') + '</span>';
  }

  // Order No. = DD/MM-serial, e.g. 18/11-01; the serial restarts at 01 every
  // day (counted among orders of that same date, so other years never clash)
  function orderNoPrefix(iso){
    var p = (iso || todayISO()).split('-');
    return p[2] + '/' + p[1];
  }
  function nextOrderNo(iso){
    iso = iso || todayISO();
    var prefix = orderNoPrefix(iso) + '-';
    var max = 0;
    getOrders().forEach(function(o){
      if(o.date !== iso || String(o.orderNo || '').indexOf(prefix) !== 0) return;
      max = Math.max(max, Number(String(o.orderNo).slice(prefix.length)) || 0);
    });
    return prefix + String(max + 1).padStart(2, '0');
  }

  /* ---------------- list ---------------- */
  function renderOrders(){
    var orders = getOrders().slice().sort(function(a, b){
      return (b.date || '').localeCompare(a.date || '') || String(b.orderNo).localeCompare(String(a.orderNo));
    });

    var counts = {}, openValue = 0;
    orders.forEach(function(o){
      counts[o.status] = (counts[o.status] || 0) + 1;
      if(o.status !== 'Delivered' && o.status !== 'Cancelled') openValue += Number(o.total) || 0;
    });
    document.getElementById('orSummary').innerHTML = orders.length ?
      OR_STATUSES.filter(function(s){ return counts[s]; }).map(function(s){ return '<span class="or-chip">' + s + '<strong>' + counts[s] + '</strong></span>'; }).join('') +
      '<span class="or-chip">Open order value<strong>' + inr(Math.round(openValue)) + '</strong></span>' : '';

    var q = document.getElementById('orSearch').value.trim().toLowerCase();
    var st = document.getElementById('orStatusFilter').value;
    var list = orders.filter(function(o){
      if(st && o.status !== st) return false;
      if(!q) return true;
      return [o.orderNo, o.customerName, o.notes].concat((o.items || []).map(function(i){ return i.name; })).join(' ').toLowerCase().indexOf(q) > -1;
    });

    var wrap = document.getElementById('orTableWrap');
    if(list.length === 0){
      wrap.innerHTML = '<div class="empty-state">' + (orders.length ? 'No orders match.' : 'No orders yet. Click "+ New Order" to take the first one.') + '</div>';
      return;
    }
    wrap.innerHTML = '<div class="tx-table-wrap" style="overflow-x:auto;"><table class="cust-table"><thead><tr><th>Order No.</th><th>Date</th><th>Customer</th><th>Items</th><th style="text-align:right;">Total</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.map(function(o){
        var items = (o.items || []).map(function(i){ return i.name + (i.qty ? ' × ' + i.qty : ''); }).join(', ');
        return '<tr>' +
          '<td style="font-family:\'IBM Plex Mono\',monospace;">' + escapeHtml(o.orderNo || '') + '</td>' +
          '<td style="white-space:nowrap;">' + escapeHtml(formatDateForMsg(o.date)) + '</td>' +
          '<td>' + escapeHtml(o.customerName || '—') + '</td>' +
          '<td style="font-size:12.5px; color:var(--ink-soft);">' + escapeHtml(items) + '</td>' +
          '<td style="text-align:right; font-family:\'IBM Plex Mono\',monospace; white-space:nowrap;">' + inr(o.total) + '</td>' +
          '<td>' + orStatusBadge(o.status) + '</td>' +
          '<td><div class="row-actions"><button class="icon-btn" data-order-edit="' + o.id + '">Open</button></div></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  document.getElementById('orSearch').addEventListener('input', renderOrders);
  document.getElementById('orStatusFilter').addEventListener('change', renderOrders);
  document.getElementById('orTableWrap').addEventListener('click', function(e){
    var id = e.target.dataset.orderEdit;
    if(!id) return;
    var o = getOrders().find(function(x){ return x.id === id; });
    if(o) openOrderEditor(o);
  });

  /* ---------------- editor: item rows ---------------- */
  function orAddItemRow(it){
    it = it || {};
    var wrap = document.getElementById('or-items');
    var row = document.createElement('div');
    row.className = 'order-row';
    row.innerHTML =
      '<input type="text" class="or-name" placeholder="Product (type to search)" value="' + escapeHtml(it.name || '') + '">' +
      '<input type="number" class="or-qty" placeholder="Qty" min="0" value="' + (it.qty !== undefined && it.qty !== '' ? it.qty : '') + '">' +
      '<input type="number" class="or-rate" placeholder="Rate" value="' + (it.rate !== undefined && it.rate !== '' ? it.rate : '') + '">' +
      '<span class="or-amount">₹0</span>' +
      '<button type="button" class="row-del" title="Remove this line">✕</button>';
    var name = row.querySelector('.or-name'), rate = row.querySelector('.or-rate');
    attachSuggest(name, productSuggestions);
    name.addEventListener('change', function(){
      // picking a product from the database fills in its price
      var p = getProducts().find(function(x){ return normalizeName(x.name) === normalizeName(name.value); });
      if(p && !rate.value) rate.value = p.price;
      orUpdateTotals();
    });
    row.querySelectorAll('input').forEach(function(el){ el.addEventListener('input', orUpdateTotals); });
    row.querySelector('.row-del').addEventListener('click', function(){ wrap.removeChild(row); orUpdateTotals(); });
    wrap.appendChild(row);
    orUpdateTotals();
  }
  document.getElementById('or-add-item').addEventListener('click', function(){ orAddItemRow(); });

  function orItems(){
    var items = [];
    document.querySelectorAll('#or-items .order-row').forEach(function(row){
      var name = row.querySelector('.or-name').value.trim();
      var qty = Number(row.querySelector('.or-qty').value) || 0;
      var rate = Number(row.querySelector('.or-rate').value) || 0;
      var amount = Math.round(qty * rate * 100) / 100;
      row.querySelector('.or-amount').textContent = inr(amount);
      if(name) items.push({name: name, qty: qty, rate: rate, amount: amount});
    });
    return items;
  }
  function orUpdateTotals(){
    var total = orItems().reduce(function(s, i){ return s + i.amount; }, 0);
    var adv = Number(document.getElementById('or-advance').value) || 0;
    var refund = freightRefund(document.getElementById('or-freight-terms').value, document.getElementById('or-freight').value);
    document.getElementById('or-total').textContent = inr(total);
    document.getElementById('or-freight-note').innerHTML = refund ? ' · Transport refund: <strong>' + inr(refund) + '</strong>' : '';
    document.getElementById('or-balance').textContent = inr(Math.max(0, total + refund - adv));
    return total;
  }
  ['or-advance', 'or-freight'].forEach(function(id){ document.getElementById(id).addEventListener('input', orUpdateTotals); });
  document.getElementById('or-freight-terms').addEventListener('change', orUpdateTotals);

  /* ---------------- editor: open / save ---------------- */
  function openOrderEditor(o){
    editingOrderId = o ? o.id : null;
    document.getElementById('or-editor-eyebrow').textContent = o ? 'Order ' + (o.orderNo || '') : 'New Order';
    document.getElementById('or-editor-title').textContent = o ? (o.customerName || 'Order') : 'New Order';
    var c = o ? getCustomers().find(function(x){ return x.id === o.customerId; }) : null;
    pickers['or-picker'].select(c || (o ? {id: o.customerId, name: o.customerName, mobile: o.mobile} : null));
    document.getElementById('or-no').value = o ? (o.orderNo || '') : nextOrderNo(todayISO());
    document.getElementById('or-date').value = o ? (o.date || '') : todayISO();
    document.getElementById('or-delivery').value = o ? (o.deliveryDate || '') : '';
    document.getElementById('or-transport').value = o ? (o.transport || '') : '';
    document.getElementById('or-transport-phone').value = o ? (o.transportPhone || '') : '';
    document.getElementById('or-freight-terms').value = o ? (o.freightTerms || '') : '';
    document.getElementById('or-freight').value = o && o.freight ? o.freight : '';
    document.getElementById('or-status').value = o ? (o.status || 'Pending') : 'Pending';
    document.getElementById('or-advance').value = o && o.advance ? o.advance : '';
    document.getElementById('or-notes').value = o ? (o.notes || '') : '';
    document.getElementById('or-items').innerHTML = '';
    ((o && o.items && o.items.length) ? o.items : [{}, {}]).forEach(orAddItemRow);
    document.getElementById('or-preview').textContent = '';
    document.getElementById('or-list-wrap').style.display = 'none';
    document.getElementById('or-editor').style.display = '';
    window.scrollTo(0, 0);
  }
  function closeOrderEditor(){
    editingOrderId = null;
    document.getElementById('or-editor').style.display = 'none';
    document.getElementById('or-list-wrap').style.display = '';
    renderOrders();
  }
  // new order: changing the date re-numbers it for that day, unless the
  // number was typed in by hand
  document.getElementById('or-date').addEventListener('change', function(){
    if(editingOrderId) return;
    var noEl = document.getElementById('or-no');
    if(!noEl.value || /^\d{2}\/\d{2}-\d+$/.test(noEl.value)) noEl.value = nextOrderNo(this.value || todayISO());
  });

  // picking a transport on file fills in its contact number
  document.getElementById('or-transport').addEventListener('change', function(){
    var t = typeof findTransport === 'function' ? findTransport(this.value) : null;
    if(t && t.phone) document.getElementById('or-transport-phone').value = t.phone;
  });

  document.getElementById('btnNewOrder').addEventListener('click', function(){ openOrderEditor(null); });
  document.getElementById('btnCloseOrder').addEventListener('click', closeOrderEditor);

  function orderFromForm(){
    var c = pickers['or-picker'].getSelected();
    if(!c){ showToast('Please select a customer first.'); return null; }
    var items = orItems();
    if(items.length === 0){ showToast('Add at least one item with a product name.'); return null; }
    var date = document.getElementById('or-date').value || todayISO();
    var orderNo = document.getElementById('or-no').value.trim() || nextOrderNo(date);
    // the same DD/MM-serial comes round again next year, so only that year counts as a clash
    var clash = getOrders().find(function(o){
      return o.orderNo === orderNo && o.id !== editingOrderId && String(o.date || '').slice(0, 4) === date.slice(0, 4);
    });
    if(clash){ showToast('Order No. ' + orderNo + ' is already used — change it.'); return null; }
    return {
      orderNo: orderNo,
      date: date,
      deliveryDate: document.getElementById('or-delivery').value,
      transport: document.getElementById('or-transport').value.trim(),
      transportPhone: document.getElementById('or-transport-phone').value.trim(),
      freightTerms: document.getElementById('or-freight-terms').value,
      freight: Number(document.getElementById('or-freight').value) || 0,
      customerId: c.id, customerName: c.name, mobile: c.mobile || '',
      status: document.getElementById('or-status').value,
      advance: Number(document.getElementById('or-advance').value) || 0,
      items: items,
      total: Math.round(orUpdateTotals() * 100) / 100,
      notes: document.getElementById('or-notes').value.trim()
    };
  }

  document.getElementById('btnSaveOrder').addEventListener('click', function(){
    var data = orderFromForm();
    if(!data) return;
    var list = getOrders();
    if(editingOrderId){
      list = list.map(function(o){ return o.id === editingOrderId ? Object.assign({}, o, data) : o; });
    }else{
      editingOrderId = 'o_' + uid().slice(2);
      list.push(Object.assign({id: editingOrderId}, data));
    }
    saveOrders(list);
    if(typeof rememberTransport === 'function') rememberTransport(data.transport, data.transportPhone);
    document.getElementById('or-editor-eyebrow').textContent = 'Order ' + data.orderNo;
    document.getElementById('or-editor-title').textContent = data.customerName;
    var flag = document.getElementById('orSaved');
    flag.classList.add('show');
    setTimeout(function(){ flag.classList.remove('show'); }, 1800);
    showToast('Order ' + data.orderNo + ' saved.');
  });

  /* ---------------- order confirmation message ---------------- */
  function generateOrderConfirmation(){
    var o = orderFromForm(); if(!o) return null;
    var s = getSettings();
    var lines = o.items.map(function(i){
      return "• " + i.name + (i.qty ? " × " + i.qty : "") + (i.rate ? " @ " + inr(i.rate) : "") + (i.amount ? " = " + inr(i.amount) : "");
    }).join("\n");
    var refund = freightRefund(o.freightTerms, o.freight);
    var balance = Math.max(0, o.total + refund - o.advance);
    var freight = freightLine(o.freightTerms, o.freight);
    var signOff = s.businessName + (s.address ? ", " + s.address : "") + ",";
    return "🧾 *Order Confirmation*\n\n" +
      "Namaste Anna/Sir 🙏\n" +
      "Thank you for your order. Here are the details:\n\n" +
      "🧾 Order No.: " + o.orderNo + "\n" +
      "📅 Order Date: " + formatDateForMsg(o.date) + "\n" +
      (o.deliveryDate ? "🚚 Expected Delivery: " + formatDateForMsg(o.deliveryDate) + "\n" : "") +
      (o.transport ? "🚛 Transport: " + transportLine(o.transport, o.transportPhone) + "\n" : "") +
      (freight ? freight + "\n" : "") +
      "📌 Status: " + o.status + "\n\n" +
      "*Items:*\n" + lines + "\n\n" +
      "💰 *Order Total: " + inr(o.total) + "*\n" +
      (refund ? "🚚 Transport Charges to Refund: " + inr(refund) + "\n" : "") +
      (o.advance ? "✅ Advance Received: " + inr(o.advance) + "\n" : "") +
      (o.advance || refund ? "🔖 *Balance Payable: " + inr(balance) + "*" + (refund ? " (incl. transport charges)" : "") + "\n" : "") +
      (o.notes ? "\n📝 " + o.notes + "\n" : "") +
      "\nPlease check the items and quantities, and let us know if anything needs to change.\n\n" +
      "Thank you for your business. 🙏\n" +
      signOff;
  }

generators['order-confirmation'] = {fn: generateOrderConfirmation, previewId: 'or-preview'};
