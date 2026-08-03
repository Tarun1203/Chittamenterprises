"use strict";

/* Runs last, after every other file has registered its pickers,
   generators, and event handlers. */

  /* ---------------- init ---------------- */
  loadSettingsIntoForm();
  populatePaymentModeSelect();
  refreshBusinessLabels();
  showView('dashboard');
