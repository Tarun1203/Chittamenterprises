"use strict";

/* Payment Updated template. */

pickers['pu-picker'] = buildPicker('pu-picker');

  function updatePaymentUpdatedTotals(){
    var eprev = Number(document.getElementById('pu-eprev').value)||0;
    var eamt = Number(document.getElementById('pu-eamt').value)||0;
    var cprev = Number(document.getElementById('pu-cprev').value)||0;
    var camt = Number(document.getElementById('pu-camt').value)||0;
    var efinal = eprev - eamt;
    var cfinal = cprev - camt;
    document.getElementById('pu-efinal').textContent = inr(efinal);
    document.getElementById('pu-cfinal').textContent = inr(cfinal);
    document.getElementById('pu-total').textContent = inr(efinal + cfinal);
  }
  ['pu-eprev','pu-eamt','pu-cprev','pu-camt'].forEach(function(id){
    document.getElementById(id).addEventListener('input', updatePaymentUpdatedTotals);
  });


document.getElementById('pu-date').value = todayISO();

  function generatePaymentUpdated(){
    var c = requireCustomer('pu-picker'); if(!c) return null;
    var s = getSettings();
    var mode = document.getElementById('pu-mode').value || '—';
    var date = formatDateForMsg(document.getElementById('pu-date').value);
    var eprev = Number(document.getElementById('pu-eprev').value)||0;
    var eamt = Number(document.getElementById('pu-eamt').value)||0;
    var cprev = Number(document.getElementById('pu-cprev').value)||0;
    var camt = Number(document.getElementById('pu-camt').value)||0;
    var efinal = eprev - eamt;
    var cfinal = cprev - camt;
    var total = efinal + cfinal;
    var totalReceived = eamt + camt;
    var name = s.businessName;

    var creditLine;
    if(eamt > 0 && camt > 0){
      creditLine = "split between your *" + name + "* account (" + inr(eamt) + ") and *Cash* account (" + inr(camt) + ")";
    }else if(camt > 0){
      creditLine = "credited to your *Cash* account";
    }else{
      creditLine = "credited to your *" + name + "* account";
    }

    var msg = "✅ *Payment Received – " + name + "*\n\n" +
      "Dear " + c.name + ",\n\n" +
      "We have received your payment of " + inr(totalReceived) + " via " + mode + " on " + date + ", " + creditLine + ". Thank you.\n\n";

    if(eamt > 0){
      msg += "📊 *" + name + " Ledger*\n" +
        "Previous Balance: " + inr(eprev) + "\n" +
        "Amount Received: " + inr(eamt) + "\n" +
        "*Final Balance: " + inr(efinal) + "*\n\n";
    }else{
      msg += name + " A/C: " + inr(efinal) + "\n";
    }
    if(camt > 0){
      msg += "📊 *Cash Ledger*\n" +
        "Previous Balance: " + inr(cprev) + "\n" +
        "Amount Received: " + inr(camt) + "\n" +
        "*Final Balance: " + inr(cfinal) + "*\n\n";
    }else{
      msg += "Cash A/C: " + inr(cfinal) + "\n\n";
    }

    msg += "*Total Outstanding: " + inr(total) + "*\n\n" +
      "Regards,\n" + name + (s.address ? "\n" + s.address : "");
    return msg;
  }

generators['payment-updated'] = {fn: generatePaymentUpdated, previewId: 'pu-preview'};
