"use strict";

/* Payment Reminder template (also covers what used to be a separate
   Outstanding Reminder template -- merged into one). */

pickers['pr-picker'] = buildPicker('pr-picker');

bindTotal('pr-eb','pr-cb','pr-total');

document.getElementById('pr-date').value = todayISO();

  function onlyDefaultOrAll(list){
    var def = list.filter(function(x){ return x.isDefault; });
    return def.length ? def : list;
  }

  function pendingDaysLabel(days){
    days = Number(days)||0;
    var label = days + " Day" + (days === 1 ? "" : "s");
    var years = Math.floor(days/365);
    if(years >= 1) label += " (" + years + " Year" + (years > 1 ? "s" : "") + ")";
    return label;
  }

  function generatePaymentReminder(){
    var c = requireCustomer('pr-picker'); if(!c) return null;
    var s = getSettings();
    var date = formatDateForMsg(document.getElementById('pr-date').value);
    var eb = Number(document.getElementById('pr-eb').value)||0;
    var ed = Number(document.getElementById('pr-ed').value)||0;
    var cb = Number(document.getElementById('pr-cb').value)||0;
    var cd = Number(document.getElementById('pr-cd').value)||0;
    var total = eb + cb;
    var signOff = s.businessName;
    var msg = "💳 *Payment Reminder*\n" +
      "*Namaste Anna/Sir* 🙏\n" +
      "As per our records, the following amount is pending as on *" + date + "*.\n\n" +
      "🏢 *" + s.businessName + "*\n" +
      "💰 *Outstanding:* *" + inr(eb) + "*\n" +
      "📅 *Pending:* *" + pendingDaysLabel(ed) + "*\n\n" +
      "💵 *Cash*\n" +
      "💰 *Outstanding:* *" + inr(cb) + "*\n" +
      "📅 *Pending:* *" + pendingDaysLabel(cd) + "*\n\n" +
      "🔹 *Total Outstanding:* " + inr(total) + "\n\n" +
      "Kindly clear the payment at the earliest. We are currently placing orders for the upcoming season, and your timely payment will help us ensure uninterrupted supply and better service.\n\n";
    if(s.upiList && s.upiList.length){
      var upiSorted = onlyDefaultOrAll(s.upiList);
      msg += "📲 *UPI (GPay/PhonePe):*\n" + upiSorted.map(function(u){
        return u.upiId + (u.payeeName ? " – " + u.payeeName : "");
      }).join("\n") + "\n\n";
    }
    if(s.bankList && s.bankList.length){
      var bankSorted = onlyDefaultOrAll(s.bankList);
      bankSorted.forEach(function(b, i){
        var heading = "🏦 *Bank Account Details" + (bankSorted.length > 1 ? " " + (i+1) : "") + "*";
        msg += heading + "\n" + s.businessName + (b.label ? " (" + b.label + ")" : "") + "\n" +
          (b.accountNo ? "A/C No.: " + b.accountNo + " (Current A/C)\n" : "") +
          (b.ifsc ? "IFSC: " + b.ifsc + "\n" : "") +
          (b.bankBranch ? b.bankBranch + "\n" : "") + "\n";
      });
    }
    msg += "Thank you for your continued support. 🙏\n" + signOff;
    return msg;
  }

generators['payment-reminder'] = {fn: generatePaymentReminder, previewId: 'pr-preview'};
