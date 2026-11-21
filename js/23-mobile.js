"use strict";

/* Phone layout: a top app bar with the page title and sync state, a bottom
   tab bar (Home · Orders · Service · Messages · More), and bottom sheets for
   the Messages and More menus. Only shown on small screens (see the
   "Mobile app" section of app.css); the desktop sidebar is untouched. Menu
   entries are built from the sidebar's own buttons, so a page added to the
   sidebar shows up here too. Tables become cards via data-label cells. */

  var M_MESSAGE_VIEWS = ['payment-reminder', 'payment-updated', 'balance-confirmation', 'stock-update', 'catalog',
    'service-material', 'dispatch-confirmation', 'stock-return'];
  var M_MORE_VIEWS = ['customers', 'products', 'transports', 'history', 'settings'];
  var mCurrentView = 'dashboard';

  function mNavEntry(view){
    if(view === 'catalog'){
      var cat = document.getElementById('ce-catalog-nav');
      var catIc = cat && cat.querySelector('.ic');
      return cat ? {iconHtml: catIc ? catIc.innerHTML : '📖', label: 'Product Catalog', el: cat} : null;
    }
    var btn = document.querySelector('.sidebar .navbtn[data-view="' + view + '"]');
    if(!btn) return null;
    var ic = btn.querySelector('.ic');
    // the menu's own icon (a 3D image, or an emoji before it loads)
    return {iconHtml: ic ? ic.innerHTML : '•', label: btn.textContent.replace(ic ? ic.textContent : '', '').trim(), el: btn};
  }

  /* ---------------- page switching ---------------- */
  // the catalog hides pages with inline styles; clear those so every other
  // page shows again (this also fixes blank pages after visiting the catalog)
  var mBaseShowView = showView;
  showView = function(name){
    document.querySelectorAll('main > section').forEach(function(s){ if(s.id !== 'view-catalog') s.style.display = ''; });
    var cat = document.getElementById('view-catalog');
    if(cat) cat.style.display = 'none';
    var catNav = document.getElementById('ce-catalog-nav');
    if(catNav) catNav.classList.remove('ce-on');
    mBaseShowView(name);
    mSetCurrent(name);
  };

  function mSetCurrent(view){
    mCurrentView = view;
    var entry = mNavEntry(view);
    document.getElementById('mTitle').textContent = view === 'dashboard' ? (getSettings().businessName || 'Chittam Enterprises') : (entry ? entry.label : '');
    document.querySelectorAll('#mTabbar .m-tab').forEach(function(t){
      var on = t.dataset.tab === view ||
        (t.dataset.tab === 'messages' && M_MESSAGE_VIEWS.indexOf(view) > -1) ||
        (t.dataset.tab === 'more' && M_MORE_VIEWS.indexOf(view) > -1);
      t.classList.toggle('active', on);
    });
  }

  /* ---------------- bottom sheets ---------------- */
  var sheetBackdrop = document.getElementById('mSheetBackdrop');
  function mOpenSheet(title, views){
    document.getElementById('mSheetTitle').textContent = title;
    var grid = document.getElementById('mSheetGrid');
    grid.innerHTML = '';
    views.forEach(function(v){
      var e = mNavEntry(v);
      if(!e) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-sheet-item' + (v === mCurrentView ? ' active' : '');
      b.innerHTML = '<span class="ic">' + e.iconHtml + '</span><span>' + escapeHtml(e.label) + '</span>';
      b.addEventListener('click', function(){
        mCloseSheet();
        if(v === 'catalog'){ e.el.click(); mSetCurrent('catalog'); }
        else showView(v);
      });
      grid.appendChild(b);
    });
    // pages that live in the new app (same site, so they open inside this app)
    if(title === 'More'){
      [['ledger', 'notebook', 'Ledger Statement'], ['tally', 'star', 'Tally Match'], ['party-codes', 'location', 'Parties & codes']].forEach(function(p){
        var tm = document.createElement('button');
        tm.type = 'button'; tm.className = 'm-sheet-item';
        tm.innerHTML = '<span class="ic"><img class="ic3d" src="icons3d/' + p[1] + '.png" alt="" draggable="false"></span><span>' + p[2] + '</span>';
        tm.addEventListener('click', function(){ mCloseSheet(); location.href = 'next/#/' + p[0]; });
        grid.appendChild(tm);
      });
    }
    var install = document.getElementById('btnInstallApp');
    if(title === 'More' && install && install.style.display !== 'none'){
      var ib = document.createElement('button');
      ib.type = 'button'; ib.className = 'm-sheet-item';
      ib.innerHTML = '<span class="ic">📲</span><span>Install app</span>';
      ib.addEventListener('click', function(){ mCloseSheet(); install.click(); });
      grid.appendChild(ib);
    }
    sheetBackdrop.classList.add('show');
  }
  function mCloseSheet(){ sheetBackdrop.classList.remove('show'); }
  sheetBackdrop.addEventListener('click', function(e){ if(e.target === sheetBackdrop) mCloseSheet(); });

  document.getElementById('mTabbar').addEventListener('click', function(e){
    var t = e.target.closest('.m-tab');
    if(!t) return;
    if(t.dataset.tab === 'messages') mOpenSheet('Messages', M_MESSAGE_VIEWS);
    else if(t.dataset.tab === 'more') mOpenSheet('More', M_MORE_VIEWS);
    else showView(t.dataset.tab);
  });
  document.getElementById('mSettingsBtn').addEventListener('click', function(){ showView('settings'); });

  /* ---------------- sync state in the top bar ---------------- */
  function mSyncFromStatus(){
    var txt = (document.getElementById('dbStatus').textContent || '').trim();
    var el = document.getElementById('mSync');
    var short = /Synced/.test(txt) ? 'Synced' : /Offline/.test(txt) ? 'Offline — will sync' : /Not signed in/.test(txt) ? 'Not signed in' :
      /Connecting/.test(txt) ? 'Connecting…' : /error/i.test(txt) ? 'Database error' : 'On this device';
    el.textContent = short;
    el.className = 'm-sub ' + (/Synced/.test(short) ? 'ok' : /Offline|error/i.test(short) ? 'warn' : '');
  }
  new MutationObserver(mSyncFromStatus).observe(document.getElementById('dbStatus'), {childList: true, characterData: true, subtree: true});
  mSyncFromStatus();

  /* ---------------- tables → cards on phones ---------------- */
  function mLabelTables(root){
    (root.querySelectorAll ? root : document).querySelectorAll('table.cust-table').forEach(function(tbl){
      var heads = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function(th){ return th.textContent.trim(); });
      tbl.querySelectorAll('tbody tr').forEach(function(tr){
        Array.prototype.forEach.call(tr.children, function(td, i){
          if(!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] || '');
        });
      });
    });
  }
  new MutationObserver(function(muts){
    muts.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n.nodeType === 1) mLabelTables(n.parentNode || n); }); });
  }).observe(document.querySelector('main'), {childList: true, subtree: true});
  mLabelTables(document);

  mSetCurrent(document.querySelector('.view.active') ? document.querySelector('.view.active').id.replace('view-', '') : 'dashboard');

/* tiles that open a page of the new app (e.g. Tally Match) */
document.addEventListener('click', function(e){
  var t = e.target.closest('[data-href]');
  if(t) location.href = t.dataset.href;
});
