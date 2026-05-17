import React, { useEffect } from "react";

function getSessionId(): string {
  const key = "remodel_session_id";
  const existing = window.sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }

  const next = crypto.randomUUID();
  window.sessionStorage.setItem(key, next);
  return next;
}

function sendTrackingEvent(payload: {
  sessionId: string;
  eventType: "page_view" | "click" | "page_exit";
  path: string;
  element?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}) {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/portal/track", blob);
    return;
  }

  void fetch("/api/portal/track", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function getElementLabel(element: Element): string {
  const tracked = element.getAttribute("data-track");
  if (tracked && tracked.trim()) {
    return tracked.trim().slice(0, 140);
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim().slice(0, 140);
  }

  const text = element.textContent?.trim();
  if (text) {
    return text.slice(0, 140);
  }

  const id = element.getAttribute("id");
  if (id && id.trim()) {
    return `#${id.trim().slice(0, 120)}`;
  }

  return element.tagName.toLowerCase();
}

export function VisitorActivityTracker() {
  useEffect(() => {
    const sessionId = getSessionId();
    const startedAt = Date.now();
    let sentExit = false;

    const path = `${window.location.pathname}${window.location.search}`;
    sendTrackingEvent({
      sessionId,
      eventType: "page_view",
      path,
    });

    const clickHandler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const clickable = target.closest(
        "a,button,[role='button'],input,select,textarea,[data-track]",
      );
      if (!clickable) {
        return;
      }

      sendTrackingEvent({
        sessionId,
        eventType: "click",
        path: `${window.location.pathname}${window.location.search}`,
        element: getElementLabel(clickable),
      });
    };

    const sendExitEvent = () => {
      if (sentExit) {
        return;
      }
      sentExit = true;

      sendTrackingEvent({
        sessionId,
        eventType: "page_exit",
        path: `${window.location.pathname}${window.location.search}`,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    };

    const visibilityHandler = () => {
      if (document.visibilityState === "hidden") {
        sendExitEvent();
      }
    };

    window.addEventListener("click", clickHandler, true);
    window.addEventListener("beforeunload", sendExitEvent);
    document.addEventListener("visibilitychange", visibilityHandler);

    return () => {
      window.removeEventListener("click", clickHandler, true);
      window.removeEventListener("beforeunload", sendExitEvent);
      document.removeEventListener("visibilitychange", visibilityHandler);
      sendExitEvent();
    };
  }, []);

  return null;
}
