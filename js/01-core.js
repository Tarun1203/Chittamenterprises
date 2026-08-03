"use strict";

/* Shared utilities used by every other file: toast messages, localStorage
   read/write for customers/products/settings, formatting helpers, and
   Tally file decoding. This file must load before all others. */

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------------- storage helpers ---------------- */
  var LS_CUST = "cem_customers";
  var LS_PRODUCTS = "cem_products";
  var LS_SETTINGS = "cem_settings";

  function getCustomers(){
    try{ return JSON.parse(localStorage.getItem(LS_CUST)) || []; }catch(e){ return []; }
  }
  function saveCustomers(list){ localStorage.setItem(LS_CUST, JSON.stringify(list)); }

  function getProducts(){
    try{ return JSON.parse(localStorage.getItem(LS_PRODUCTS)) || []; }catch(e){ return []; }
  }
  function saveProducts(list){ localStorage.setItem(LS_PRODUCTS, JSON.stringify(list)); }

  function getSettings(){
    var defaults = {
      businessName: "Chittam Enterprises",
      address: "",
      upiList: [],
      bankList: [],
      paymentModes: ["Cash","UPI","Bank Transfer","Cheque"]
    };
    try{
      var raw = JSON.parse(localStorage.getItem(LS_SETTINGS)) || {};
      var merged = Object.assign({}, defaults, raw);
      // migrate old single-value UPI/bank fields into the new lists
      if((!merged.upiList || merged.upiList.length === 0) && raw.upiId){
        merged.upiList = [{upiId: raw.upiId, payeeName: raw.upiPayeeName || ''}];
      }
      if((!merged.bankList || merged.bankList.length === 0) && raw.bankAccount){
        merged.bankList = [{label: '', accountNo: raw.bankAccount, ifsc: raw.ifsc || '', bankBranch: raw.bankBranch || ''}];
      }
      return merged;
    }catch(e){ return defaults; }
  }
  function saveSettings(s){ localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }

  function uid(){ return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function formatDateForMsg(iso){
    if(!iso) return "";
    var d = new Date(iso + "T00:00:00");
    if(isNaN(d)) return iso;
    return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
  }
  function formatMonthForMsg(monthVal){
    if(!monthVal) return "";
    var parts = monthVal.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1])-1, 1);
    if(isNaN(d)) return monthVal;
    return d.toLocaleDateString('en-IN', {month:'long', year:'numeric'});
  }
  function inr(n){
    n = Number(n) || 0;
    return "₹" + n.toLocaleString('en-IN');
  }
  function digitsOnly(s){ return (s||"").replace(/\D/g,""); }
  function waNumber(mobile){
    var d = digitsOnly(mobile);
    if(d.length === 10) return "91" + d;
    if(d.length === 12 && d.startsWith("91")) return d;
    return d;
  }

/* ---------------- shared formatting/escaping helpers ---------------- */
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

/* decode a Tally-exported JSON file (handles UTF-16LE/BE with BOM) */
  function decodeFileText(arrayBuffer){
    var bytes = new Uint8Array(arrayBuffer);
    var text;
    if(bytes[0] === 0xFF && bytes[1] === 0xFE){
      text = new TextDecoder('utf-16le').decode(arrayBuffer);
    }else if(bytes[0] === 0xFE && bytes[1] === 0xFF){
      text = new TextDecoder('utf-16be').decode(arrayBuffer);
    }else{
      text = new TextDecoder('utf-8').decode(arrayBuffer);
    }
    if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text;
  }

  function normalizeName(s){ return (s||"").trim().toLowerCase().replace(/\s+/g,' '); }
