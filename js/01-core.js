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

  /* ---------------- app version ---------------- */
  // bump both with every release; shown in the sidebar, the phone's More
  // menu and Settings, and announced once on each device after an update
  var APP_VERSION = '3.0';
  var APP_UPDATED = '2026-11-19';

  /* ---------------- storage helpers ---------------- */
  var LS_CUST = "cem_customers";
  var LS_PRODUCTS = "cem_products";
  var LS_SETTINGS = "cem_settings";
  var LS_ORDERS = "cem_orders";
  var LS_SERVICES = "cem_services";
  var LS_TRANSPORTS = "cem_transports";
  var LS_RECEIPTS = "cem_receipts";

  function getCustomers(){
    try{ return JSON.parse(localStorage.getItem(LS_CUST)) || []; }catch(e){ return []; }
  }
  // every save also goes to the Firebase database when it's connected (js/01b-database.js)
  function saveCustomers(list){
    var prev = getCustomers();
    localStorage.setItem(LS_CUST, JSON.stringify(list));
    if(typeof dbSaveList === 'function') dbSaveList('customers', prev, list);
  }

  function getProducts(){
    try{ return JSON.parse(localStorage.getItem(LS_PRODUCTS)) || []; }catch(e){ return []; }
  }
  function saveProducts(list){
    var prev = getProducts();
    localStorage.setItem(LS_PRODUCTS, JSON.stringify(list));
    if(typeof dbSaveList === 'function') dbSaveList('products', prev, list);
  }

  function getOrders(){
    try{ return JSON.parse(localStorage.getItem(LS_ORDERS)) || []; }catch(e){ return []; }
  }
  function saveOrders(list){
    var prev = getOrders();
    localStorage.setItem(LS_ORDERS, JSON.stringify(list));
    if(typeof dbSaveList === 'function') dbSaveList('orders', prev, list);
  }

  function getServiceJobs(){
    try{ return JSON.parse(localStorage.getItem(LS_SERVICES)) || []; }catch(e){ return []; }
  }
  function saveServiceJobs(list){
    var prev = getServiceJobs();
    localStorage.setItem(LS_SERVICES, JSON.stringify(list));
    if(typeof dbSaveList === 'function') dbSaveList('services', prev, list);
  }

  function getTransports(){
    try{ return JSON.parse(localStorage.getItem(LS_TRANSPORTS)) || []; }catch(e){ return []; }
  }
  function saveTransports(list){
    var prev = getTransports();
    localStorage.setItem(LS_TRANSPORTS, JSON.stringify(list));
    if(typeof dbSaveList === 'function') dbSaveList('transports', prev, list);
  }

  function getReceipts(){
    try{ return JSON.parse(localStorage.getItem(LS_RECEIPTS)) || []; }catch(e){ return []; }
  }
  function saveReceipts(list){
    var prev = getReceipts();
    localStorage.setItem(LS_RECEIPTS, JSON.stringify(list));
    if(typeof dbSaveList === 'function') dbSaveList('receipts', prev, list);
  }

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
  function saveSettings(s){
    var prev = getSettings();
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
    if(typeof dbSaveSettings === 'function') dbSaveSettings(prev, s);
  }

  function uid(){ return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  // local date (toISOString would give yesterday's date in India before 5:30 am)
  function todayISO(){
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
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
