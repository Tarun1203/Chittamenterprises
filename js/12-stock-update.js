"use strict";

/* Stock Update template: message-item rows, the product-database picker
   used to add items to a message, and the message generator. */

pickers['su-picker'] = buildPicker('su-picker');

  var suProductRows = [];
  var suRowSeq = 0;

  function suAddRow(name, price){
    var id = 'row' + (suRowSeq++);
    suProductRows.push(id);
    var wrap = document.getElementById('su-products');
    var row = document.createElement('div');
    row.className = 'product-row';
    row.dataset.rowId = id;
    row.innerHTML =
      '<input type="text" class="prod-name" placeholder="Product name" value="' + escapeHtml(name||'') + '">' +
      '<input type="number" class="prod-price" placeholder="Price (₹)" value="' + (price!==undefined ? price : '') + '">' +
      '<button type="button" class="row-del" title="Remove">✕</button>';
    row.querySelector('.row-del').addEventListener('click', function(){
      suProductRows = suProductRows.filter(function(r){ return r !== id; });
      wrap.removeChild(row);
    });
    wrap.appendChild(row);
  }
  document.getElementById('su-add-product').addEventListener('click', function(){ suAddRow(); });

  /* -- add products from the saved Product Database -- */
  function buildProductPicker(containerId){
    var container = document.getElementById(containerId);
    container.innerHTML =
      '<input type="text" class="picker-input" placeholder="🔍 Search products to add…" autocomplete="off">' +
      '<div class="picker-list"></div>';
    var input = container.querySelector('.picker-input');
    var list = container.querySelector('.picker-list');

    function render(filter){
      var products = getProducts().slice().sort(function(a,b){ return a.name.localeCompare(b.name); });
      var f = (filter||"").trim().toLowerCase();
      var filtered = products.filter(function(p){ return !f || p.name.toLowerCase().indexOf(f) > -1 || (p.category||'').toLowerCase().indexOf(f) > -1; });
      if(filtered.length === 0){
        list.innerHTML = '<div class="picker-empty">' + (products.length === 0 ? 'No products yet — add some in Product Database.' : 'No matches.') + '</div>';
        return;
      }
      list.innerHTML = filtered.map(function(p){
        return '<div class="picker-item" data-id="' + p.id + '"><div class="nm">' + escapeHtml(p.name) + '</div><div class="mb">' + (p.category ? escapeHtml(p.category) + ' · ' : '') + inr(p.price) + '</div></div>';
      }).join('');
    }

    input.addEventListener('focus', function(){ render(input.value); list.classList.add('show'); });
    input.addEventListener('input', function(){ render(input.value); list.classList.add('show'); });
    document.addEventListener('click', function(e){
      if(!container.contains(e.target)) list.classList.remove('show');
    });
    list.addEventListener('click', function(e){
      var item = e.target.closest('.picker-item');
      if(!item) return;
      var p = getProducts().find(function(x){ return x.id === item.dataset.id; });
      if(p){ suAddRow(p.name, p.price); input.value = ''; render(''); input.focus(); }
    });

    return { refresh: function(){ render(input.value); } };
  }
  var suDbPicker = buildProductPicker('su-db-picker');
  function refreshSuDbPicker(){ suDbPicker.refresh(); }

  function generateStockUpdate(){
    var c = requireCustomer('su-picker'); if(!c) return null;
    var s = getSettings();
    var rows = document.querySelectorAll('#su-products .product-row');
    var products = [];
    rows.forEach(function(row){
      var name = row.querySelector('.prod-name').value.trim();
      var price = row.querySelector('.prod-price').value;
      if(name){ products.push({name: name, price: Number(price)||0}); }
    });
    if(products.length === 0){
      showToast('Add at least one product with a name first.');
      return null;
    }
    var signOff = s.businessName + (s.address ? ", " + s.address : "");
    var lines = products.map(function(p){ return "• " + p.name + " - " + inr(p.price); }).join("\n");
    return "📦 *Stock Availability Update*\n" +
      "Namaste Anna/Sir 🙏\n" +
      "The following products are now available at " + signOff + ".\n\n" +
      lines + "\n\n" +
      "For bookings or enquiries, please contact us.\n\n" +
      "Thank you for your continued support. 🙏\n" +
      signOff;
  }

generators['stock-update'] = {fn: generateStockUpdate, previewId: 'su-preview'};
