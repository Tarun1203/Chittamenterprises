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
      }
    });

    return {
      getSelected: function(){ return selected; },
      refresh: function(){ render(input.value); }
    };
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

/* filled in by each template file, e.g. generators['payment-updated'] = {...} */
var generators = {};

  document.querySelectorAll('[data-generate]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var key = btn.dataset.generate;
      var g = generators[key];
      var msg = g.fn();
      if(msg === null) return;
      document.getElementById(g.previewId).textContent = msg;
    });
  });

/* ---------------- copy ---------------- */
  document.querySelectorAll('[data-copy]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var previewId = btn.dataset.copy;
      var text = document.getElementById(previewId).textContent;
      if(!text){ return; }
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

