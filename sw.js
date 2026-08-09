// Minimal service worker — exists only so browsers consider this site
// "installable" (Add to Home Screen / desktop install). It does not cache
// anything, so affiliates and clients always get the latest live page,
// never a stale cached version.
self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event){
  event.respondWith(fetch(event.request));
});
