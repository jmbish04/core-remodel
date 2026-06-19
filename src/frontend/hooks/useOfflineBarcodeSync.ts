import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Offline barcode scan queue with auto-sync.
 *
 * Stores scanned barcodes/images in localStorage when offline.
 * Auto-syncs via the `online` event listener when connectivity returns.
 */

const STORAGE_KEY = "showroom_offline_scan_queue";

interface QueuedScan {
  id: string;
  timestamp: number;
  barcodeValue?: string;
  image?: string; // base64 data URL
  storeId?: number;
}

interface ScanResult {
  success: boolean;
  scanLogId?: number;
  matchType?: "barcode" | "ai_vision" | "failed";
  extractionStatus?: string;
  product?: { matchedId?: number; createdId?: number } | null;
}

export function useOfflineBarcodeSync() {
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const syncingRef = useRef(false);

  // Load queue from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setQueue(JSON.parse(stored));
      }
    } catch {
      // localStorage might not be available
    }
  }, []);

  // Persist queue to localStorage on changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch {
      // Silent fail
    }
  }, [queue]);

  // Online/offline listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when connectivity returns
      syncQueue();
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  /**
   * Enqueue a scan — if online, push immediately. If offline, queue it.
   */
  const enqueueScan = useCallback(
    async (scan: Omit<QueuedScan, "id" | "timestamp">): Promise<ScanResult | null> => {
      const entry: QueuedScan = {
        ...scan,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };

      if (navigator.onLine) {
        // Try immediate push
        try {
          const result = await pushScan(entry);
          return result;
        } catch {
          // Failed — queue it
          setQueue((prev) => [...prev, entry]);
          return null;
        }
      } else {
        // Offline — queue
        setQueue((prev) => [...prev, entry]);
        return null;
      }
    },
    []
  );

  /**
   * Push a single scan to the API.
   */
  async function pushScan(scan: QueuedScan): Promise<ScanResult> {
    const res = await fetch("/api/showroom-stores/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcodeValue: scan.barcodeValue,
        image: scan.image,
        storeId: scan.storeId,
      }),
    });

    if (!res.ok) throw new Error(`Scan API returned ${res.status}`);
    return res.json();
  }

  /**
   * Sync the entire queue — push each scan and remove on success.
   */
  const syncQueue = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const currentQueue = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? "[]"
      ) as QueuedScan[];

      const remaining: QueuedScan[] = [];

      for (const scan of currentQueue) {
        try {
          await pushScan(scan);
          // Success — don't keep in queue
        } catch {
          // Failed — keep in queue for retry
          remaining.push(scan);
        }
      }

      setQueue(remaining);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  /**
   * Clear the queue (manual user action).
   */
  const clearQueue = useCallback(() => {
    setQueue([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Silent
    }
  }, []);

  return {
    queue,
    queueLength: queue.length,
    isOnline,
    isSyncing,
    enqueueScan,
    syncQueue,
    clearQueue,
  };
}
