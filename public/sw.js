// Service worker simples: guarda a "casca" do app para abrir rápido.
// Os dados (login e banco) sempre vêm da internet.
const VERSAO = 'siscautela-v1';
const CASCA = [
  './',
  'index.html',
  'css/estilo.css',
  'js/app.js',
  'js/firebase-config.js',
  'icons/icon.svg',
  'manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Rede primeiro; se falhar, usa a cópia guardada (apenas arquivos do próprio app).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
