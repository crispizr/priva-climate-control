/**
 * PRIVA Climate Control - Service Worker CORRIGÉ
 */

const CACHE_NAME = 'priva-v=A2';  // ← Version changée pour forcer mise à jour
const BASE_PATH = '/priva-climate-control';

const FILES_TO_CACHE = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/styles.css`,
  `${BASE_PATH}/app.js`,
  `${BASE_PATH}/manifest.json`,
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js'
];

// Installation
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v2...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Mise en cache');
      return cache.addAll(FILES_TO_CACHE).catch(err => {
        console.error('[SW] Erreur cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activation
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v2...');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interception des requêtes - VERSION CORRIGÉE
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // NE PAS INTERCEPTER les requêtes vers des IPs locales (ESP32)
  if (url.hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    console.log('[SW] Bypass ESP32:', url.hostname);
    return; // Laisser passer sans interception
  }
  
  // NE PAS INTERCEPTER les requêtes POST
  if (event.request.method !== 'GET') {
    return;
  }
  
  // NE PAS METTRE EN CACHE les API externes (Google Sheets)
  if (url.hostname.includes('script.google.com') || 
      url.hostname.includes('docs.google.com') ||
      url.hostname.includes('allorigins.win')) {
    console.log('[SW] API request, pas de cache');
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ 
          status: 'offline',
          message: 'Mode hors-ligne - API non disponible' 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // Pour les fichiers statiques : Cache First
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        console.log('[SW] Depuis cache:', event.request.url);
        return response;
      }
      
      console.log('[SW] Depuis réseau:', event.request.url);
      return fetch(event.request).then((response) => {
        // Mettre en cache seulement si succès
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
