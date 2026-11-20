"use strict";

/* Encryption of the Firebase data with the company passphrase — the same
   format as the new app (react-app/src/lib/crypto.ts) and the Windows app,
   so all three read each other's records:
     key = PBKDF2-SHA256(passphrase, salt, iter) -> 64 bytes: AES key | HMAC key
     enc = base64( iv(16) | AES-256-CBC(deflate-raw(JSON)) | HMAC-SHA256(iv|ct) )
   It is turned on from the new app (Settings → Encryption). This app then
   asks for the passphrase once; the key is kept in this browser (shared with
   the new app, same site). Only the bookkeeping fields stay readable. */

window.ChittamCrypto = (function(){
  var DB_NAME = 'chittam-crypto', STORE = 'keys';
  var te = new TextEncoder(), td = new TextDecoder();
  var keys = null, config = null;

  function b64(u){
    var s = '';
    for(var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s){
    var bin = atob(s), u = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function pipe(data, stream){
    return new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer().then(function(b){ return new Uint8Array(b); });
  }

  async function derive(pass, salt, iter){
    var base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveBits']);
    var bits = new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter}, base, 512));
    var aes = await crypto.subtle.importKey('raw', bits.slice(0, 32), {name: 'AES-CBC'}, false, ['encrypt', 'decrypt']);
    var mac = await crypto.subtle.importKey('raw', bits.slice(32, 64), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
    return {aes: aes, mac: mac, salt: salt};
  }
  async function sealWith(k, value){
    var z = await pipe(te.encode(JSON.stringify(value)), new CompressionStream('deflate-raw'));
    var iv = crypto.getRandomValues(new Uint8Array(16));
    var ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-CBC', iv: iv}, k.aes, z));
    var body = new Uint8Array(16 + ct.length);
    body.set(iv); body.set(ct, 16);
    var mac = new Uint8Array(await crypto.subtle.sign('HMAC', k.mac, body));
    var all = new Uint8Array(body.length + 32);
    all.set(body); all.set(mac, body.length);
    return b64(all);
  }
  async function openWith(k, s){
    var all = unb64(s);
    if(all.length < 64) throw new Error('Damaged encrypted record.');
    var body = all.subarray(0, all.length - 32), mac = all.subarray(all.length - 32);
    if(!(await crypto.subtle.verify('HMAC', k.mac, mac, body))) throw new Error('This record was encrypted with a different passphrase, or was changed.');
    var z = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-CBC', iv: body.subarray(0, 16)}, k.aes, body.subarray(16)));
    return JSON.parse(td.decode(await pipe(z, new DecompressionStream('deflate-raw'))));
  }

  function idb(mode, f){
    return new Promise(function(resolve, reject){
      var open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = function(){ open.result.createObjectStore(STORE); };
      open.onerror = function(){ reject(open.error); };
      open.onsuccess = function(){
        var tx = open.result.transaction(STORE, mode);
        var req = f(tx.objectStore(STORE));
        req.onsuccess = function(){ resolve(req.result); };
        req.onerror = function(){ reject(req.error); };
        tx.oncomplete = function(){ open.result.close(); };
      };
    });
  }
  async function loadKeys(){
    if(keys) return keys;
    try{ keys = (await idb('readonly', function(s){ return s.get('main'); })) || null; }catch(e){ keys = null; }
    return keys;
  }

  var META = ['createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'at', 'by'];
  var PLAIN = {activity: META.concat(['collection', 'docId', 'action', 'source']), messages: META.concat(['type'])};

  return {
    setConfig: async function(c){ config = c && c.on ? c : null; await loadKeys(); },
    isOn: function(){ return !!config; },
    isLocked: function(){ return !!config && (!keys || keys.salt !== config.salt); },
    setBy: function(){ return config ? config.setBy || '' : ''; },
    unlock: async function(pass){
      if(!config) return true;
      var k = await derive(pass, config.salt, config.iter);
      try{ var v = await openWith(k, config.check); if(!v || v.ok !== 'chittam') return false; }catch(e){ return false; }
      keys = k;
      try{ await idb('readwrite', function(s){ return s.put(k, 'main'); }); }catch(e){}
      return true;
    },
    // a record ready to save (unchanged while encryption is off)
    sealDoc: async function(coll, data){
      if(!config) return data;
      if(!keys || keys.salt !== config.salt) throw new Error('The data is encrypted — enter the passphrase first.');
      var keep = PLAIN[coll] || META, plain = {}, secret = {};
      Object.keys(data).forEach(function(k){
        if(data[k] === undefined) return;
        (keep.indexOf(k) >= 0 ? plain : secret)[k] = data[k];
      });
      plain.enc = await sealWith(keys, secret);
      plain.encV = 1;
      return plain;
    },
    // a record as read (opened if it was encrypted)
    openDoc: async function(data){
      if(!data || typeof data.enc !== 'string') return data;
      var k = await loadKeys();
      if(!k) throw new Error('The data is encrypted — enter the passphrase first.');
      var secret = await openWith(k, data.enc);
      var rest = Object.assign({}, data);
      delete rest.enc; delete rest.encV;
      return Object.assign(rest, secret);
    }
  };
})();
