"use strict";

/* Daily Transactions page: reads the Tally vouchers that the bridge script
   (tally-bridge/tally-sync.ps1) uploaded to the Google Sheet, so the day's
   sales, receipts and returns can be checked from any device. Credit Notes
   / Sales Returns get a button that pre-fills the Stock Return message. */

  var LS_CLOUD_KEY = 'cem_cloud_key';
  var txCache = [];

  document.getElementById('cloud-key').value = localStorage.getItem(LS_CLOUD_KEY) || '';
  document.getElementById('cloud-key').addEventListener('change', function(){
    localStorage.setItem(LS_CLOUD_KEY, this.value.trim());
  });

  document.getElementById('tx-date').value = todayISO();

  function isReturnVoucher(t){
    return /credit\s*note|sales?\s*return|rejection\s*in/i.test(t.voucherType || '');
  }

  function renderTransactions(){
    var type = document.getElementById('tx-type').value;
    var f = document.getElementById('tx-search').value.trim().toLowerCase();
    var list = txCache.filter(function(t){
      if(type && t.voucherType !== type) return false;
      if(!f) return true;
      return [t.party, t.voucherNo, t.narration, t.company].join(' ').toLowerCase().indexOf(f) > -1;
    });

    // totals per voucher type
    var byType = {};
    txCache.forEach(function(t){
      var k = t.voucherType || 'Other';
      byType[k] = byType[k] || {count: 0, amount: 0};
      byType[k].count++;
      byType[k].amount += Number(t.amount) || 0;
    });
    document.getElementById('tx-summary').innerHTML = Object.keys(byType).sort().map(function(k){
      return '<div class="tx-stat"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + inr(Math.round(byType[k].amount)) + '</div><div class="n">' + byType[k].count + ' voucher' + (byType[k].count === 1 ? '' : 's') + '</div></div>';
    }).join('');

    var wrap = document.getElementById('tx-table-wrap');
    if(list.length === 0){
      wrap.innerHTML = '<div class="empty-state">' + (txCache.length ? 'No vouchers match.' : 'No vouchers for this day yet. Click Refresh, or check that the Tally bridge is running on the Tally PC.') + '</div>';
      return;
    }
    var showCompany = txCache.some(function(t){ return t.company; });
    var rows = list.map(function(t, i){
      var items = (t.items || []).map(function(it){ return it.name + (it.qty ? ' × ' + it.qty : ''); }).join(', ');
      var sub = [items, t.narration].filter(Boolean).join(' · ');
      return '<tr>' +
        (showCompany ? '<td>' + escapeHtml(t.company || '') + '</td>' : '') +
        '<td>' + escapeHtml(t.voucherType || '') + '</td>' +
        '<td>' + escapeHtml(t.voucherNo || '') + '</td>' +
        '<td>' + escapeHtml(t.party || '—') + (sub ? '<div class="tx-narr">' + escapeHtml(sub) + '</div>' : '') + '</td>' +
        '<td class="num">' + inr(Number(t.amount) || 0) + '</td>' +
        '<td><div class="row-actions">' + (isReturnVoucher(t) ? '<button class="icon-btn" data-tx-return="' + txCache.indexOf(t) + '">↩ Return msg</button>' : '') + '</div></td>' +
        '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="cust-table"><thead><tr>' + (showCompany ? '<th>Company</th>' : '') + '<th>Type</th><th>Voucher No.</th><th>Party</th><th style="text-align:right;">Amount</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function refreshTypeFilter(){
    var sel = document.getElementById('tx-type');
    var current = sel.value;
    var types = [];
    txCache.forEach(function(t){ if(t.voucherType && types.indexOf(t.voucherType) === -1) types.push(t.voucherType); });
    types.sort();
    sel.innerHTML = '<option value="">All Voucher Types</option>' + types.map(function(t){
      return '<option' + (t === current ? ' selected' : '') + '>' + escapeHtml(t) + '</option>';
    }).join('');
  }

  function loadTransactions(){
    var url = (localStorage.getItem('cem_cloud_url') || '').trim();
    var key = (localStorage.getItem(LS_CLOUD_KEY) || '').trim();
    var meta = document.getElementById('tx-meta');
    if(!url || !key){
      txCache = [];
      meta.textContent = 'Set the Google Sheet Web App URL and Access Key in Settings → Cloud Sync to see Tally transactions here.';
      refreshTypeFilter(); renderTransactions();
      return;
    }
    var date = document.getElementById('tx-date').value || todayISO();
    meta.textContent = 'Loading…';
    fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'action=transactions&date=' + encodeURIComponent(date) + '&key=' + encodeURIComponent(key))
      .then(function(res){ return res.json(); })
      .then(function(data){
        if(!data || !data.ok){
          txCache = [];
          meta.textContent = (data && data.error) || 'The Sheet did not return transactions — update Code.gs and redeploy (see the setup steps in it).';
        }else{
          txCache = data.transactions || [];
          var ls = data.lastSync;
          meta.textContent = txCache.length + ' voucher' + (txCache.length === 1 ? '' : 's') + ' on ' + formatDateForMsg(date) +
            (ls && ls.at ? ' · Last Tally sync: ' + new Date(ls.at).toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) : ' · Tally has not synced yet');
        }
        refreshTypeFilter(); renderTransactions();
      })
      .catch(function(){
        meta.textContent = 'Could not reach the Sheet — check the URL and your internet connection.';
      });
  }

  document.getElementById('btnTxRefresh').addEventListener('click', loadTransactions);
  document.getElementById('tx-date').addEventListener('change', loadTransactions);
  document.getElementById('tx-type').addEventListener('change', renderTransactions);
  document.getElementById('tx-search').addEventListener('input', renderTransactions);

  document.getElementById('tx-table-wrap').addEventListener('click', function(e){
    var btn = e.target.closest('[data-tx-return]');
    if(!btn) return;
    var t = txCache[Number(btn.dataset.txReturn)];
    if(!t) return;
    showView('stock-return');
    srPrefillFromVoucher(t);
  });
