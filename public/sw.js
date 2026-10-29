// Service worker: guarda a "casca" do app para abrir rápido e funcionar com sinal fraco.
// Os dados (login e banco) vêm do Firebase, que tem o próprio cache.
const VERSAO = 'siscautela-v4';
const CASCA = [
  './',
  'index.html',
  'css/estilo.css',
  'js/app.js',
  'js/nucleo.js',
  'js/cautela.js',
  'js/painel.js',
  'js/relatorios.js',
  'js/assinatura.js',
  'js/ponte.js',
  'js/config.js',
  'js/firebase-config.js',
  'js/viaturas-iniciais.js',
  'img/brasao-apmg.png',
  'img/brasao-esfo.png',
  'img/viaturas/furgao.webp',
  'img/viaturas/picape.webp',
  'img/viaturas/sedan.webp',
  'img/viaturas/suv.webp',
  'img/viaturas/suvGrande.webp',
  'icons/icon.svg',
  'icons/icon-192.png',
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
