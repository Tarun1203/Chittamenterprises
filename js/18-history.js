"use strict";

/* History page: the latest messages generated and the latest changes to
   customers / products / settings, read from the Firebase database. The
   records are append-only — the app has no way to edit or delete them. */

  var histCache = {activity: null, messages: null};

  var HIST_TYPE_LABELS = {
    'payment-updated': 'Payment Updated',
    'balance-confirmation': 'Balance Confirmation',
    'payment-reminder': 'Payment Reminder',
    'dispatch-confirmation': 'Dispatch',
    'stock-update': 'Stock Update',
    'service-material': 'Service Material',
    'stock-return': 'Stock Return',
    'order-confirmation': 'Order Confirmation',
    'service-job': 'Service Job'
  };

  var HIST_EVENT_LABELS = {
    'message-generated': 'Message generated',
    'message-copied': 'Message copied',
    'whatsapp-opened': 'Sent to WhatsApp',
    'import-customers': 'Customers imported',
    'import-products': 'Products imported',
    'backup-export': 'Backup downloaded',
    'backup-restore': 'Backup restored',
    'sheet-push': 'Pushed to Sheet',
    'sheet-pull': 'Pulled from Sheet',
    'sheet-url-changed': 'Sheet URL changed',
    'catalog-photo': 'Catalog photo added',
    'catalog-copy': 'Catalog copied',
    'catalog-share': 'Catalog shared',
    'app-installed': 'App installed',
    'balances-imported': 'Tally balances imported',
    'balances-synced': 'Tally balances synced',
    'picklist-copied': 'Pick list copied',
    'picklist-printed': 'Pick list printed',
    'receipts-report-copied': 'Payments report copied',
    'receipts-report-downloaded': 'Payments report downloaded',
    'sign-in': 'Signed in',
    'sign-out': 'Signed out'
  };

  // one-line summary of an event's details
  function histEventInfo(action, d){
    var type = d.type ? (HIST_TYPE_LABELS[d.type] || d.type) : '';
    switch(action){
      case 'message-generated':
      case 'message-copied':
      case 'whatsapp-opened': return [type, d.mobile].filter(Boolean).join(' · ');
      case 'import-customers': return d.added + ' added, ' + d.updated + ' updated, ' + d.skippedBank + ' bank ledgers skipped';
      case 'import-products': return d.added + ' added, ' + d.updated + ' prices updated';
      case 'backup-export':
      case 'sheet-push':
      case 'sheet-pull': return d.customers + ' customers, ' + d.products + ' products';
      case 'backup-restore': return (d.file ? d.file + ' — ' : '') + d.customers + ' customers, ' + d.products + ' products';
      case 'sheet-url-changed': return d.url || '(cleared)';
      case 'balances-synced': return (d.company ? 'From Tally company ' + d.company + ' — ' : '') + (d.names || 0) + ' names';
      case 'balances-imported': return (d.file ? d.file + ' — ' : '') + d.matched + ' customers matched' + (d.unmatched ? ', ' + d.unmatched + ' other names' : '');
      case 'catalog-copy':
      case 'catalog-share': return (d.products || []).join(', ');
      default: return '';
    }
  }

  function histWhen(ts){
    var d = ts && ts.toDate ? ts.toDate() : null;
    if(!d) return 'just now';
    return d.toLocaleString('en-IN', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
  }

  // "price: ₹100 → ₹120, mobile: — → 98…"
  function histDiff(before, after){
    if(!before) return '';
    var keys = Object.keys(Object.assign({}, before, after)).filter(function(k){ return k !== 'id'; });
    return keys.filter(function(k){ return JSON.stringify(before[k]) !== JSON.stringify(after[k]); }).map(function(k){
      if(Array.isArray(before[k]) && Array.isArray(after[k])) return histListDiff(k, before[k], after[k]);
      return histLabel(k) + ': ' + histShow(before[k]) + ' → ' + histShow(after[k]);
    }).join(', ');
  }
  var HIST_FIELD_LABELS = {
    replSerial: 'new S/N', replProduct: 'replacement', serial: 'S/N', qty: 'qty', totalCharges: 'total charges',
    sentDate: 'sent back', receivedDate: 'received', deliveryDate: 'delivery', outTransport: 'return transport',
    inTransport: 'received via', customerName: 'customer', transportPhone: 'transport phone', contactPerson: 'contact person',
    freightTerms: 'transport charges', freight: 'transport charges ₹', orderNo: 'order no.', jobNo: 'job no.',
    businessName: 'business name', upiList: 'UPI IDs', bankList: 'bank accounts', paymentModes: 'payment modes'
  };
  function histLabel(k){ return HIST_FIELD_LABELS[k] || k; }
  function histShow(v){
    if(v === undefined || v === '' || v === null) return '—';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  // item lists (order items, service products): what changed per line,
  // e.g. "Inverter 900VA: action Pending → Repaired, charges 0 → 350"
  function histListDiff(key, before, after){
    var out = [];
    for(var i = 0; i < Math.max(before.length, after.length); i++){
      var b = before[i], a = after[i];
      var label = (a && (a.name || a.product)) || (b && (b.name || b.product)) || (key + ' ' + (i + 1));
      if(!b){ out.push('added ' + label); continue; }
      if(!a){ out.push('removed ' + label); continue; }
      if(typeof a !== 'object' || typeof b !== 'object'){
        if(JSON.stringify(a) !== JSON.stringify(b)) out.push(histShow(b) + ' → ' + histShow(a));
        continue;
      }
      var ch = Object.keys(Object.assign({}, b, a)).filter(function(f){ return JSON.stringify(b[f]) !== JSON.stringify(a[f]); })
        .map(function(f){ return histLabel(f) + ' ' + histShow(b[f]) + ' → ' + histShow(a[f]); });
      if(ch.length) out.push(label + ': ' + ch.join(', '));
    }
    return out.join('; ');
  }

  function renderHistory(){
    var kind = document.getElementById('histKind').value;
    var wrap = document.getElementById('histWrap');
    var list = histCache[kind];
    if(!list){ return; }
    var q = document.getElementById('histSearch').value.trim().toLowerCase();
    var rows = list.filter(function(r){
      if(!q) return true;
      return JSON.stringify(r).toLowerCase().indexOf(q) > -1;
    });
    if(rows.length === 0){
      wrap.innerHTML = '<div class="empty-state">' + (list.length ? 'Nothing matches your search.' : 'Nothing saved yet.') + '</div>';
      return;
    }
    wrap.innerHTML = rows.map(function(r){
      if(kind === 'messages'){
        var idx = list.indexOf(r);
        return '<div class="hist-item"><div class="hist-top"><div><span class="hist-tag">' + escapeHtml(HIST_TYPE_LABELS[r.type] || r.type) + '</span>' +
          escapeHtml(r.customerName || '—') + '</div><div class="who">' + histWhen(r.at) + ' · ' + escapeHtml(r.by || '') + '</div></div>' +
          '<div class="hist-actions">' +
            '<button class="icon-btn" data-hist-copy="' + idx + '">📋 Copy</button>' +
            (r.mobile ? '<button class="icon-btn" data-hist-wa="' + idx + '">📲 WhatsApp</button>' : '') +
          '</div>' +
          '<details><summary>Show message</summary><pre>' + escapeHtml(r.text || '') + '</pre></details></div>';
      }
      if(r.collection === 'app'){
        var label = HIST_EVENT_LABELS[r.action] || r.action;
        var d = r.details || {};
        var info = histEventInfo(r.action, d);
        return '<div class="hist-item"><div class="hist-top"><div><span class="hist-tag hist-tag-event">' + escapeHtml(label) + '</span>' +
          escapeHtml(r.name || '') + '</div><div class="who">' + histWhen(r.at) + ' · ' + escapeHtml(r.by || '') + '</div></div>' +
          (info ? '<div class="hist-diff">' + escapeHtml(info) + '</div>' : '') + '</div>';
      }
      var what = {customers: 'Customer', products: 'Product', settings: 'Settings', orders: 'Order', services: 'Service job', transports: 'Transport', receipts: 'Payment'}[r.collection] || r.collection;
      var diff = histDiff(r.before, r.after || {});
      return '<div class="hist-item"><div class="hist-top"><div><span class="hist-tag">' + escapeHtml(what) + ' ' + (r.action === 'create' ? 'added' : 'edited') + '</span>' +
        escapeHtml(r.name || '') + '</div><div class="who">' + histWhen(r.at) + ' · ' + escapeHtml(r.by || '') + '</div></div>' +
        (diff ? '<div class="hist-diff">' + escapeHtml(diff) + '</div>' : '') + '</div>';
    }).join('');
  }

  function loadHistory(){
    var wrap = document.getElementById('histWrap');
    if(!dbReady()){
      wrap.innerHTML = '<div class="empty-state">History is kept in the Firebase database. ' +
        (dbEnabled() ? 'Sign in to see it.' : 'Add your Firebase config (see FIREBASE_SETUP.md) to turn it on.') + '</div>';
      return;
    }
    var kind = document.getElementById('histKind').value;
    if(!histCache[kind]) wrap.innerHTML = '<div class="empty-state">Loading…</div>';
    db.collection(kind).orderBy('at', 'desc').limit(300).get()
      .then(function(snap){
        // entries from before encryption was turned on are already readable
        return Promise.all(snap.docs.map(function(d){ return window.ChittamCrypto.openDoc(d.data()); }));
      })
      .then(function(list){
        histCache[kind] = list;
        renderHistory();
      })
      .catch(function(err){
        wrap.innerHTML = '<div class="empty-state">Could not load history: ' + escapeHtml(err.message) + '</div>';
      });
  }

  document.getElementById('histKind').addEventListener('change', loadHistory);
  document.getElementById('btnHistRefresh').addEventListener('click', loadHistory);

  // copy a saved message again, or copy it and open that customer's WhatsApp chat
  document.getElementById('histWrap').addEventListener('click', function(e){
    var btn = e.target.closest('[data-hist-copy], [data-hist-wa]');
    if(!btn || !histCache.messages) return;
    var r = histCache.messages[Number(btn.dataset.histCopy !== undefined ? btn.dataset.histCopy : btn.dataset.histWa)];
    if(!r) return;
    var openChat = btn.dataset.histWa !== undefined;
    function done(){
      if(typeof dbLogEvent === 'function') dbLogEvent(openChat ? 'whatsapp-opened' : 'message-copied', {type: r.type, customerName: r.customerName || '', mobile: r.mobile || '', fromHistory: true});
      if(openChat){
        window.open('https://wa.me/' + waNumber(r.mobile), '_blank');
        showToast('Message copied — paste it into the chat that just opened.');
      }else{
        showToast('Message copied.');
      }
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(r.text || '').then(done).catch(function(){ fallbackCopy(r.text || ''); done(); });
    }else{
      fallbackCopy(r.text || ''); done();
    }
  });
  document.getElementById('histSearch').addEventListener('input', renderHistory);

  document.getElementById('btnDbUpload').addEventListener('click', function(){
    if(!dbReady()){ showToast(dbEnabled() ? 'Sign in first.' : 'Add your Firebase config first (see FIREBASE_SETUP.md).'); return; }
    dbMergeLocal(true)
      .then(function(n){ showToast(n ? 'Uploaded ' + n + ' new record' + (n === 1 ? '' : 's') + ' to the database.' : 'Everything on this device is already in the database.'); })
      .catch(function(err){ showToast('Upload failed: ' + err.message); });
  });
