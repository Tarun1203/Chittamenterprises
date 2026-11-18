"use strict";

/* Look and feel only (no data): 3D icons in the menu, dashboard tiles and
   phone tabs; a spotlight that follows the pointer over tiles and cards;
   staggered entrance of the dashboard tiles. Icons are from 3dicons.co (CC0),
   resized to 96px in icons3d/. */

  var ICON3D = {
    'dashboard': 'chart',
    'payment-reminder': 'calender',
    'payment-updated': 'money-bag',
    'balance-confirmation': 'notebook',
    'stock-update': 'bag',
    'service-material': 'gift',
    'catalog': 'picture',
    'orders': 'file-text',
    'service-jobs': 'tool',
    'dispatch-confirmation': 'rocket',
    'stock-return': 'back',
    'customers': 'boy',
    'products': 'cube',
    'transports': 'location',
    'history': 'clock',
    'settings': 'setting',
    // phone tabs
    'messages': 'chat',
    'more': 'puzzle'
  };

  function icon3d(name){
    return '<img class="ic3d" src="icons3d/' + name + '.png" alt="" draggable="false">';
  }
  function setIcon(el, name){
    if(!el || !name || el.querySelector('img.ic3d')) return;
    el.innerHTML = icon3d(name);
  }

  function apply3dIcons(){
    document.querySelectorAll('.sidebar .navbtn[data-view]').forEach(function(b){
      setIcon(b.querySelector('.ic'), ICON3D[b.dataset.view]);
    });
    document.querySelectorAll('.tile[data-view]').forEach(function(t, i){
      setIcon(t.querySelector('.ic'), ICON3D[t.dataset.view]);
      t.classList.add('spot');
      t.style.setProperty('--i', i);
    });
    document.querySelectorAll('#mTabbar .m-tab[data-tab]').forEach(function(t){
      setIcon(t.querySelector('.ic'), ICON3D[t.dataset.tab]);
    });
    // the catalog's menu entry is added by the catalog script as "📖 Product Catalog"
    var cat = document.getElementById('ce-catalog-nav');
    if(cat && !cat.querySelector('img.ic3d')){
      var first = cat.firstChild;
      if(first && first.nodeType === 3) cat.removeChild(first);
      var span = document.createElement('span');
      span.className = 'ic';
      span.innerHTML = icon3d(ICON3D.catalog);
      cat.insertBefore(span, cat.firstChild);
    }
    var seal = document.querySelector('.welcome-card .seal');
    setIcon(seal, 'boy');
    var welcome = document.querySelector('.welcome-card');
    if(welcome) welcome.classList.add('spot');
  }

  apply3dIcons();
  // the catalog adds its menu entry a moment after start-up
  setTimeout(apply3dIcons, 300);
  setTimeout(apply3dIcons, 1100);

  /* ---------------- spotlight following the pointer ---------------- */
  document.addEventListener('pointermove', function(e){
    var el = e.target.closest && e.target.closest('.spot, .card');
    if(!el) return;
    var r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, {passive: true});

  /* ---------------- replay the tile entrance on each visit to the dashboard ---------------- */
  var lookBaseShowView = showView;
  showView = function(name){
    lookBaseShowView(name);
    if(name === 'dashboard'){
      var grid = document.getElementById('dashTiles');
      if(grid){ grid.classList.remove('tiles-in'); void grid.offsetWidth; grid.classList.add('tiles-in'); }
    }
  };
  var dashGrid = document.getElementById('dashTiles');
  if(dashGrid) dashGrid.classList.add('tiles-in');
