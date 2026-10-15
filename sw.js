// Pole2 찬양팀 — 서비스 워커 (앱 설치 · 푸시 알림)
// 화면은 늘 서버에서 새로 받아요 (오프라인 캐시 없음)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data?.text() || "Pole2 찬양팀" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Pole2 찬양팀", {
    body: d.body || "",
    icon: "/assets/icon-192.png",
    badge: "/assets/badge-72.png",
    tag: d.tag || undefined,
    data: { url: d.url || "/me.html#alerts" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/me.html#alerts", self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) {
        await c.focus();
        if ("navigate" in c) return c.navigate(url);
        return;
      }
    }
    return self.clients.openWindow(url);
  })());
});
