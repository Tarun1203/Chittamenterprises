"use strict";

/* Transport master: transporter name, contact person, phone and branch,
   saved in the database like customers and products (no delete). Every
   transport field in the app (Orders, Dispatch Confirmation, Service Jobs,
   Service Material) suggests these names, and messages add the contact
   number for a transporter that's on file. */

  var editingTransportId = null;

  function findTransport(name){
    var n = normalizeName(name);
    if(!n) return null;
    return getTransports().find(function(t){ return normalizeName(t.name) === n; }) || null;
  }

  // "VRL Logistics · 📞 9876543210" — the name as typed, plus the number on file
  function transportLine(name, phone){
    name = (name || '').trim();
    if(!name) return '';
    var t = findTransport(name);
    phone = (phone || (t && t.phone) || '').trim();
    return name + (phone ? ' · 📞 ' + phone : '');
  }

  // a transport typed on an order that isn't on file yet gets added to the list
  function rememberTransport(name, phone){
    name = (name || '').trim();
    if(!name || findTransport(name)) return;
    var list = getTransports();
    list.push({id: 't_' + uid().slice(2), name: name, contactPerson: '', phone: (phone || '').trim(), branch: ''});
    saveTransports(list);
  }

  function refreshTransportList(){
    document.getElementById('transport-list').innerHTML = getTransports().map(function(t){
      return '<option value="' + escapeHtml(t.name) + '">' + escapeHtml([t.phone, t.branch].filter(Boolean).join(' · ')) + '</option>';
    }).join('');
  }

  function renderTransports(){
    refreshTransportList();
    var wrap = document.getElementById('trTableWrap');
    var q = (document.getElementById('trSearch').value || '').trim().toLowerCase();
    var all = getTransports().slice().sort(function(a, b){ return a.name.localeCompare(b.name); });
    var list = all.filter(function(t){
      return !q || [t.name, t.contactPerson, t.phone, t.branch].join(' ').toLowerCase().indexOf(q) > -1;
    });
    if(list.length === 0){
      wrap.innerHTML = '<div class="empty-state">' + (all.length ? 'No transports match.' : 'No transports yet. Click "+ Add Transport", or just type one on an order — it is added here automatically.') + '</div>';
      return;
    }
    wrap.innerHTML = '<table class="cust-table"><thead><tr><th>Transport</th><th>Contact Person</th><th>Phone</th><th>Branch / Area</th><th></th></tr></thead><tbody>' +
      list.map(function(t){
        return '<tr><td>' + escapeHtml(t.name) + '</td><td>' + escapeHtml(t.contactPerson || '—') + '</td>' +
          '<td style="font-family:\'IBM Plex Mono\',monospace;">' + escapeHtml(t.phone || '—') + '</td>' +
          '<td>' + escapeHtml(t.branch || '—') + '</td>' +
          '<td><div class="row-actions"><button class="icon-btn" data-tr-edit="' + t.id + '">Edit</button></div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  document.getElementById('trSearch').addEventListener('input', renderTransports);

  var trModal = document.getElementById('trModalOverlay');
  function openTransportModal(t){
    editingTransportId = t ? t.id : null;
    document.getElementById('trModalTitle').textContent = t ? 'Edit Transport' : 'Add Transport';
    document.getElementById('tm-name').value = t ? t.name : '';
    document.getElementById('tm-person').value = t ? (t.contactPerson || '') : '';
    document.getElementById('tm-phone').value = t ? (t.phone || '') : '';
    document.getElementById('tm-branch').value = t ? (t.branch || '') : '';
    trModal.classList.add('show');
    document.getElementById('tm-name').focus();
  }
  document.getElementById('btnAddTransport').addEventListener('click', function(){ openTransportModal(null); });
  document.getElementById('tm-cancel').addEventListener('click', function(){ trModal.classList.remove('show'); });
  trModal.addEventListener('click', function(e){ if(e.target === trModal) trModal.classList.remove('show'); });
  document.getElementById('trTableWrap').addEventListener('click', function(e){
    var id = e.target.dataset.trEdit;
    if(!id) return;
    var t = getTransports().find(function(x){ return x.id === id; });
    if(t) openTransportModal(t);
  });

  document.getElementById('tm-save').addEventListener('click', function(){
    var name = document.getElementById('tm-name').value.trim();
    if(!name){ document.getElementById('tm-name').focus(); return; }
    var dup = findTransport(name);
    if(dup && dup.id !== editingTransportId){ showToast(name + ' is already in the list — edit that one instead.'); return; }
    var data = {
      name: name,
      contactPerson: document.getElementById('tm-person').value.trim(),
      phone: document.getElementById('tm-phone').value.trim(),
      branch: document.getElementById('tm-branch').value.trim()
    };
    var list = getTransports();
    if(editingTransportId){
      list = list.map(function(t){ return t.id === editingTransportId ? Object.assign({}, t, data) : t; });
    }else{
      list.push(Object.assign({id: 't_' + uid().slice(2)}, data));
    }
    saveTransports(list);
    trModal.classList.remove('show');
    renderTransports();
  });

  /* every transport input in the app suggests names from this list */
  ['dc-transport', 'sm-transport', 'sv-in-transport', 'sv-out-transport', 'or-transport'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.setAttribute('list', 'transport-list');
  });
  refreshTransportList();
