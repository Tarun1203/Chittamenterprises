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
