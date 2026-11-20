"use strict";

/* Tally balances: customers' closing balances imported from a Tally export
   of each company — "business" (Chittam Enterprises) and "cash" (Cash
   Bill). Picking a customer on Payment Updated, Payment Reminder or
   Balance Confirmation fills both balances in. Each import replaces that
   company's balances, is saved in the database (so every device has it)
   and is logged.

   The export is Tally's Group Summary of Sundry Debtors, shown Detailed
   (Alt+F5) so every ledger is listed, saved as JSON or XML. Group names in
   the file are ignored: only names that match a customer are used. */

  var LS_BALANCES = 'cem_balances';
  var BAL_COMPANIES = {
    business: function(){ return getSettings().businessName || 'Chittam Enterprises'; },
    cash: function(){ return 'Cash Bill'; }
  };

  function getBalances(){
    try{ return JSON.parse(localStorage.getItem(LS_BALANCES)) || {}; }catch(e){ return {}; }
  }
  function setBalancesLocal(all){ localStorage.setItem(LS_BALANCES, JSON.stringify(all)); }

  function balNum(v){
    if(v === undefined || v === null || v === '') return 0;
    if(typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  // Tally shows debit amounts as negative and credit as positive; a customer
  // who owes us has a debit balance, so receivable = -(debit) - credit
  function balAmount(dr, cr){ return Math.round((-balNum(dr) - balNum(cr)) * 100) / 100; }

  /* ---------------- reading the Tally export ---------------- */
  function getCI(obj, key){
    if(!obj || typeof obj !== 'object') return undefined;
    var k = Object.keys(obj).find(function(x){ return x.toLowerCase() === key; });
    return k === undefined ? undefined : obj[k];
  }
  function firstOf(v){ return Array.isArray(v) ? v[0] : v; }
  function infoAmounts(info){
    info = firstOf(info) || {};
    var dr = getCI(firstOf(getCI(info, 'dspcldramt')) || {}, 'dspcldramta');
    var cr = getCI(firstOf(getCI(info, 'dspclcramt')) || {}, 'dspclcramta');
    return balAmount(dr, cr);
  }
  function nameOf(n){
    n = firstOf(n);
    if(typeof n === 'string') return n;
    return String(getCI(n || {}, 'dspdispname') || '').trim();
  }

  // returns [{name, amount}] from Tally JSON or XML
  function parseTallyBalances(text){
    var rows = [];
    text = text.trim();
    if(text.charAt(0) === '<'){
      text = text.replace(/&#(\d+);/g, function(m, n){ n = Number(n); return (n < 32 && n !== 9 && n !== 10 && n !== 13) ? '' : m; });
      var doc = new DOMParser().parseFromString(text, 'text/xml');
      if(doc.getElementsByTagName('parsererror').length) throw new Error('not valid XML');
      var names = doc.getElementsByTagName('DSPACCNAME');
      for(var i = 0; i < names.length; i++){
        var info = names[i].nextElementSibling;
        while(info && info.tagName !== 'DSPACCINFO' && info.tagName !== 'DSPACCNAME') info = info.nextElementSibling;
        if(!info || info.tagName !== 'DSPACCINFO') continue;
        var nm = names[i].getElementsByTagName('DSPDISPNAME')[0];
        var dr = info.getElementsByTagName('DSPCLDRAMTA')[0], cr = info.getElementsByTagName('DSPCLCRAMTA')[0];
        if(nm) rows.push({name: nm.textContent.trim(), amount: balAmount(dr && dr.textContent, cr && cr.textContent)});
      }
      return rows;
    }
    var data = JSON.parse(text);
    (function walk(node){
      if(Array.isArray(node)){ node.forEach(walk); return; }
      if(!node || typeof node !== 'object') return;
      var nm = getCI(node, 'dspaccname'), info = getCI(node, 'dspaccinfo');
      if(nm !== undefined && info !== undefined){
        if(Array.isArray(nm) && Array.isArray(info) && nm.length === info.length && nm.length > 1){
          nm.forEach(function(n, i){ rows.push({name: nameOf(n), amount: infoAmounts(info[i])}); });
        }else{
          rows.push({name: nameOf(nm), amount: infoAmounts(info)});
        }
      }
      Object.keys(node).forEach(function(k){ if(node[k] && typeof node[k] === 'object') walk(node[k]); });
    })(data);
    return rows.filter(function(r){ return r.name; });
  }

  /* ---------------- import ---------------- */
  function importBalances(company, fileName, text){
    var rows = parseTallyBalances(text);
    if(rows.length === 0) throw new Error('no balances found');
    var customers = {};
    getCustomers().forEach(function(c){ customers[normalizeName(c.name)] = c; });
    // keep every name's balance, so a customer added later still gets theirs;
    // names not (yet) in Customers are listed so they can be added
    var map = {}, names = {}, matched = 0, unmatched = [];
    rows.forEach(function(r){
      var k = normalizeName(r.name);
      map[k] = r.amount;
      names[k] = r.name;
      if(customers[k]) matched++;
      else unmatched.push(r.name);
    });
    var entry = {
      company: company, label: BAL_COMPANIES[company](), file: fileName,
      importedAt: new Date().toISOString(), importedBy: (typeof dbUser !== 'undefined' && dbUser) ? dbUser.email : '',
      matched: matched, unmatched: unmatched.slice(0, 300), balances: map, names: names
    };
    var all = getBalances();
    all[company] = entry;
    setBalancesLocal(all);
    if(typeof dbReady === 'function' && dbReady()){
      window.ChittamCrypto.sealDoc('balances', Object.assign({}, entry, {at: firebase.firestore.FieldValue.serverTimestamp(), by: dbUser.email}))
        .then(function(d){ return db.collection('balances').doc(company).set(d); })
        .catch(function(err){ showToast('Balances not saved to the database: ' + err.message); });
    }
    if(typeof dbLogEvent === 'function') dbLogEvent('balances-imported', {name: entry.label, file: fileName, matched: matched, unmatched: unmatched.length});
    renderBalanceStatus();
    return entry;
  }

  function wireImport(company, btnId, fileId){
    document.getElementById(btnId).addEventListener('click', function(){ document.getElementById(fileId).click(); });
    document.getElementById(fileId).addEventListener('change', function(e){
      var file = e.target.files[0];
      if(!file) return;
      var reader = new FileReader();
      reader.onload = function(ev){
        try{
          var entry = importBalances(company, file.name, decodeFileText(ev.target.result));
          showToast(entry.label + ': balances updated for ' + entry.matched + ' customer' + (entry.matched === 1 ? '' : 's') + (entry.unmatched.length ? ' (' + entry.unmatched.length + ' other names kept — see Settings)' : '') + '.');
        }catch(err){
          showToast("Couldn't read balances from that file (" + err.message + "). Export Group Summary → Sundry Debtors, Detailed, as JSON or XML.");
        }
        e.target.value = '';
      };
      reader.readAsArrayBuffer(file);
    });
  }
  wireImport('business', 'btnImportBalBiz', 'balFileBiz');
  wireImport('cash', 'btnImportBalCash', 'balFileCash');

  function renderBalanceStatus(){
    var all = getBalances();
    var customers = {};
    getCustomers().forEach(function(c){ customers[normalizeName(c.name)] = true; });
    document.getElementById('balLabelBiz').textContent = BAL_COMPANIES.business();
    ['business', 'cash'].forEach(function(co){
      var el = document.getElementById(co === 'business' ? 'balStatusBiz' : 'balStatusCash');
      var e = all[co];
      if(!e){ el.innerHTML = 'Not imported yet.'; return; }
      // worked out against today's customer list, so it stays right as customers are added
      var keys = Object.keys(e.balances || {});
      var matched = keys.filter(function(k){ return customers[k]; }).length;
      var unmatched = keys.filter(function(k){ return !customers[k]; }).map(function(k){ return (e.names && e.names[k]) || k; }).sort();
      var when = new Date(e.importedAt).toLocaleString('en-IN', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
      var auto = /^Auto from Tally/.test(e.file || '');
      el.innerHTML = (auto ? '🔄 Synced automatically from Tally' : '✓ Imported from file') + ' · ' + escapeHtml(when) + ' · ' + matched + ' customers' +
        (unmatched.length ? '<details><summary>' + unmatched.length + ' names not in Customers (includes Tally group names) — add a customer with the same name and the balance fills in</summary><div class="bal-unmatched">' +
          unmatched.map(escapeHtml).join(', ') + '</div></details>' : '');
    });
  }

  /* ---------------- filling the forms ---------------- */
  function customerBalance(company, c){
    var e = getBalances()[company];
    if(!e || !c) return null;
    var v = e.balances[normalizeName(c.name)];
    return v === undefined ? null : v;
  }
  function balAge(){
    var all = getBalances(), times = ['business', 'cash'].map(function(k){ return all[k] && all[k].importedAt; }).filter(Boolean).sort();
    return times.length ? new Date(times[0]).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : '';
  }

  // pickerId → [business field, cash field, note element]
  var BAL_FORMS = {
    'pu-picker': ['pu-eprev', 'pu-cprev', 'pu-bal-note'],
    'pr-picker': ['pr-eb', 'pr-cb', 'pr-bal-note'],
    'bc-picker': ['bc-eb', 'bc-cb', 'bc-bal-note']
  };
  Object.keys(BAL_FORMS).forEach(function(pickerId){
    document.getElementById(pickerId).addEventListener('pick', function(e){
      var f = BAL_FORMS[pickerId], c = e.detail;
      var biz = customerBalance('business', c), cash = customerBalance('cash', c);
      var note = document.getElementById(f[2]);
      if(biz === null && cash === null){
        note.textContent = Object.keys(getBalances()).length ? 'No Tally balance on file for this customer — enter it manually.' : '';
        return;
      }
      [[f[0], biz], [f[1], cash]].forEach(function(p){
        var el = document.getElementById(p[0]);
        el.value = p[1] === null ? '' : p[1];
        el.dispatchEvent(new Event('input', {bubbles: true}));
      });
      note.textContent = '📒 Balances filled in from Tally (imported ' + balAge() + '). Check before sending.';
    });
  });

  renderBalanceStatus();
