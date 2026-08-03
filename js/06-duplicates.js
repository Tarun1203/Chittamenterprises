"use strict";

/* Duplicate finder shared by the Customers and Product Database pages. */


  function findDuplicateCustomers(){
    var list = getCustomers();
    var byName = {}, byMobile = {};
    list.forEach(function(c){
      var nk = normalizeName(c.name);
      (byName[nk] = byName[nk] || []).push(c);
      if(c.mobile){
        var mk = digitsOnly(c.mobile);
        if(mk){ (byMobile[mk] = byMobile[mk] || []).push(c); }
      }
    });
    var groups = [];
    Object.keys(byName).forEach(function(k){ if(byName[k].length > 1) groups.push({label: 'Same name', items: byName[k]}); });
    Object.keys(byMobile).forEach(function(k){ if(byMobile[k].length > 1) groups.push({label: 'Same mobile number', items: byMobile[k]}); });
    return groups;
  }
  function findDuplicateProducts(){
    var list = getProducts();
    var byName = {};
    list.forEach(function(p){
      var nk = normalizeName(p.name);
      (byName[nk] = byName[nk] || []).push(p);
    });
    var groups = [];
    Object.keys(byName).forEach(function(k){ if(byName[k].length > 1) groups.push({label: 'Same name', items: byName[k]}); });
    return groups;
  }

  var dupModal = document.getElementById('dupModalOverlay');
  var currentDupKind = null;

  function renderDupModal(kind){
    currentDupKind = kind;
    var groups = kind === 'customer' ? findDuplicateCustomers() : findDuplicateProducts();
    var body = document.getElementById('dupModalBody');
    document.getElementById('dupModalTitle').textContent = kind === 'customer' ? 'Duplicate Customers' : 'Duplicate Products';
    if(groups.length === 0){
      body.innerHTML = '<p style="font-size:14px; color:var(--ink-soft);">No duplicates found.</p>';
      dupModal.classList.add('show');
      return;
    }
    body.innerHTML = groups.map(function(g){
      var itemsHtml = g.items.map(function(item){
        var sub = kind === 'customer' ? (item.mobile || 'no mobile') : inr(item.price);
        return '<div class="dup-item"><span>' + escapeHtml(item.name) + ' <span class="dup-sub">(' + escapeHtml(sub) + ')</span></span>' +
          '<button class="icon-btn del" data-dup-del="' + item.id + '">Delete</button></div>';
      }).join('');
      return '<div class="dup-group"><div class="dup-group-label">' + g.label + '</div>' + itemsHtml + '</div>';
    }).join('');
    dupModal.classList.add('show');
  }

  document.getElementById('btnFindDupCustomers').addEventListener('click', function(){ renderDupModal('customer'); });
  document.getElementById('btnFindDupProducts').addEventListener('click', function(){ renderDupModal('product'); });
  document.getElementById('dupModalClose').addEventListener('click', function(){ dupModal.classList.remove('show'); });
  dupModal.addEventListener('click', function(e){ if(e.target === dupModal) dupModal.classList.remove('show'); });

  document.getElementById('dupModalBody').addEventListener('click', function(e){
    var delId = e.target.dataset.dupDel;
    if(!delId) return;
    if(currentDupKind === 'customer'){
      saveCustomers(getCustomers().filter(function(c){ return c.id !== delId; }));
      renderCustomerTable();
      refreshAllPickers();
    }else{
      saveProducts(getProducts().filter(function(p){ return p.id !== delId; }));
      renderProductTable();
      refreshSuDbPicker();
    }
    renderDupModal(currentDupKind);
  });

