/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

// This line is required for Vite to inject the list of files to cache
declare let self: ServiceWorkerGlobalScope;
declare const __WB_MANIFEST: any[];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

precacheAndRoute(__WB_MANIFEST);
