"use strict";

/* Sidebar navigation and the dashboard view. */

  /* ---------------- navigation ---------------- */
  var views = document.querySelectorAll('.view');
  var navButtons = document.querySelectorAll('[data-view]');

  function showView(name){
    views.forEach(function(v){ v.classList.toggle('active', v.id === 'view-' + name); });
    document.querySelectorAll('.navbtn').forEach(function(b){
      b.classList.toggle('active', b.dataset.view === name);
    });
    if(name === 'customers') renderCustomerTable();
    if(name === 'products') renderProductTable();
    if(name === 'dashboard') renderDashboard();    window.scrollTo(0,0);
  }
  navButtons.forEach(function(btn){
    btn.addEventListener('click', function(){ showView(btn.dataset.view); });
  });

  /* ---------------- dashboard ---------------- */
  function renderDashboard(){
    var hr = new Date().getHours();
    var greet = hr < 12 ? "Good morning" : (hr < 17 ? "Good afternoon" : "Good evening");
    document.getElementById('dashGreeting').textContent = greet + ", " + getSettings().businessName;
    var n = getCustomers().length;
    document.getElementById('custCountLine').textContent = n + (n === 1 ? " customer on file" : " customers on file");
  }
