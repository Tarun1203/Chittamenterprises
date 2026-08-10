"use strict";

/* Customer Master: list, search, sort, add/edit/delete, and import from
   a Tally ledger-contacts JSON export. Nothing outside this file should
   need to change when you edit how customers are stored or displayed. */

  /* ---------------- customers CRUD ---------------- */
  var editingCustomerId = null;
  var deletingCustomerId = null;

  function renderCustomerTable(){
    var wrap = document.getElementById('custTableWrap');
    var q = (document.getElementById('custSearch').value || "").trim().toLowerCase();
    var sortVal = document.getElementById('custSort').value;
    var customers = getCustomers().slice().sort(function(a,b){
      return sortVal === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
    });
    var filtered = customers.filter(function(c){
      return !q || c.name.toLowerCase().indexOf(q) > -1 || (c.mobile||"").indexOf(q) > -1;
    });
    if(filtered.length === 0){
      wrap.innerHTML = '<div class="empty-state">' + (customers.length === 0 ? 'No customers yet. Click "Add Customer" to add your first one.' : 'No customers match your search.') + '</div>';
      return;
    }
    var rows = filtered.map(function(c){
      return '<tr>' +
        '<td>' + escapeHtml(c.name) + '</td>' +
        '<td style="font-family:\'IBM Plex Mono\',monospace;">' + escapeHtml(c.mobile||"—") + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="icon-btn" data-edit="' + c.id + '">Edit</button>' +
          '<button class="icon-btn del" data-del="' + c.id + '">Delete</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="cust-table"><thead><tr><th>Name</th><th>Mobile</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  document.getElementById('custSearch').addEventListener('input', renderCustomerTable);
  document.getElementById('custSort').addEventListener('change', renderCustomerTable);

  var custModal = document.getElementById('custModalOverlay');
  /* ---------------- import customers from Tally ledger JSON ---------------- */

  function cleanMobileFromTally(entry){
    var raw = entry.dspledcontact || entry.dspaddtnlmobilenum || '';
    var digits = String(raw).replace(/\D/g,'');
    if(digits.length === 12 && digits.indexOf('91') === 0) digits = digits.slice(2);
    if(digits.length === 11 && digits.indexOf('0') === 0) digits = digits.slice(1);
    return digits;
  }
  function isBankLedgerName(name){
    return /bank a\/c/i.test(name);
  }
  function importCustomersFromTally(rows){
    var existing = getCustomers();
    var byNameLower = {};
    existing.forEach(function(c){ byNameLower[c.name.trim().toLowerCase()] = c; });
    var added = 0, updated = 0, skippedBank = 0;
    rows.forEach(function(r){
      var name = (r.acctypename || '').trim();
      if(!name) return;
      if(isBankLedgerName(name)){ skippedBank++; return; }
      var mobile = cleanMobileFromTally(r);
      var key = name.toLowerCase();
      var match = byNameLower[key];
      if(match){
        if(mobile && !match.mobile){ match.mobile = mobile; updated++; }
      }else{
        var c = {id: uid(), name: name, mobile: mobile};
        existing.push(c);
        byNameLower[key] = c;
        added++;
      }
    });
    saveCustomers(existing);
    return {added: added, updated: updated, skippedBank: skippedBank, total: rows.length};
  }
  function importLedgerObj(obj){
    var rows = obj.ledgercontactdetails && obj.ledgercontactdetails.ledgercontactdetails;
    if(!rows || !rows.length){ throw new Error('empty'); }
    var result = importCustomersFromTally(rows);
    renderCustomerTable();
    refreshAllPickers();
    showToast('Imported ' + result.added + ' new, updated ' + result.updated + ' (skipped ' + result.skippedBank + ' bank ledgers).');
  }

  document.getElementById('btnImportCustomers').addEventListener('click', function(){
    document.getElementById('custImportFile').click();
  });
  document.getElementById('custImportFile').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var text = decodeFileText(ev.target.result);
        importLedgerObj(JSON.parse(text));
      }catch(err){
        showToast("Couldn't read that file — make sure it's a Tally ledger contacts JSON export.");
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  });

  /* -- import from a GitHub raw JSON URL -- */
  function toGithubRawUrlCust(url){
    var m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/(.+)$/);
    if(m){ return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3]; }
    return url;
  }
  document.getElementById('btnImportCustomersGithub').addEventListener('click', function(){
    var raw = document.getElementById('custGithubUrl').value.trim();
    if(!raw){ showToast('Paste a GitHub raw JSON URL first.'); return; }
    var url = toGithubRawUrlCust(raw);
    showToast('Fetching…');
    fetch(url)
      .then(function(res){
        if(!res.ok){ throw new Error('HTTP ' + res.status); }
        return res.arrayBuffer();
      })
      .then(function(buf){
        var text = decodeFileText(buf);
        importLedgerObj(JSON.parse(text));
      })
      .catch(function(err){
        showToast("Couldn't fetch or read that URL — make sure it's a public raw JSON link.");
      });
  });

  document.getElementById('btnAddCustomer').addEventListener('click', function(){
    editingCustomerId = null;
    document.getElementById('custModalTitle').textContent = 'Add Customer';
    document.getElementById('cm-name').value = '';
    document.getElementById('cm-mobile').value = '';
    custModal.classList.add('show');
    document.getElementById('cm-name').focus();
  });
  document.getElementById('cm-cancel').addEventListener('click', function(){ custModal.classList.remove('show'); });
  custModal.addEventListener('click', function(e){ if(e.target === custModal) custModal.classList.remove('show'); });

  document.getElementById('cm-save').addEventListener('click', function(){
    var name = document.getElementById('cm-name').value.trim();
    var mobile = document.getElementById('cm-mobile').value.trim();
    if(!name){ document.getElementById('cm-name').focus(); return; }
    var list = getCustomers();
    if(editingCustomerId){
      list = list.map(function(c){ return c.id === editingCustomerId ? Object.assign({}, c, {name:name, mobile:mobile}) : c; });
    }else{
      list.push({id: uid(), name: name, mobile: mobile});
    }
    saveCustomers(list);
    custModal.classList.remove('show');
    renderCustomerTable();
    refreshAllPickers();
  });

  document.getElementById('custTableWrap').addEventListener('click', function(e){
    var editId = e.target.dataset.edit;
    var delId = e.target.dataset.del;
    if(editId){
      var c = getCustomers().find(function(x){ return x.id === editId; });
      if(!c) return;
      editingCustomerId = editId;
      document.getElementById('custModalTitle').textContent = 'Edit Customer';
      document.getElementById('cm-name').value = c.name;
      document.getElementById('cm-mobile').value = c.mobile || '';
      custModal.classList.add('show');
    }else if(delId){
      deletingCustomerId = delId;
      var cust = getCustomers().find(function(x){ return x.id === delId; });
      document.getElementById('delModalText').textContent = 'Remove ' + (cust ? cust.name : 'this customer') + '? This can\'t be undone.';
      document.getElementById('delModalOverlay').classList.add('show');
    }
  });

  var delModal = document.getElementById('delModalOverlay');
  document.getElementById('del-cancel').addEventListener('click', function(){ delModal.classList.remove('show'); });
  delModal.addEventListener('click', function(e){ if(e.target === delModal) delModal.classList.remove('show'); });
  document.getElementById('del-confirm').addEventListener('click', function(){
    var list = getCustomers().filter(function(c){ return c.id !== deletingCustomerId; });
    saveCustomers(list);
    deletingCustomerId = null;
    delModal.classList.remove('show');
    renderCustomerTable();
    refreshAllPickers();
  });

