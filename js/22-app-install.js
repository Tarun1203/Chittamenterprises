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
