"use strict";

/* Runs last, after every other file has registered its pickers,
   generators, and event handlers. */

loadSettingsIntoForm();
populatePaymentModeSelect();
refreshBusinessLabels();
showView('dashboard');

/* Load WhatsApp Product Catalog module */
(() => {
  const s = document.createElement("script");
  s.src = "js/15-catalog.js";
  s.defer = true;
  document.head.appendChild(s);
})();
