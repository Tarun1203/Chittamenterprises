"use strict";

/* Product Database: list, search, sort, category filter, add/edit/delete,
   and import from a Tally stock-summary JSON export. */

  var editingProductId = null;
  var deletingProductId = null;

  function populateCategoryFilter(){
    var sel = document.getElementById('prodCategoryFilter');
    var current = sel.value;
    var cats = Array.from(new Set(getProducts().map(function(p){ return (p.category||'').trim(); }).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All Categories</option>' + cats.map(function(c){
      return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
    }).join('');
    if(cats.indexOf(current) > -1) sel.value = current;
  }

  function renderProductTable(){
    var wrap = document.getElementById('prodTableWrap');
    var q = (document.getElementById('prodSearch').value || "").trim().toLowerCase();
    var catFilter = document.getElementById('prodCategoryFilter').value;
    var sortVal = document.getElementById('prodSort').value;
    populateCategoryFilter();
    var products = getProducts().slice();
    products.sort(function(a,b){
      switch(sortVal){
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'price-asc': return (Number(a.price)||0) - (Number(b.price)||0);
        case 'price-desc': return (Number(b.price)||0) - (Number(a.price)||0);
        case 'category-asc': return (a.category||'').localeCompare(b.category||'') || a.name.localeCompare(b.name);
        default: return a.name.localeCompare(b.name);
      }
    });
    var filtered = products.filter(function(p){
      var matchesSearch = !q || p.name.toLowerCase().indexOf(q) > -1 || (p.category||'').toLowerCase().indexOf(q) > -1;
      var matchesCat = !catFilter || (p.category||'') === catFilter;
      return matchesSearch && matchesCat;
    });
    if(filtered.length === 0){
      wrap.innerHTML = '<div class="empty-state">' + (products.length === 0 ? 'No products yet. Click "Add Product" or import from Tally.' : 'No products match your search.') + '</div>';
      return;
    }
    var rows = filtered.map(function(p){
      return '<tr>' +
        '<td>' + escapeHtml(p.name) + '</td>' +
        '<td>' + (p.category ? escapeHtml(p.category) : '<span style="color:var(--ink-soft);">—</span>') + '</td>' +
        '<td style="font-family:\'IBM Plex Mono\',monospace;">' + inr(p.price) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="icon-btn" data-edit="' + p.id + '">Edit</button>' +
          '<button class="icon-btn del" data-del="' + p.id + '">Delete</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="cust-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  document.getElementById('prodSearch').addEventListener('input', renderProductTable);
  document.getElementById('prodCategoryFilter').addEventListener('change', renderProductTable);
  document.getElementById('prodSort').addEventListener('change', renderProductTable);

  var prodModal = document.getElementById('prodModalOverlay');
  document.getElementById('btnAddProduct').addEventListener('click', function(){
    editingProductId = null;
    document.getElementById('prodModalTitle').textContent = 'Add Product';
    document.getElementById('pm-name').value = '';
    document.getElementById('pm-category').value = '';
    document.getElementById('pm-price').value = '';
    prodModal.classList.add('show');
    document.getElementById('pm-name').focus();
  });
  document.getElementById('pm-cancel').addEventListener('click', function(){ prodModal.classList.remove('show'); });
  prodModal.addEventListener('click', function(e){ if(e.target === prodModal) prodModal.classList.remove('show'); });

  document.getElementById('pm-save').addEventListener('click', function(){
    var name = document.getElementById('pm-name').value.trim();
    var category = document.getElementById('pm-category').value.trim();
    var price = Number(document.getElementById('pm-price').value)||0;
    if(!name){ document.getElementById('pm-name').focus(); return; }
    var list = getProducts();
    if(editingProductId){
      list = list.map(function(p){ return p.id === editingProductId ? Object.assign({}, p, {name:name, category:category, price:price}) : p; });
    }else{
      list.push({id: uid(), name: name, category: category, price: price});
    }
    saveProducts(list);
    prodModal.classList.remove('show');
    renderProductTable();
    refreshSuDbPicker();
  });

  document.getElementById('prodTableWrap').addEventListener('click', function(e){
    var editId = e.target.dataset.edit;
    var delId = e.target.dataset.del;
    if(editId){
      var p = getProducts().find(function(x){ return x.id === editId; });
      if(!p) return;
      editingProductId = editId;
      document.getElementById('prodModalTitle').textContent = 'Edit Product';
      document.getElementById('pm-name').value = p.name;
      document.getElementById('pm-category').value = p.category || '';
      document.getElementById('pm-price').value = p.price;
      prodModal.classList.add('show');
    }else if(delId){
      deletingProductId = delId;
      var prod = getProducts().find(function(x){ return x.id === delId; });
      document.getElementById('prodDelModalText').textContent = 'Remove ' + (prod ? prod.name : 'this product') + '? This can\'t be undone.';
      document.getElementById('prodDelModalOverlay').classList.add('show');
    }
  });

  var prodDelModal = document.getElementById('prodDelModalOverlay');
  document.getElementById('proddel-cancel').addEventListener('click', function(){ prodDelModal.classList.remove('show'); });
  prodDelModal.addEventListener('click', function(e){ if(e.target === prodDelModal) prodDelModal.classList.remove('show'); });
  document.getElementById('proddel-confirm').addEventListener('click', function(){
    var list = getProducts().filter(function(p){ return p.id !== deletingProductId; });
    saveProducts(list);
    deletingProductId = null;
    prodDelModal.classList.remove('show');
    renderProductTable();
    refreshSuDbPicker();
  });

  /* ---------------- import products from Tally stock summary JSON ---------------- */
  function flattenStockLines(lines, items, category){
    items = items || [];
    (lines || []).forEach(function(line){
      var name = (line.dspaccname && line.dspaccname.dspdispname) || '';
      var expl = line.ssgrpexplosion;
      var sublines = expl && expl.dspaccline;
      if(sublines && sublines.length){
        flattenStockLines(sublines, items, category || name);
      }else{
        var stkinfo = (line.dspstkinfo && line.dspstkinfo[0] && line.dspstkinfo[0].dspstkcl) || {};
        items.push({name: name, qty: stkinfo.dspclqty, rate: stkinfo.dspclrate, category: category || ''});
      }
    });
    return items;
  }
  function importStockObj(obj){
    var lines = obj.dspaccbody && obj.dspaccbody.dspaccline;
    if(!lines || !lines.length){ throw new Error('empty'); }
    var flat = flattenStockLines(lines);
    var usable = flat.filter(function(it){ return it.name && it.name.trim(); });
    if(usable.length === 0){ showToast('No named items found in that file.'); return; }
    var existing = getProducts();
    var byNameLower = {};
    existing.forEach(function(p){ byNameLower[p.name.trim().toLowerCase()] = p; });
    var added = 0, updated = 0, noPriceCount = 0;
    usable.forEach(function(it){
      var key = it.name.trim().toLowerCase();
      var hasPrice = it.rate && parseFloat(it.rate) > 0;
      var price = hasPrice ? parseFloat(it.rate) : 0;
      if(!hasPrice) noPriceCount++;
      var match = byNameLower[key];
      if(match){
        if(hasPrice && match.price !== price){ match.price = price; updated++; }
        if(it.category && !match.category){ match.category = it.category; }
      }else{
        var p = {id: uid(), name: it.name, category: it.category || '', price: price};
        existing.push(p);
        byNameLower[key] = p;
        added++;
      }
    });
    saveProducts(existing);
    renderProductTable();
    refreshSuDbPicker();
    showToast('Imported ' + added + ' new, updated ' + updated + ' prices' + (noPriceCount ? ' (' + noPriceCount + ' had no price — set to ₹0, edit as needed)' : '') + '.');
  }

  document.getElementById('btnImportStockDb').addEventListener('click', function(){
    document.getElementById('stockDbImportFile').click();
  });
  document.getElementById('stockDbImportFile').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var text = decodeFileText(ev.target.result);
        importStockObj(JSON.parse(text));
      }catch(err){
        showToast("Couldn't read that file — make sure it's a Tally stock summary JSON export.");
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  });

  /* -- import from a GitHub raw JSON URL -- */
  function toGithubRawUrl(url){
    // Convert a normal "github.com/.../blob/..." link into its raw form automatically.
    var m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/(.+)$/);
    if(m){ return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3]; }
    return url;
  }
  document.getElementById('btnImportStockGithub').addEventListener('click', function(){
    var raw = document.getElementById('prodGithubUrl').value.trim();
    if(!raw){ showToast('Paste a GitHub raw JSON URL first.'); return; }
    var url = toGithubRawUrl(raw);
    showToast('Fetching…');
    fetch(url)
      .then(function(res){
        if(!res.ok){ throw new Error('HTTP ' + res.status); }
        return res.arrayBuffer();
      })
      .then(function(buf){
        var text = decodeFileText(buf);
        importStockObj(JSON.parse(text));
      })
      .catch(function(err){
        showToast("Couldn't fetch or read that URL — make sure it's a public raw JSON link.");
      });
  });

