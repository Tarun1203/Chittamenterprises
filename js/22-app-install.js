"use strict";

/* Installable app: registers the service worker (sw.js) so the app opens
   offline, and shows an "Install app" button in the sidebar when the
   browser offers installation (Chrome on Android / desktop). */

  if('serviceWorker' in navigator && location.protocol !== 'file:'){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(){});
    });
  }

  var installPrompt = null;
  var installBtn = document.getElementById('btnInstallApp');

  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    installPrompt = e;
    installBtn.style.display = '';
  });

  installBtn.addEventListener('click', function(){
    if(!installPrompt){
      showToast('Open the browser menu (⋮) and choose "Install app" or "Add to Home screen".');
      return;
    }
    installPrompt.prompt();
    installPrompt.userChoice.then(function(choice){
      if(choice.outcome === 'accepted' && typeof dbLogEvent === 'function') dbLogEvent('app-installed', {});
      installPrompt = null;
      installBtn.style.display = 'none';
    });
  });

  window.addEventListener('appinstalled', function(){ installBtn.style.display = 'none'; });

  /* ---------------- version + last updated ---------------- */
  var versionLine = 'Version ' + APP_VERSION + ' · Updated ' + formatDateForMsg(APP_UPDATED);
  document.getElementById('appVersionSide').textContent = versionLine;
  document.getElementById('appVersionSheet').textContent = versionLine;
  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  document.getElementById('appAbout').innerHTML =
    '<div><span>Version</span><strong>' + escapeHtml(APP_VERSION) + '</strong></div>' +
    '<div><span>Last updated</span><strong>' + escapeHtml(formatDateForMsg(APP_UPDATED)) + '</strong></div>' +
    '<div><span>Running as</span><strong>' + (standalone ? 'Installed app' : 'Website') + '</strong></div>' +
    (window.FIREBASE_CONFIG ? '<div><span>Database</span><strong>' + escapeHtml(FIREBASE_CONFIG.projectId) + '</strong></div>' : '');

  // tell each device once that it is now on a new version
  try{
    var seen = localStorage.getItem('cem_seen_version');
    if(seen && seen !== APP_VERSION){
      setTimeout(function(){ showToast('App updated to version ' + APP_VERSION + ' (' + formatDateForMsg(APP_UPDATED) + ')'); }, 1500);
    }
    localStorage.setItem('cem_seen_version', APP_VERSION);
  }catch(e){}

  /* ---------------- new version available ---------------- */
  // A window left open (the Windows app in the tray, a phone app in the
  // background) never reloads by itself, so check the live version every
  // 10 minutes and whenever the app comes back to the front.
  var lastUpdateCheck = 0;
  function checkForUpdate(){
    if(location.protocol === 'file:' || Date.now() - lastUpdateCheck < 60000) return;
    lastUpdateCheck = Date.now();
    fetch('js/01-core.js?check=' + Date.now(), {cache: 'no-store'})
      .then(function(r){ return r.ok ? r.text() : ''; })
      .then(function(t){
        var m = t.match(/APP_VERSION = '([0-9.]+)'/);
        if(m && m[1] !== APP_VERSION) showUpdateBar(m[1]);
      })
      .catch(function(){});
  }
  function showUpdateBar(version){
    var bar = document.getElementById('updateBar');
    bar.querySelector('.ub-text').textContent = 'Version ' + version + ' is ready';
    bar.classList.add('show');
  }
  document.getElementById('updateBarReload').addEventListener('click', function(){ location.reload(); });
  document.getElementById('updateBarLater').addEventListener('click', function(){ document.getElementById('updateBar').classList.remove('show'); });
  setInterval(checkForUpdate, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') checkForUpdate(); });
  window.addEventListener('focus', checkForUpdate);
  setTimeout(checkForUpdate, 8000);
