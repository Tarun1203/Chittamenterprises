"use strict";

/* Service Jobs: products a dealer sends in for service. Each job records
   what was received (product, qty, serial no., issue), what was done to
   each product — repaired, replaced (with the replacement product and its
   new serial no.), not repairable, or returned as is — any charges, and
   when / how it went back. Saved through saveServiceJobs(), so every job
   and every edit lands in the Firebase database and the activity log.
   Jobs can't be deleted. */

pickers['sv-picker'] = buildPicker('sv-picker');

  var SV_STATUSES = ['Received', 'Under Service', 'Ready to Return', 'Sent Back'];
  var SV_ACTIONS = ['Pending', 'Repaired', 'Replaced', 'Not Repairable', 'Returned As Is'];
  var editingJobId = null;

  document.getElementById('sv-status').innerHTML = SV_STATUSES.map(function(s){ return '<option>' + s + '</option>'; }).join('');
  document.getElementById('svStatusFilter').innerHTML = '<option value="">All Statuses</option>' +
    SV_STATUSES.map(function(s){ return '<option>' + s + '</option>'; }).join('');

  function svBadge(s){
    s = s || 'Received';
    return '<span class="or-status s-' + s.toLowerCase().replace(/\s+/g, '-') + '">' + escapeHtml(s) + '</span>';
  }

  // Job No. = SV-DD/MM-serial, restarting every day like order numbers
  function nextJobNo(iso){
    iso = iso || todayISO();
    var p = iso.split('-');
    var prefix = 'SV-' + p[2] + '/' + p[1] + '-';
    var max = 0;
    getServiceJobs().forEach(function(j){
      if(j.receivedDate !== iso || String(j.jobNo || '').indexOf(prefix) !== 0) return;
      max = Math.max(max, Number(String(j.jobNo).slice(prefix.length)) || 0);
    });
    return prefix + String(max + 1).padStart(2, '0');
  }

  function svItemSummary(it){
    var s = it.product + (it.qty > 1 ? ' × ' + it.qty : '') + (it.serial ? ' (S/N ' + it.serial + ')' : '');
    if(it.action === 'Replaced') s += ' → replaced with ' + (it.replProduct || it.product) + (it.replSerial ? ' (S/N ' + it.replSerial + ')' : '');
    else if(it.action && it.action !== 'Pending') s += ' — ' + it.action.toLowerCase();
    return s;
  }

  /* ---------------- list ---------------- */
  function renderServiceJobs(){
    var jobs = getServiceJobs().slice().sort(function(a, b){
      return (b.receivedDate || '').localeCompare(a.receivedDate || '') || String(b.jobNo).localeCompare(String(a.jobNo));
    });

    var counts = {}, pendingItems = 0, replaced = 0;
    jobs.forEach(function(j){
      counts[j.status] = (counts[j.status] || 0) + 1;
      (j.items || []).forEach(function(it){
        if(j.status !== 'Sent Back' && (!it.action || it.action === 'Pending')) pendingItems += Number(it.qty) || 1;
        if(it.action === 'Replaced') replaced += Number(it.qty) || 1;
      });
    });
    document.getElementById('svSummary').innerHTML = jobs.length ?
      SV_STATUSES.filter(function(s){ return counts[s]; }).map(function(s){ return '<span class="or-chip">' + s + '<strong>' + counts[s] + '</strong></span>'; }).join('') +
      '<span class="or-chip">Products still to service<strong>' + pendingItems + '</strong></span>' +
      '<span class="or-chip">Replaced so far<strong>' + replaced + '</strong></span>' : '';

    var q = document.getElementById('svSearch').value.trim().toLowerCase();
    var st = document.getElementById('svStatusFilter').value;
    var list = jobs.filter(function(j){
      if(st && j.status !== st) return false;
      if(!q) return true;
      var hay = [j.jobNo, j.customerName, j.notes].concat((j.items || []).map(function(it){
        return [it.product, it.serial, it.issue, it.replProduct, it.replSerial].join(' ');
      })).join(' ').toLowerCase();
      return hay.indexOf(q) > -1;
    });

    var wrap = document.getElementById('svTableWrap');
    if(list.length === 0){
      wrap.innerHTML = '<div class="empty-state">' + (jobs.length ? 'No service jobs match.' : 'No service jobs yet. Click "+ New Service Job" when a dealer sends products for service.') + '</div>';
      return;
    }
    wrap.innerHTML = '<div style="overflow-x:auto;"><table class="cust-table"><thead><tr><th>Job No.</th><th>Received</th><th>Dealer</th><th>Products</th><th>Sent Back</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.map(function(j){
        return '<tr>' +
          '<td style="font-family:\'IBM Plex Mono\',monospace; white-space:nowrap;">' + escapeHtml(j.jobNo || '') + '</td>' +
          '<td style="white-space:nowrap;">' + escapeHtml(formatDateForMsg(j.receivedDate)) + '</td>' +
          '<td>' + escapeHtml(j.customerName || '—') + '</td>' +
          '<td style="font-size:12.5px; color:var(--ink-soft);">' + (j.items || []).map(function(it){ return escapeHtml(svItemSummary(it)); }).join('<br>') + '</td>' +
          '<td style="white-space:nowrap;">' + escapeHtml(j.sentDate ? formatDateForMsg(j.sentDate) : '—') + '</td>' +
          '<td>' + svBadge(j.status) + '</td>' +
          '<td><div class="row-actions"><button class="icon-btn" data-job-edit="' + j.id + '">Open</button></div></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  document.getElementById('svSearch').addEventListener('input', renderServiceJobs);
  document.getElementById('svStatusFilter').addEventListener('change', renderServiceJobs);
  document.getElementById('svTableWrap').addEventListener('click', function(e){
    var id = e.target.dataset.jobEdit;
    if(!id) return;
    var j = getServiceJobs().find(function(x){ return x.id === id; });
    if(j) openJobEditor(j);
  });

  /* ---------------- editor: product cards ---------------- */
  function svAddItem(it){
    it = it || {};
    var wrap = document.getElementById('sv-items');
    var card = document.createElement('div');
    card.className = 'sv-item';
    function v(x){ return escapeHtml(x === undefined || x === null ? '' : x); }
    card.innerHTML =
      '<button type="button" class="row-del" title="Remove this product from the job">✕</button>' +
      '<div class="sv-grid">' +
        '<div><div class="sv-lbl">Product received</div><input type="text" class="sv-product" list="sv-product-list" placeholder="Product name" value="' + v(it.product) + '"></div>' +
        '<div><div class="sv-lbl">Qty</div><input type="number" class="sv-qty" min="1" value="' + v(it.qty || 1) + '"></div>' +
        '<div><div class="sv-lbl">Serial No.</div><input type="text" class="sv-serial" placeholder="S/N" value="' + v(it.serial) + '"></div>' +
      '</div>' +
      '<div style="margin-top:10px;"><div class="sv-lbl">Issue reported</div><input type="text" class="sv-issue" placeholder="e.g. No output, display dead" value="' + v(it.issue) + '"></div>' +
      '<div class="sv-grid2">' +
        '<div><div class="sv-lbl">Action taken</div><select class="sv-action">' + SV_ACTIONS.map(function(a){ return '<option' + (a === (it.action || 'Pending') ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div>' +
        '<div><div class="sv-lbl">Replacement product</div><input type="text" class="sv-repl-product" list="sv-product-list" placeholder="Same as received" value="' + v(it.replProduct) + '"></div>' +
        '<div><div class="sv-lbl">New Serial No.</div><input type="text" class="sv-repl-serial" placeholder="S/N" value="' + v(it.replSerial) + '"></div>' +
        '<div><div class="sv-lbl">Charges (₹)</div><input type="number" class="sv-charges" placeholder="0" value="' + v(it.charges || '') + '"></div>' +
      '</div>';
    var action = card.querySelector('.sv-action');
    function syncReplacement(){
      var on = action.value === 'Replaced';
      card.querySelector('.sv-repl-product').disabled = !on;
      card.querySelector('.sv-repl-serial').disabled = !on;
    }
    action.addEventListener('change', function(){ syncReplacement(); svUpdateTotals(); });
    card.querySelectorAll('input').forEach(function(el){ el.addEventListener('input', svUpdateTotals); });
    card.querySelector('.row-del').addEventListener('click', function(){ wrap.removeChild(card); svUpdateTotals(); });
    syncReplacement();
    wrap.appendChild(card);
    svUpdateTotals();
  }
  document.getElementById('sv-add-item').addEventListener('click', function(){ svAddItem(); });

  function svItems(){
    var items = [];
    document.querySelectorAll('#sv-items .sv-item').forEach(function(card){
      var product = card.querySelector('.sv-product').value.trim();
      if(!product) return;
      var action = card.querySelector('.sv-action').value;
      items.push({
        product: product,
        qty: Number(card.querySelector('.sv-qty').value) || 1,
        serial: card.querySelector('.sv-serial').value.trim(),
        issue: card.querySelector('.sv-issue').value.trim(),
        action: action,
        replProduct: action === 'Replaced' ? (card.querySelector('.sv-repl-product').value.trim() || product) : '',
        replSerial: action === 'Replaced' ? card.querySelector('.sv-repl-serial').value.trim() : '',
        charges: Number(card.querySelector('.sv-charges').value) || 0
      });
    });
    return items;
  }
  function svUpdateTotals(){
    var items = svItems();
    var done = items.filter(function(i){ return i.action !== 'Pending'; }).length;
    var charges = items.reduce(function(s, i){ return s + i.charges; }, 0);
    document.getElementById('sv-totals').innerHTML = items.length ?
      items.length + ' product' + (items.length === 1 ? '' : 's') + ' · ' + done + ' done · Charges: <strong>' + inr(charges) + '</strong>' : '';
    return charges;
  }

  /* ---------------- editor: open / save ---------------- */
  function openJobEditor(j){
    editingJobId = j ? j.id : null;
    document.getElementById('sv-product-list').innerHTML = getProducts().map(function(p){ return '<option value="' + escapeHtml(p.name) + '">'; }).join('');
    document.getElementById('sv-editor-eyebrow').textContent = j ? 'Service Job ' + (j.jobNo || '') : 'New Service Job';
    document.getElementById('sv-editor-title').textContent = j ? (j.customerName || 'Service Job') : 'New Service Job';
    var c = j ? getCustomers().find(function(x){ return x.id === j.customerId; }) : null;
    pickers['sv-picker'].select(c || (j ? {id: j.customerId, name: j.customerName, mobile: j.mobile} : null));
    document.getElementById('sv-no').value = j ? (j.jobNo || '') : nextJobNo(todayISO());
    document.getElementById('sv-received').value = j ? (j.receivedDate || '') : todayISO();
    document.getElementById('sv-in-transport').value = j ? (j.inTransport || '') : '';
    document.getElementById('sv-status').value = j ? (j.status || 'Received') : 'Received';
    document.getElementById('sv-timeline').value = j ? (j.timeline || '') : '';
    document.getElementById('sv-sent').value = j ? (j.sentDate || '') : '';
    document.getElementById('sv-out-transport').value = j ? (j.outTransport || '') : '';
    document.getElementById('sv-notes').value = j ? (j.notes || '') : '';
    document.getElementById('sv-items').innerHTML = '';
    ((j && j.items && j.items.length) ? j.items : [{}]).forEach(svAddItem);
    document.getElementById('sv-msgtype').value = j && j.status === 'Sent Back' ? 'returned' : 'received';
    document.getElementById('sv-preview').textContent = '';
    document.getElementById('sv-list-wrap').style.display = 'none';
    document.getElementById('sv-editor').style.display = '';
    window.scrollTo(0, 0);
  }
  function closeJobEditor(){
    editingJobId = null;
    document.getElementById('sv-editor').style.display = 'none';
    document.getElementById('sv-list-wrap').style.display = '';
    renderServiceJobs();
  }
  document.getElementById('btnNewJob').addEventListener('click', function(){ openJobEditor(null); });
  document.getElementById('btnCloseJob').addEventListener('click', closeJobEditor);

  document.getElementById('sv-received').addEventListener('change', function(){
    if(editingJobId) return;
    var noEl = document.getElementById('sv-no');
    if(!noEl.value || /^SV-\d{2}\/\d{2}-\d+$/.test(noEl.value)) noEl.value = nextJobNo(this.value || todayISO());
  });
  // filling in the sent-back date moves the job to Sent Back
  document.getElementById('sv-sent').addEventListener('change', function(){
    if(this.value) document.getElementById('sv-status').value = 'Sent Back';
  });

  function jobFromForm(){
    var c = pickers['sv-picker'].getSelected();
    if(!c){ showToast('Please select the dealer first.'); return null; }
    var items = svItems();
    if(items.length === 0){ showToast('Add at least one product with a name.'); return null; }
    var received = document.getElementById('sv-received').value || todayISO();
    var jobNo = document.getElementById('sv-no').value.trim() || nextJobNo(received);
    var clash = getServiceJobs().find(function(j){
      return j.jobNo === jobNo && j.id !== editingJobId && String(j.receivedDate || '').slice(0, 4) === received.slice(0, 4);
    });
    if(clash){ showToast('Job No. ' + jobNo + ' is already used — change it.'); return null; }
    return {
      jobNo: jobNo,
      receivedDate: received,
      inTransport: document.getElementById('sv-in-transport').value.trim(),
      customerId: c.id, customerName: c.name, mobile: c.mobile || '',
      status: document.getElementById('sv-status').value,
      timeline: document.getElementById('sv-timeline').value.trim(),
      items: items,
      totalCharges: svUpdateTotals(),
      sentDate: document.getElementById('sv-sent').value,
      outTransport: document.getElementById('sv-out-transport').value.trim(),
      notes: document.getElementById('sv-notes').value.trim()
    };
  }

  document.getElementById('btnSaveJob').addEventListener('click', function(){
    var data = jobFromForm();
    if(!data) return;
    var list = getServiceJobs();
    if(editingJobId){
      list = list.map(function(j){ return j.id === editingJobId ? Object.assign({}, j, data) : j; });
    }else{
      editingJobId = 'sv_' + uid().slice(2);
      list.push(Object.assign({id: editingJobId}, data));
    }
    saveServiceJobs(list);
    document.getElementById('sv-editor-eyebrow').textContent = 'Service Job ' + data.jobNo;
    document.getElementById('sv-editor-title').textContent = data.customerName;
    var flag = document.getElementById('svSaved');
    flag.classList.add('show');
    setTimeout(function(){ flag.classList.remove('show'); }, 1800);
    showToast('Service job ' + data.jobNo + ' saved.');
  });

  /* ---------------- messages ---------------- */
  function generateServiceJobMessage(){
    var j = jobFromForm(); if(!j) return null;
    var s = getSettings();
    var signOff = s.businessName + (s.address ? ", " + s.address : "") + ",";
    var type = document.getElementById('sv-msgtype').value;

    if(type === 'received'){
      var lines = j.items.map(function(it, i){
        return (i + 1) + ". " + it.product + (it.qty > 1 ? " × " + it.qty : "") +
          (it.serial ? "\n   S/N: " + it.serial : "") + (it.issue ? "\n   Issue: " + it.issue : "");
      }).join("\n");
      return "📥 *Service Material Received*\n\n" +
        "Namaste Anna/Sir 🙏\n" +
        "We have received the following products from you for service.\n\n" +
        "🧾 Service Job No.: " + j.jobNo + "\n" +
        "📅 Received On: " + formatDateForMsg(j.receivedDate) + "\n" +
        (j.inTransport ? "🚛 Received Via: " + j.inTransport + "\n" : "") +
        "\n*Products:*\n" + lines + "\n\n" +
        (j.timeline ? "⏳ Expected service time: " + j.timeline + "\n\n" : "") +
        "We will update you once the service is completed. Please quote the Job No. for any follow-up.\n\n" +
        "Thank you for your support. 🙏\n" +
        signOff;
    }

    var out = j.items.map(function(it, i){
      var line = (i + 1) + ". " + it.product + (it.qty > 1 ? " × " + it.qty : "") + (it.serial ? " (S/N: " + it.serial + ")" : "");
      if(it.action === 'Replaced'){
        line += "\n   🔁 Replaced with: " + it.replProduct + (it.replSerial ? "\n   New S/N: " + it.replSerial : "");
      }else if(it.action === 'Repaired'){
        line += "\n   ✅ Repaired";
      }else if(it.action === 'Not Repairable'){
        line += "\n   ⚠️ Not repairable — returned";
      }else if(it.action === 'Returned As Is'){
        line += "\n   ↩️ Returned as is";
      }else{
        line += "\n   ⏳ Still under service";
      }
      if(it.charges) line += "\n   💰 Charges: " + inr(it.charges);
      return line;
    }).join("\n");
    return "📤 *Service Completed & Dispatched*\n\n" +
      "Namaste Anna/Sir 🙏\n" +
      "The products you sent for service have been attended to and sent back.\n\n" +
      "🧾 Service Job No.: " + j.jobNo + "\n" +
      "📅 Received On: " + formatDateForMsg(j.receivedDate) + "\n" +
      (j.sentDate ? "📦 Sent Back On: " + formatDateForMsg(j.sentDate) + "\n" : "") +
      (j.outTransport ? "🚛 Transport: " + j.outTransport + "\n" : "") +
      "\n*Products:*\n" + out + "\n" +
      (j.totalCharges ? "\n💰 *Total Service Charges: " + inr(j.totalCharges) + "*\n" : "") +
      (j.notes ? "\n📝 " + j.notes + "\n" : "") +
      "\nKindly confirm once received and check that everything is in order.\n\n" +
      "Thank you for your support. 🙏\n" +
      signOff;
  }

generators['service-job'] = {fn: generateServiceJobMessage, previewId: 'sv-preview'};
