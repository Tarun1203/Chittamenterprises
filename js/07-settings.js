"use strict";

/* Settings page: business details, UPI IDs, bank accounts, default
   payment modes, and full backup/restore of all app data. */

  function loadSettingsIntoForm(){
    var s = getSettings();
    document.getElementById('st-name').value = s.businessName;
    document.getElementById('st-address').value = s.address;
    renderUpiRows(s.upiList);
    renderBankRows(s.bankList);
    renderModesList(s.paymentModes);
    document.getElementById('sbBusinessName').textContent = s.businessName || 'Chittam Enterprises';
  }

  /* -- UPI rows -- */
  function renderUpiRows(list){
    var wrap = document.getElementById('st-upi-list');
    wrap.innerHTML = '';
    (list && list.length ? list : [{}]).forEach(addUpiRow);
  }
  function addUpiRow(entry){
    entry = entry || {};
    var wrap = document.getElementById('st-upi-list');
    var row = document.createElement('div');
    row.className = 'upi-row';
    row.innerHTML =
      '<input type="text" class="upi-id" placeholder="UPI ID e.g. 8151835682-3@axl" value="' + escapeHtml(entry.upiId||'') + '">' +
      '<input type="text" class="upi-name" placeholder="Payee name" value="' + escapeHtml(entry.payeeName||'') + '">' +
      '<button type="button" class="default-toggle' + (entry.isDefault ? ' active' : '') + '" title="Set as default">' + (entry.isDefault ? '★ Default' : '☆ Default') + '</button>' +
      '<button type="button" class="row-del icon-btn del" title="Remove">✕</button>';
    row.querySelector('.row-del').addEventListener('click', function(){ wrap.removeChild(row); });
    row.querySelector('.default-toggle').addEventListener('click', function(btn){
      wrap.querySelectorAll('.default-toggle').forEach(function(b){ b.classList.remove('active'); b.textContent = '☆ Default'; });
      this.classList.add('active');
      this.textContent = '★ Default';
    });
    wrap.appendChild(row);
  }
  document.getElementById('st-add-upi').addEventListener('click', function(){ addUpiRow(); });

  /* -- bank account cards -- */
  function renderBankRows(list){
    var wrap = document.getElementById('st-bank-list');
    wrap.innerHTML = '';
    (list && list.length ? list : [{}]).forEach(addBankRow);
  }
  function addBankRow(entry){
    entry = entry || {};
    var wrap = document.getElementById('st-bank-list');
    var card = document.createElement('div');
    card.className = 'bank-card';
    card.innerHTML =
      '<button type="button" class="default-toggle' + (entry.isDefault ? ' active' : '') + '" title="Set as default">' + (entry.isDefault ? '★ Default' : '☆ Default') + '</button>' +
      '<button type="button" class="row-del" title="Remove">✕</button>' +
      '<div class="field"><label>Label (optional, e.g. Current A/C)</label><input type="text" class="bank-label" value="' + escapeHtml(entry.label||'') + '"></div>' +
      '<div class="row2"><div class="field"><label>Account No.</label><input type="text" class="bank-accno" value="' + escapeHtml(entry.accountNo||'') + '"></div>' +
      '<div class="field"><label>IFSC</label><input type="text" class="bank-ifsc" value="' + escapeHtml(entry.ifsc||'') + '"></div></div>' +
      '<div class="field"><label>Bank Name &amp; Branch</label><input type="text" class="bank-branch" placeholder="e.g. Indian Bank, Vasavi Nagar Branch, Raichur" value="' + escapeHtml(entry.bankBranch||'') + '"></div>';
    card.querySelector('.row-del').addEventListener('click', function(){ wrap.removeChild(card); });
    card.querySelector('.default-toggle').addEventListener('click', function(){
      wrap.querySelectorAll('.default-toggle').forEach(function(b){ b.classList.remove('active'); b.textContent = '☆ Default'; });
      this.classList.add('active');
      this.textContent = '★ Default';
    });
    wrap.appendChild(card);
  }
  document.getElementById('st-add-bank').addEventListener('click', function(){ addBankRow(); });

  function renderModesList(modes){
    var wrap = document.getElementById('st-modes-list');
    wrap.innerHTML = modes.map(function(m,i){
      return '<span class="mode-chip">' + escapeHtml(m) + '<button data-mode-remove="' + i + '" title="Remove">✕</button></span>';
    }).join('');
  }
  var pendingModes = null;
  document.getElementById('st-modes-list').addEventListener('click', function(e){
    var idx = e.target.dataset.modeRemove;
    if(idx === undefined) return;
    var s = getSettings();
    var modes = (pendingModes || s.paymentModes).slice();
    modes.splice(Number(idx),1);
    pendingModes = modes;
    renderModesList(modes);
  });
  document.getElementById('st-mode-input').addEventListener('keydown', function(e){
    if(e.key !== 'Enter') return;
    e.preventDefault();
    var val = e.target.value.trim();
    if(!val) return;
    var s = getSettings();
    var modes = (pendingModes || s.paymentModes).slice();
    modes.push(val);
    pendingModes = modes;
    renderModesList(modes);
    e.target.value = '';
  });
  document.getElementById('btnSaveSettings').addEventListener('click', function(){
    var upiList = [];
    document.querySelectorAll('#st-upi-list .upi-row').forEach(function(row){
      var upiId = row.querySelector('.upi-id').value.trim();
      var payeeName = row.querySelector('.upi-name').value.trim();
      var isDefault = row.querySelector('.default-toggle').classList.contains('active');
      if(upiId) upiList.push({upiId: upiId, payeeName: payeeName, isDefault: isDefault});
    });
    var bankList = [];
    document.querySelectorAll('#st-bank-list .bank-card').forEach(function(card){
      var accountNo = card.querySelector('.bank-accno').value.trim();
      var ifsc = card.querySelector('.bank-ifsc').value.trim();
      var bankBranch = card.querySelector('.bank-branch').value.trim();
      var label = card.querySelector('.bank-label').value.trim();
      var isDefault = card.querySelector('.default-toggle').classList.contains('active');
      if(accountNo || ifsc || bankBranch) bankList.push({label: label, accountNo: accountNo, ifsc: ifsc, bankBranch: bankBranch, isDefault: isDefault});
    });
    var s = {
      businessName: document.getElementById('st-name').value.trim() || 'Chittam Enterprises',
      address: document.getElementById('st-address').value.trim(),
      upiList: upiList,
      bankList: bankList,
      paymentModes: pendingModes || getSettings().paymentModes
    };
    saveSettings(s);
    pendingModes = null;
    document.getElementById('sbBusinessName').textContent = s.businessName;
    populatePaymentModeSelect();
    refreshBusinessLabels();
    var flag = document.getElementById('settingsSaved');
    flag.classList.add('show');
    setTimeout(function(){ flag.classList.remove('show'); }, 1800);
  });

  function populatePaymentModeSelect(){
    var sel = document.getElementById('pu-mode');
    var modes = getSettings().paymentModes;
    sel.innerHTML = modes.map(function(m){ return '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>'; }).join('');
  }

  /* ---------------- full backup / restore ---------------- */
  document.getElementById('btnExportBackup').addEventListener('click', function(){
    var data = {
      app: 'chittam-message-generator',
      exportedAt: new Date().toISOString(),
      customers: getCustomers(),
      products: getProducts(),
      settings: getSettings()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'chittam-message-generator-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    showToast('Backup downloaded — keep this file somewhere safe.');
  });

  document.getElementById('btnRestoreBackup').addEventListener('click', function(){
    document.getElementById('restoreBackupFile').click();
  });
  document.getElementById('restoreBackupFile').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var text = decodeFileText(ev.target.result);
        var data = JSON.parse(text);
        if(!data || (!data.customers && !data.products && !data.settings)){ throw new Error('bad format'); }
        if(data.customers) saveCustomers(data.customers);
        if(data.products) saveProducts(data.products);
        if(data.settings) saveSettings(data.settings);
        loadSettingsIntoForm();
        renderCustomerTable();
        renderProductTable();
        refreshAllPickers();
        refreshSuDbPicker();
        populatePaymentModeSelect();
        refreshBusinessLabels();
        showToast('Backup restored — customers, products, and settings are back.');
      }catch(err){
        showToast("Couldn't read that file — make sure it's a backup exported from this app.");
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  });

  function populateAccountSelect(){
    // no-op retained for compatibility; account labels are now fixed (Business + Cash), see updatePaymentUpdatedLabels
  }

  function refreshBusinessLabels(){
    var name = getSettings().businessName || 'Chittam Enterprises';
    document.getElementById('lbl-bc-eb').textContent = name + ' Balance (₹)';
    document.getElementById('lbl-pr-eb').textContent = name + ' Outstanding (₹)';
    document.getElementById('lbl-pr-ed').textContent = name + ' Pending (days)';
    updatePaymentUpdatedLabels();
  }

  function updatePaymentUpdatedLabels(){
    var name = getSettings().businessName || 'Chittam Enterprises';
    document.getElementById('lbl-pu-eprev').textContent = name + ' Previous Balance (₹)';
    document.getElementById('lbl-pu-eamt').textContent = name + ' Amount Received (₹)';
    document.getElementById('lbl-pu-efinal').textContent = name + ' Final Balance';
  }

