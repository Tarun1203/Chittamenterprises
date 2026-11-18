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
    'order-confirmation': 'Order Confirmation'
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
      function show(v){ if(v === undefined || v === '' || v === null) return '—'; return typeof v === 'object' ? JSON.stringify(v) : String(v); }
      return k + ': ' + show(before[k]) + ' → ' + show(after[k]);
    }).join(', ');
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
        return '<div class="hist-item"><div class="hist-top"><div><span class="hist-tag">' + escapeHtml(HIST_TYPE_LABELS[r.type] || r.type) + '</span>' +
          escapeHtml(r.customerName || '—') + '</div><div class="who">' + histWhen(r.at) + ' · ' + escapeHtml(r.by || '') + '</div></div>' +
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
      var what = {customers: 'Customer', products: 'Product', settings: 'Settings', orders: 'Order'}[r.collection] || r.collection;
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
        histCache[kind] = snap.docs.map(function(d){ return d.data(); });
        renderHistory();
      })
      .catch(function(err){
        wrap.innerHTML = '<div class="empty-state">Could not load history: ' + escapeHtml(err.message) + '</div>';
      });
  }

  document.getElementById('histKind').addEventListener('change', loadHistory);
  document.getElementById('btnHistRefresh').addEventListener('click', loadHistory);
  document.getElementById('histSearch').addEventListener('input', renderHistory);

  document.getElementById('btnDbUpload').addEventListener('click', function(){
    if(!dbReady()){ showToast(dbEnabled() ? 'Sign in first.' : 'Add your Firebase config first (see FIREBASE_SETUP.md).'); return; }
    dbMergeLocal(true)
      .then(function(n){ showToast(n ? 'Uploaded ' + n + ' new record' + (n === 1 ? '' : 's') + ' to the database.' : 'Everything on this device is already in the database.'); })
      .catch(function(err){ showToast('Upload failed: ' + err.message); });
  });
