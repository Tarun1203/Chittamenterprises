"use strict";

/* Firebase (Firestore) database: every add/edit of customers, products and
   settings is saved to the cloud, every device listens for changes, and
   every generated message plus every change is appended to a history log.
   Nothing is ever deleted — the security rules (firestore.rules) refuse
   deletes, and this file never issues one.

   The rest of the app keeps reading from localStorage via getCustomers()
   etc.; this file keeps that copy in step with Firestore. If
   FIREBASE_CONFIG (js/firebase-config.js) is null the app runs on this
   device only, exactly as before. */

  var db = null;
  var dbUser = null;
  var dbUnsubs = [];
  var DB_META = ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'];

  function dbEnabled(){ return !!(window.FIREBASE_CONFIG && window.firebase); }
  function dbReady(){ return !!(db && dbUser); }

  function dbStrip(obj){
    var o = Object.assign({}, obj);
    DB_META.forEach(function(k){ delete o[k]; });
    return o;
  }
  // stable JSON so key order never counts as a change; also drops undefined
  // values, which Firestore rejects
  function dbStable(v){
    if(Array.isArray(v)) return v.map(dbStable);
    if(v && typeof v === 'object'){
      var o = {};
      Object.keys(v).sort().forEach(function(k){ if(v[k] !== undefined) o[k] = dbStable(v[k]); });
      return o;
    }
    return v;
  }
  function dbSame(a, b){ return JSON.stringify(dbStable(dbStrip(a))) === JSON.stringify(dbStable(dbStrip(b))); }
  function dbNow(){ return firebase.firestore.FieldValue.serverTimestamp(); }
  // encryption (js/00-crypto.js): records are sealed before saving and opened after reading
  var CC = window.ChittamCrypto;
  function dbSeal(coll, data){ return CC.sealDoc(coll, data); }
  // every record of a live update, opened; an older, slower update never replaces a newer one
  function dbOpenSnap(snap, seqBox){
    var mine = ++seqBox.n;
    return Promise.all(snap.docs.map(function(d){
      return CC.openDoc(d.data()).then(function(x){ return Object.assign({id: d.id}, dbStrip(x)); });
    })).then(function(list){ if(mine !== seqBox.n) throw 'stale'; return list; });
  }

  /* ---------------- writes ---------------- */

  // writes: [{coll, id, data, action:'create'|'update', before}]
  function dbCommit(writes){
    if(!dbReady() || writes.length === 0) return Promise.resolve();
    var chunks = [];
    for(var i = 0; i < writes.length; i += 200) chunks.push(writes.slice(i, i + 200));
    return Promise.all(chunks.map(async function(chunk){
      var batch = db.batch();
      for(var j = 0; j < chunk.length; j++){
        var w = chunk[j];
        var data = dbStable(w.data);
        var doc = Object.assign({}, data, {updatedAt: dbNow(), updatedBy: dbUser.email});
        if(w.action === 'create'){ doc.createdAt = dbNow(); doc.createdBy = dbUser.email; }
        batch.set(db.collection(w.coll).doc(w.id), await dbSeal(w.coll, doc), {merge: w.coll !== 'settings'});
        batch.set(db.collection('activity').doc(), await dbSeal('activity', {
          collection: w.coll, docId: w.id, action: w.action,
          name: data.name || data.businessName || (w.coll === 'receipts' ? (data.customerName || '') + ' ' + inr((Number(data.business) || 0) + (Number(data.cash) || 0)) : '') || ((data.orderNo || data.jobNo) ? (data.orderNo || data.jobNo) + (data.customerName ? ' — ' + data.customerName : '') : ''),
          before: w.before ? dbStable(w.before) : null, after: data,
          at: dbNow(), by: dbUser.email
        }));
      }
      return batch.commit();
    })).catch(function(err){
      showToast('Could not save to the database: ' + err.message);
    });
  }

  // called by saveCustomers / saveProducts with the old and new lists;
  // items missing from the new list are ignored (nothing is ever deleted)
  function dbSaveList(coll, prev, next){
    if(!dbReady()) return;
    var prevById = {};
    prev.forEach(function(p){ if(p && p.id) prevById[p.id] = p; });
    var writes = [];
    next.forEach(function(item){
      if(!item || !item.id) return;
      var old = prevById[item.id];
      if(old && dbSame(old, item)) return;
      writes.push({coll: coll, id: item.id, data: dbStrip(item), action: old ? 'update' : 'create', before: old ? dbStrip(old) : null});
    });
    dbCommit(writes);
  }

  function dbSaveSettings(prev, next){
    if(!dbReady() || dbSame(prev, next)) return;
    dbCommit([{coll: 'settings', id: 'main', data: next, action: 'update', before: prev}]);
  }

  var dbLastMessage = {};
  function dbLogMessage(type, customer, text, inputs){
    if(!dbReady() || dbLastMessage[type] === text) return; // pressing Generate twice saves once
    dbLastMessage[type] = text;
    var batch = db.batch();
    var msgRef = db.collection('messages').doc();
    var pending = [];
    var who = {
      customerId: customer ? customer.id : '',
      customerName: customer ? customer.name : '',
      mobile: customer ? (customer.mobile || '') : ''
    };
    // inputs = every field filled in on the form, so the entry itself is kept, not just the text
    pending.push(dbSeal('messages', Object.assign({type: type, text: text, inputs: dbStable(inputs || {}), at: dbNow(), by: dbUser.email}, who))
      .then(function(d){ batch.set(msgRef, d); }));
    // also in the activity log, so it shows everything in one place
    pending.push(dbSeal('activity', {
      collection: 'app', action: 'message-generated', name: who.customerName,
      details: Object.assign({type: type, messageId: msgRef.id}, who), at: dbNow(), by: dbUser.email
    }).then(function(d){ batch.set(db.collection('activity').doc(), d); }));
    Promise.all(pending).then(function(){ return batch.commit(); })
      .catch(function(err){ showToast('Message not saved to history: ' + err.message); });
  }

  // one entry in the activity log for anything the user does that isn't a
  // record change: copying / sending a message, imports, backups, sign-in…
  var dbPendingEvents = [];
  function dbLogEvent(action, details){
    details = dbStable(details || {});
    if(!dbReady()){
      if(dbEnabled()) dbPendingEvents.push([action, details, new Date().toISOString()]); // e.g. before sign-in finishes
      return;
    }
    dbSeal('activity', {
      collection: 'app', action: action,
      name: details.name || details.customerName || '',
      details: details, at: dbNow(), by: dbUser.email
    }).then(function(d){ return db.collection('activity').add(d); })
      .catch(function(err){ showToast('Not saved to the log: ' + err.message); });
  }
  function dbFlushEvents(){
    var q = dbPendingEvents; dbPendingEvents = [];
    q.forEach(function(e){ dbLogEvent(e[0], Object.assign({happenedAt: e[2]}, e[1])); });
  }
  window.dbLogEvent = dbLogEvent;

  /* ---------------- reads (live, every device) ---------------- */

  function dbRefreshUi(kind){
    if(kind === 'customers'){
      if(typeof renderCustomerTable === 'function') renderCustomerTable();
      if(typeof refreshAllPickers === 'function') refreshAllPickers();
      if(typeof renderDashboard === 'function') renderDashboard();
    }else if(kind === 'products'){
      if(typeof renderProductTable === 'function') renderProductTable();
      if(typeof refreshSuDbPicker === 'function') refreshSuDbPicker();
      if(window.ChittamCatalog && document.getElementById('ce-grid')) window.ChittamCatalog.render();
    }else if(kind === 'orders'){
      if(typeof renderOrders === 'function') renderOrders();
    }else if(kind === 'receipts'){
      if(typeof renderReceipts === 'function') renderReceipts();
    }else if(kind === 'transports'){
      if(typeof renderTransports === 'function') renderTransports();
    }else if(kind === 'services'){
      if(typeof renderServiceJobs === 'function') renderServiceJobs();
    }else if(kind === 'settings'){
      if(typeof loadSettingsIntoForm === 'function') loadSettingsIntoForm();
      if(typeof populatePaymentModeSelect === 'function') populatePaymentModeSelect();
      if(typeof refreshBusinessLabels === 'function') refreshBusinessLabels();
    }
  }

  function dbSetStatus(text){
    var el = document.getElementById('dbStatus');
    if(el) el.innerHTML = text;
    var st = document.getElementById('dbSettingsStatus');
    if(st) st.innerHTML = text;
  }
  function dbStatusOnline(fromCache){
    dbSetStatus((fromCache ? '⚠ Offline — saved on this device, will sync when back online' : '☁ Synced to database') +
      '<br>' + escapeHtml(dbUser.email) + ' · <a href="#" data-db-signout>Sign out</a>');
  }

  function dbListen(){
    dbUnsubs.forEach(function(u){ u(); });
    function live(coll, opts, done){
      var seq = {n: 0};
      var handler = function(snap){
        dbOpenSnap(snap, seq).then(function(list){ done(list, snap); }).catch(function(err){ if(err !== 'stale') dbReadError(err); });
      };
      return opts ? db.collection(coll).onSnapshot(opts, handler, dbReadError) : db.collection(coll).onSnapshot(handler, dbReadError);
    }
    var settingsSeq = 0;
    dbUnsubs = [
      live('customers', {includeMetadataChanges: true}, function(list, snap){
        localStorage.setItem(LS_CUST, JSON.stringify(list));
        dbRefreshUi('customers');
        dbStatusOnline(snap.metadata.fromCache);
      }),
      live('products', null, function(list){
        localStorage.setItem(LS_PRODUCTS, JSON.stringify(list));
        dbRefreshUi('products');
      }),
      live('balances', null, function(list){
        var all = {};
        list.forEach(function(d){ var id = d.id; all[id] = Object.assign({}, d); delete all[id].id; delete all[id].at; delete all[id].by; });
        localStorage.setItem('cem_balances', JSON.stringify(all));
        if(typeof renderBalanceStatus === 'function') renderBalanceStatus();
      }),
      live('receipts', null, function(list){
        localStorage.setItem(LS_RECEIPTS, JSON.stringify(list));
        dbRefreshUi('receipts');
      }),
      live('transports', null, function(list){
        localStorage.setItem(LS_TRANSPORTS, JSON.stringify(list));
        dbRefreshUi('transports');
      }),
      live('services', null, function(list){
        localStorage.setItem(LS_SERVICES, JSON.stringify(list));
        dbRefreshUi('services');
      }),
      live('orders', null, function(list){
        localStorage.setItem(LS_ORDERS, JSON.stringify(list));
        dbRefreshUi('orders');
      }),
      db.collection('settings').doc('main').onSnapshot(function(doc){
        if(!doc.exists) return;
        var mine = ++settingsSeq;
        CC.openDoc(doc.data()).then(function(x){
          if(mine !== settingsSeq) return;
          localStorage.setItem(LS_SETTINGS, JSON.stringify(dbStrip(x)));
          dbRefreshUi('settings');
        }).catch(dbReadError);
      }, dbReadError)
    ];
  }
  function dbReadError(err){
    dbSetStatus('⚠ Database error: ' + escapeHtml(err.message || String(err)));
  }

  // First sign-in on a device: upload what this device already has that the
  // database doesn't (matched by id or name), so no one's data is lost.
  function dbMergeLocal(force){
    var flag = 'cem_db_merged_' + dbUser.uid;
    if(!force && localStorage.getItem(flag)) return Promise.resolve(0);
    return Promise.all([
      db.collection('customers').get(),
      db.collection('products').get(),
      db.collection('transports').get(),
      db.collection('settings').doc('main').get()
    ]).then(function(res){
      // opened first, so names can be compared when the data is encrypted
      return Promise.all(res.slice(0, 3).map(function(snap){
        return Promise.all(snap.docs.map(function(d){ return CC.openDoc(d.data()).then(function(x){ return {id: d.id, data: function(){ return x; }}; }); }))
          .then(function(docs){ return {docs: docs}; });
      })).then(function(opened){ return opened.concat([res[3]]); });
    }).then(function(res){
      var writes = [];
      var settingsDoc = res.pop();
      [['customers', res[0], getCustomers()], ['products', res[1], getProducts()], ['transports', res[2], getTransports()]].forEach(function(t){
        var ids = {}, names = {};
        t[1].docs.forEach(function(d){ ids[d.id] = true; names[normalizeName(d.data().name)] = true; });
        t[2].forEach(function(item){
          if(!item || !item.id || !item.name || ids[item.id] || names[normalizeName(item.name)]) return;
          names[normalizeName(item.name)] = true;
          writes.push({coll: t[0], id: item.id, data: dbStrip(item), action: 'create', before: null});
        });
      });
      if(!settingsDoc.exists && localStorage.getItem(LS_SETTINGS)){
        writes.push({coll: 'settings', id: 'main', data: getSettings(), action: 'create', before: null});
      }
      return dbCommit(writes).then(function(){
        localStorage.setItem(flag, '1');
        return writes.length;
      });
    });
  }

  /* ---------------- sign-in ---------------- */

  function dbShowAuth(show){
    document.getElementById('authOverlay').classList.toggle('show', show);
    if(show) setTimeout(function(){ document.getElementById('auth-email').focus(); }, 50);
  }

  function dbInit(){
    if(!dbEnabled()){
      dbSetStatus('Stored only on this device.<br>Add your Firebase config to share across devices.');
      return;
    }
    try{
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      // keeps working offline; queued saves upload when the connection returns
      db.enablePersistence({synchronizeTabs: true}).catch(function(){});
    }catch(err){
      dbSetStatus('⚠ Firebase config problem: ' + escapeHtml(err.message));
      return;
    }
    dbSetStatus('Connecting to database…');
    firebase.auth().onAuthStateChanged(function(user){
      dbUser = user;
      if(!user){
        dbUnsubs.forEach(function(u){ u(); });
        dbUnsubs = [];
        if(dbCryptoUnsub){ dbCryptoUnsub(); dbCryptoUnsub = null; }
        dbStarted = false;
        dbShowUnlock(false);
        dbSetStatus('Not signed in.');
        dbShowAuth(true);
        return;
      }
      dbShowAuth(false);
      // whether the data is encrypted is read first; while this device doesn't have
      // the passphrase, nothing is read or saved
      if(dbCryptoUnsub) dbCryptoUnsub();
      dbCryptoUnsub = db.collection('settings').doc('crypto').onSnapshot(function(doc){
        CC.setConfig(doc.exists ? doc.data() : null).then(dbCryptoCheck);
      }, dbReadError);
    });
  }
  var dbStarted = false, dbCryptoUnsub = null;
  function dbCryptoCheck(){
    if(!dbUser) return;
    if(CC.isLocked()){ dbShowUnlock(true); return; }
    dbShowUnlock(false);
    if(dbStarted) return;
    dbStarted = true;
    if(dbSigningIn){ dbSigningIn = false; dbLogEvent('sign-in', {name: dbUser.email}); }
    dbFlushEvents();
    dbMergeLocal(false)
      .then(function(n){ if(n) showToast('Uploaded ' + n + ' record' + (n === 1 ? '' : 's') + ' from this device to the database.'); })
      .catch(function(err){ showToast('Could not merge this device\'s data: ' + err.message); })
      .then(dbListen);
  }

  /* ---------------- the passphrase (when the data is encrypted) ---------------- */
  function dbShowUnlock(show){
    var el = document.getElementById('unlockOverlay');
    if(!el) return;
    el.classList.toggle('show', show);
    if(show){
      dbSetStatus('🔐 Data is encrypted — enter the passphrase.');
      setTimeout(function(){ document.getElementById('unlock-pass').focus(); }, 50);
    }
  }
  document.getElementById('unlock-form').addEventListener('submit', function(e){
    e.preventDefault();
    var errEl = document.getElementById('unlock-error');
    errEl.textContent = 'Checking…';
    CC.unlock(document.getElementById('unlock-pass').value).then(function(ok){
      if(!ok){ errEl.textContent = 'That is not the passphrase.' + (CC.setBy() ? ' Ask ' + CC.setBy() + '.' : ''); return; }
      errEl.textContent = '';
      document.getElementById('unlock-pass').value = '';
      dbCryptoCheck();
      dbLogEvent('encryption-unlocked', {name: dbUser ? dbUser.email : ''});
    }).catch(function(err){ errEl.textContent = err.message; });
  });

  var dbSigningIn = false;
  document.getElementById('auth-form').addEventListener('submit', function(e){
    e.preventDefault();
    dbSigningIn = true;
    var email = document.getElementById('auth-email').value.trim();
    var pass = document.getElementById('auth-password').value;
    var errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    firebase.auth().signInWithEmailAndPassword(email, pass).catch(function(err){
      errEl.textContent = /invalid|wrong|not-found|credential/i.test(err.code || '') ? 'Wrong email or password.' : err.message;
    });
  });

  document.addEventListener('click', function(e){
    if(e.target.matches('[data-db-signout]')){
      e.preventDefault();
      if(!dbReady()){ firebase.auth().signOut(); return; }
      // write the sign-out entry first — once signed out the rules refuse writes
      (CC.isLocked() ? Promise.reject() : dbSeal('activity', {collection: 'app', action: 'sign-out', name: dbUser.email, details: {}, at: dbNow(), by: dbUser.email}))
        .then(function(d){ return db.collection('activity').add(d); })
        .catch(function(){})
        .then(function(){ firebase.auth().signOut(); });
    }
  });

  document.addEventListener('DOMContentLoaded', dbInit);
