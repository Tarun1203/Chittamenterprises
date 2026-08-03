"use strict";

/* Dispatch Confirmation template. */

pickers['dc-picker'] = buildPicker('dc-picker');

document.getElementById('dc-date').value = todayISO();

  function generateDispatchConfirmation(){
    var c = requireCustomer('dc-picker'); if(!c) return null;
    var s = getSettings();
    var date = formatDateForMsg(document.getElementById('dc-date').value);
    var invoice = document.getElementById('dc-invoice').value.trim() || '—';
    var transport = document.getElementById('dc-transport').value.trim() || '—';
    var boxes = document.getElementById('dc-boxes').value || '0';
    var items = document.getElementById('dc-items').value.trim() || '—';
    var signOff = s.businessName + (s.address ? ", " + s.address : "") + ",";
    return "🚚 *Dispatch & Delivery Confirmation*\n\n" +
      "Namaste Anna/Sir 🙏\n" +
      "Your order has been dispatched successfully.\n\n" +
      "📅 Date: " + date + "\n" +
      "🧾 Invoice No.(s): " + invoice + "\n" +
      "🚛 Transport: " + transport + "\n" +
      "📦 No. of Boxes: " + boxes + "\n" +
      "📦 No. of Items: " + items + "\n\n" +
      "Once the shipment reaches you, kindly confirm:\n" +
      "✅ Stock Received\n" +
      "✅ Quantity Verified\n" +
      "✅ Goods Received in Good Condition\n\n" +
      "If you notice any shortage, damage, or other issue, please inform us immediately so we can assist you.\n\n" +
      "Thank you for your business and continued support. 🙏\n" +
      signOff;
  }


generators['dispatch-confirmation'] = {fn: generateDispatchConfirmation, previewId: 'dc-preview'};
