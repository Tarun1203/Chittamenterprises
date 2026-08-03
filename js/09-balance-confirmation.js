"use strict";

/* Balance Confirmation template. */

pickers['bc-picker'] = buildPicker('bc-picker');

bindTotal('bc-eb','bc-cb','bc-total');

document.getElementById('bc-date').value = todayISO();
document.getElementById('bc-month').value = todayISO().slice(0,7);

  function generateBalanceConfirmation(){
    var c = requireCustomer('bc-picker'); if(!c) return null;
    var s = getSettings();
    var month = formatMonthForMsg(document.getElementById('bc-month').value);
    var date = formatDateForMsg(document.getElementById('bc-date').value);
    var eb = Number(document.getElementById('bc-eb').value)||0;
    var cb = Number(document.getElementById('bc-cb').value)||0;
    var total = eb + cb;
    return "📋 *Balance Confirmation – " + s.businessName + "*\n\n" +
      "Dear " + c.name + ",\n\n" +
      "As per our records, your month closing balance for *" + month + "* (as on " + date + ") is:\n\n" +
      s.businessName + " A/C: " + inr(eb) + "\n" +
      "Cash A/C: " + inr(cb) + "\n" +
      "*Total Outstanding: " + inr(total) + "*\n\n" +
      "Kindly confirm if this matches your records. Please let us know of any discrepancy.\n\n" +
      "Regards,\n" + s.businessName;
  }


generators['balance-confirmation'] = {fn: generateBalanceConfirmation, previewId: 'bc-preview'};
