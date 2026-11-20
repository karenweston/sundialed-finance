// Service worker: offline app shell (no data is ever cached) and phone notifications.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

// Everything is relative to wherever the app is served from (set by `base` in vite.config.ts).
const BASE = new URL(self.registration.scope).pathname;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL(BASE + "index.html")));

// Pick up new versions right away.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* not JSON: show the generic text */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Sundialed", {
      body: data.body || "Open Sundialed for details.",
      icon: BASE + "icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.includes(BASE));
      return open ? open.focus() : self.clients.openWindow(BASE);
    }),
  );
});
