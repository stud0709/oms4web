/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// This line is required for Vite to inject the list of files to cache
declare let self: ServiceWorkerGlobalScope;
declare const __WB_MANIFEST: any[];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

precacheAndRoute(__WB_MANIFEST);

//Handle SPA navigation
const base = import.meta.env.BASE_URL || '/';
const indexUrl = `${base}index.html`//.replace(/\/+/g, '/'); // Ensure no double slashes

try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL(indexUrl)));
} catch (error) {
  console.error('Workbox NavigationRoute error:', error);
}
