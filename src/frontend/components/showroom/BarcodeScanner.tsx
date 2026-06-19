import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Barcode reader interface — matches the subset of @zxing/library we use.
 * Dynamic import is used at runtime so the package is code-split.
 */
interface ZxingReader {
  decodeFromVideoElement(
    video: HTMLVideoElement,
    callback: (result: any, err: any) => void,
  ): void;
  reset(): void;
}

/**
 * Dynamically import @zxing/library at runtime.
 * Returns null if the package isn't available (graceful degradation).
 */
async function loadZxingReader(): Promise<ZxingReader | null> {
  try {
    // Dynamic import — code-split at build time
    // @ts-ignore - @zxing/library is an optional runtime dependency
    const mod = await import(/* @vite-ignore */ "@zxing/library");
    return new mod.BrowserMultiFormatReader() as ZxingReader;
  } catch {
    return null;
  }
}

/**
 * iOS-compatible barcode scanner using @zxing/library.
 *
 * Critical iOS Safari requirements:
 *   - facingMode: "environment" for rear camera
 *   - playsInline attribute on <video>
 *   - HTTPS required for camera access
 *
 * The scanner attempts real-time 1D barcode decode. If no barcode is detected
 * after 10 seconds, offers a "Capture for AI" button that sends the current
 * frame to the server-side VLM pipeline.
 */

interface BarcodeScannerProps {
  /** Called when a barcode is successfully decoded client-side. */
  onBarcodeDetected: (value: string) => void;
  /** Called when user captures an image for server-side AI processing. */
  onImageCapture: (base64DataUrl: string) => void;
  /** Optional store context for the scan. */
  storeId?: number;
}

export function BarcodeScanner({
  onBarcodeDetected,
  onImageCapture,
}: BarcodeScannerProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [showAiFallback, setShowAiFallback] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startScanning = useCallback(async () => {
    setError(null);
    setLastResult(null);
    setShowAiFallback(false);

    try {
      const reader = await loadZxingReader();
      if (!reader) {
        setError("Barcode scanner library not available. Install @zxing/library.");
        return;
      }
      readerRef.current = reader;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment", // iOS: rear camera
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Start continuous decode
      reader.decodeFromVideoElement(videoRef.current!, (result: any, _err: any) => {
        if (result) {
          const value = result.getText();
          setLastResult(value);
          setScanning(false);
          onBarcodeDetected(value);
          stopScanning();
          setOpen(false);
        }
      });

      setScanning(true);

      // After 10 seconds without a barcode, show AI fallback button
      timeoutRef.current = setTimeout(() => {
        setShowAiFallback(true);
      }, 10000);
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Camera access denied. Please allow camera access in your browser settings.");
      } else if (err.name === "NotFoundError") {
        setError("No camera found on this device.");
      } else {
        setError(`Camera error: ${err.message}`);
      }
    }
  }, [onBarcodeDetected]);

  const stopScanning = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const captureForAi = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    onImageCapture(dataUrl);
    stopScanning();
    setOpen(false);
  }, [onImageCapture, stopScanning]);

  // Cleanup on dialog close
  useEffect(() => {
    if (!open) {
      stopScanning();
    }
  }, [open, stopScanning]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              setOpen(true);
              // Small delay so dialog renders first
              setTimeout(startScanning, 300);
            }}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              />
            </svg>
            Scan Barcode
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Barcode Scanner</DialogTitle>
          </DialogHeader>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-zinc-900">
            {/* Video stream */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />

            {/* Viewfinder overlay */}
            {scanning && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-48 w-48">
                  {/* Corner markers */}
                  <div className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-amber-500" />
                  <div className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-amber-500" />
                  <div className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-amber-500" />
                  <div className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-amber-500" />
                  {/* Scanning line animation */}
                  <div className="absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-amber-500/60" />
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 p-6 text-center">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* AI Fallback */}
          {showAiFallback && scanning && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-center">
              <p className="mb-2 text-xs text-amber-200">
                No barcode detected. Capture image for AI product identification?
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={captureForAi}
                className="border-amber-500/50 text-amber-400 hover:bg-amber-500/20"
              >
                📸 Capture for AI Analysis
              </Button>
            </div>
          )}

          {/* Result */}
          {lastResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
              <p className="text-xs text-emerald-400">
                Decoded: <span className="font-mono font-bold">{lastResult}</span>
              </p>
            </div>
          )}

          {/* Hidden canvas for image capture */}
          <canvas ref={canvasRef} className="hidden" />
        </DialogContent>
      </Dialog>
    </>
  );
}
