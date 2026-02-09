/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { OMS_RESPONSE } from './lib/constants';

// This line is required for Vite to inject the list of files to cache
declare let self: ServiceWorkerGlobalScope;
declare const __WB_MANIFEST: any[];

precacheAndRoute(__WB_MANIFEST);

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Match the callback URL you're opening from Kotlin
  if (url.pathname.endsWith('/callback') && url.searchParams.has('data')) {
    event.respondWith(
      (async () => {
        const clientList = await self.clients.matchAll({ type: 'window' });
        // Find an existing window of the app
        const client = clientList[0]; 

        if (client) {
          // Send data to the UI
          client.postMessage({
            type: OMS_RESPONSE,
            data: url.searchParams.get('data')
          });
          
          client.focus();
          // Return 204 No Content to prevent the PWA from refreshing/navigating
          return new Response(null, { status: 204 });
        }

        // If no window is open, let the request proceed normally
        return fetch(event.request);
      })()
    );
  }
});