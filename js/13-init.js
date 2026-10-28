"use strict";

loadSettingsIntoForm();
populatePaymentModeSelect();
refreshBusinessLabels();
showView('dashboard');

(() => {
  const loadCatalog = () => {
    if (window.ChittamCatalog) {
      window.ChittamCatalog.init();
      return;
    }
    if (document.getElementById("ce-catalog-script")) return;
    const s = document.createElement("script");
    s.id = "ce-catalog-script";
    s.src = "js/15-catalog.js";
    s.defer = true;
    s.onload = () => window.ChittamCatalog?.init();
    document.head.appendChild(s);
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", loadCatalog);
  else loadCatalog();
})();
