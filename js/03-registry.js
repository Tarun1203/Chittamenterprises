"use strict";

/* Shared "engine" used by every message template: the customer picker
   widget, the pickers/generators registries, and the generic Generate /
   Copy / WhatsApp button handlers (matched by data-generate / data-copy /
   data-wa attributes in the HTML). Individual template files only need to
   register themselves into `pickers` and `generators` -- they never touch
   button wiring directly, so adding or editing one template cannot break
   another. */

  /* ---------------- customer picker component ---------------- */
  // Builds a search+select widget inside container. Returns {getSelected, clear}
  function buildPicker(containerId){
    var container = document.getElementById(containerId);
    container.innerHTML =
      '<input type="text" class="picker-input" placeholder="🔍 Search customer by name or mobile…" autocomplete="off">' +
      '<div class="picker-list"></div>';
    var input = container.querySelector('.picker-input');
    var list = container.querySelector('.picker-list');
    var selected = null;

    function render(filter){
      var customers = getCustomers().slice().sort(function(a,b){ return a.name.localeCompare(b.name); });
      var f = (filter||"").trim().toLowerCase();
      var filtered = customers.filter(function(c){
        return !f || c.name.toLowerCase().indexOf(f) > -1 || (c.mobile||"").indexOf(f) > -1;
      });
      if(filtered.length === 0){
        list.innerHTML = '<div class="picker-empty">' + (customers.length === 0 ? 'No customers yet — add one from the Customers page.' : 'No matches.') + '</div>';
        return;
      }
      list.innerHTML = filtered.map(function(c){
        return '<div class="picker-item" data-id="' + c.id + '"><div class="nm">' + escapeHtml(c.name) + '</div><div class="mb">' + escapeHtml(c.mobile||"") + '</div></div>';
      }).join('');
    }

    input.addEventListener('focus', function(){ render(input.value); list.classList.add('show'); });
    input.addEventListener('input', function(){
      selected = null;
      render(input.value);
      list.classList.add('show');
    });
    document.addEventListener('click', function(e){
      if(!container.contains(e.target)) list.classList.remove('show');
    });
    list.addEventListener('click', function(e){
      var item = e.target.closest('.picker-item');
      if(!item) return;
      var id = item.dataset.id;
      var c = getCustomers().find(function(x){ return x.id === id; });
      if(c){
        selected = c;
        input.value = c.name;
        list.classList.remove('show');
        // lets a page react to the choice (e.g. fill in Tally balances)
        container.dispatchEvent(new CustomEvent('pick', {detail: c}));
      }
    });

    return {
      getSelected: function(){ return selected; },
      select: function(c){ selected = c; input.value = c ? c.name : ''; },
      refresh: function(){ render(input.value); }
    };
  }

  /* ---------------- suggestion dropdown for a plain text field ---------------- */
  // Used for product / transport names on item rows. The browser's own
  // <datalist> often shows nothing on Android and in the installed app, so
  // this draws its own list under the field. source() returns
  // [{value, sub}]; picking one fills the field and fires input + change.
  function attachSuggest(input, source){
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    var wrap = document.createElement('span');
    wrap.className = 'suggest-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var box = document.createElement('div');
    box.className = 'suggest-list';
    wrap.appendChild(box);

    var picking = false;
    function render(){
      if(picking) return;
      var words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      var items = source().filter(function(it){
        var hay = (it.value + ' ' + (it.sub || '')).toLowerCase();
        return words.every(function(w){ return hay.indexOf(w) > -1; });
      }).slice(0, 40);
      if(items.length === 0 || (items.length === 1 && items[0].value === input.value)){ box.classList.remove('show'); return; }
      box.innerHTML = items.map(function(it, i){
        return '<div class="suggest-item" data-i="' + i + '"><div class="nm">' + escapeHtml(it.value) + '</div>' +
          (it.sub ? '<div class="mb">' + escapeHtml(it.sub) + '</div>' : '') + '</div>';
      }).join('');
      box._items = items;
      box.classList.add('show');
    }
    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('blur', function(){ setTimeout(function(){ box.classList.remove('show'); }, 150); });
    // pointerdown fires before the field loses focus, so the tap always lands
    box.addEventListener('pointerdown', function(e){
      var el = e.target.closest('.suggest-item');
      if(!el) return;
      e.preventDefault();
      input.value = box._items[Number(el.dataset.i)].value;
      box.classList.remove('show');
      picking = true;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
      picking = false;
    });
  }

  function productSuggestions(){
    return getProducts().slice().sort(function(a, b){ return a.name.localeCompare(b.name); }).map(function(p){
      return {value: p.name, sub: (p.category ? p.category + ' · ' : '') + inr(p.price)};
    });
  }

var pickers = {};
function refreshAllPickers(){
  Object.keys(pickers).forEach(function(k){ pickers[k].refresh(); });
}

  function bindTotal(ebId, cbId, totalId){
    var eb = document.getElementById(ebId), cb = document.getElementById(cbId), total = document.getElementById(totalId);
    function update(){
      var t = (Number(eb.value)||0) + (Number(cb.value)||0);
      total.textContent = inr(t);
    }
    eb.addEventListener('input', update);
    cb.addEventListener('input', update);
  }
  bindTotal('bc-eb','bc-cb','bc-total');
  bindTotal('pr-eb','pr-cb','pr-total');


  function requireCustomer(pickerKey){
    var c = pickers[pickerKey].getSelected();
    if(!c){
      showToast('Please select a customer first.');
      return null;
    }
    return c;
  }

  // every field on a template page: inputs with an id by id, repeated
  // row inputs (items, invoices…) as one list per row
  function collectFormInputs(view){
    var out = {};
    if(!view) return out;
    view.querySelectorAll('input[id], select[id], textarea[id]').forEach(function(el){
      if(el.type === 'file' || el.closest('.picker') || el.closest('.toolbar')) return;
      out[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    var rows = [];
    view.querySelectorAll('.product-row, .invoice-row, .return-row, .order-row, .sv-item').forEach(function(row){
      var vals = {};
      row.querySelectorAll('input, select').forEach(function(el, i){
        var k = (el.className || '').split(' ')[0] || ('f' + i);
        vals[k] = el.value;
      });
      if(Object.keys(vals).some(function(k){ return vals[k] !== ''; })) rows.push(vals);
    });
    if(rows.length) out.rows = rows;
    return out;
  }

/* filled in by each template file, e.g. generators['payment-updated'] = {...} */
var generators = {};

  document.querySelectorAll('[data-generate]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var key = btn.dataset.generate;
      var g = generators[key];
      var msg = g.fn();
      if(msg === null) return;
      document.getElementById(g.previewId).textContent = msg;
      // save a copy of every generated message to the database history
      var waBtn = document.querySelector('[data-wa-src="' + g.previewId + '"]');
      var customer = waBtn && pickers[waBtn.dataset.wa] ? pickers[waBtn.dataset.wa].getSelected() : null;
      if(typeof dbLogMessage === 'function') dbLogMessage(key, customer, msg, collectFormInputs(btn.closest('.view')));
    });
  });

  function messageTypeFor(previewId){
    var key = Object.keys(generators).find(function(k){ return generators[k].previewId === previewId; });
    return key || previewId;
  }

/* ---------------- copy ---------------- */
  document.querySelectorAll('[data-copy]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var previewId = btn.dataset.copy;
      var text = document.getElementById(previewId).textContent;
      if(!text){ return; }
      var waBtn = document.querySelector('[data-wa-src="' + previewId + '"]');
      var cust = waBtn && pickers[waBtn.dataset.wa] ? pickers[waBtn.dataset.wa].getSelected() : null;
      if(typeof dbLogEvent === 'function') dbLogEvent('message-copied', {type: messageTypeFor(previewId), customerName: cust ? cust.name : '', mobile: cust ? (cust.mobile || '') : ''});
      var flag = btn.querySelector('.copied-flag');
      function flash(){ if(flag){ flag.classList.add('show'); setTimeout(function(){ flag.classList.remove('show'); }, 1600); } }
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(flash).catch(function(){ fallbackCopy(text); flash(); });
      }else{
        fallbackCopy(text); flash();
      }
    });
  });
  function fallbackCopy(text){
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
  }

  /* ---------------- whatsapp ---------------- */
  // Note: wa.me's own text-prefill (?text=...) can corrupt emoji on some
  // phones during the hand-off from browser to the WhatsApp app. Copying
  // to the clipboard and opening a plain chat avoids that entirely.
  document.querySelectorAll('[data-wa]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var pickerKey = btn.dataset.wa;
      var srcId = btn.dataset.waSrc;
      var c = pickers[pickerKey].getSelected();
      var text = document.getElementById(srcId).textContent;
      if(!c){ showToast('Please select a customer first.'); return; }
      if(!text){ showToast('Click Generate first to build the message.'); return; }
      if(!c.mobile){ showToast('This customer has no mobile number saved. Add one from the Customers page.'); return; }
      function openChat(){
        if(typeof dbLogEvent === 'function') dbLogEvent('whatsapp-opened', {type: messageTypeFor(srcId), customerName: c.name, mobile: c.mobile});
        window.open('https://wa.me/' + waNumber(c.mobile), '_blank');
        showToast('Message copied — paste it (long-press → Paste) into the chat that just opened.');
      }
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(openChat).catch(function(){ fallbackCopy(text); openChat(); });
      }else{
        fallbackCopy(text); openChat();
      }
    });
  });

