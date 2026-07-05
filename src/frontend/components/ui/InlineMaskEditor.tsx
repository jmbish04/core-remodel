import React from "react";
import FilerobotImageEditor, { TABS, TOOLS } from "react-filerobot-image-editor";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function getPixelDiffMask(originalUrl: string, editedBase64: string): Promise<string> {
  return new Promise((resolve) => {
    const imgOrig = new window.Image();
    const imgEdit = new window.Image();
    imgOrig.crossOrigin = "anonymous";
    imgEdit.crossOrigin = "anonymous";

    let loadedCount = 0;
    const onLoaded = () => {
      loadedCount++;
      if (loadedCount === 2) {
        const canvasO = document.createElement("canvas");
        const canvasE = document.createElement("canvas");
        const canvasM = document.createElement("canvas");

        const w = imgOrig.naturalWidth || imgOrig.width;
        const h = imgOrig.naturalHeight || imgOrig.height;

        canvasO.width = w;
        canvasO.height = h;
        canvasE.width = w;
        canvasE.height = h;
        canvasM.width = w;
        canvasM.height = h;

        const ctxO = canvasO.getContext("2d");
        const ctxE = canvasE.getContext("2d");
        const ctxM = canvasM.getContext("2d");

        if (ctxO && ctxE && ctxM) {
          ctxO.drawImage(imgOrig, 0, 0, w, h);
          ctxE.drawImage(imgEdit, 0, 0, w, h);

          const dataO = ctxO.getImageData(0, 0, w, h);
          const dataE = ctxE.getImageData(0, 0, w, h);
          const dataM = ctxM.createImageData(w, h);

          const len = dataO.data.length;
          for (let i = 0; i < len; i += 4) {
            const rDiff = Math.abs(dataO.data[i] - dataE.data[i]);
            const gDiff = Math.abs(dataO.data[i + 1] - dataE.data[i + 1]);
            const bDiff = Math.abs(dataO.data[i + 2] - dataE.data[i + 2]);
            const aDiff = Math.abs(dataO.data[i + 3] - dataE.data[i + 3]);

            if (rDiff > 15 || gDiff > 15 || bDiff > 15 || aDiff > 15) {
              dataM.data[i] = 255;   // R
              dataM.data[i + 1] = 255; // G
              dataM.data[i + 2] = 255; // B
              dataM.data[i + 3] = 255; // A (solid white)
            } else {
              dataM.data[i] = 0;     // R
              dataM.data[i + 1] = 0;   // G
              dataM.data[i + 2] = 0;   // B
              dataM.data[i + 3] = 255; // A (solid black)
            }
          }
          ctxM.putImageData(dataM, 0, 0);
          resolve(canvasM.toDataURL("image/png"));
        } else {
          resolve("");
        }
      }
    };

    imgOrig.onload = onLoaded;
    imgEdit.onload = onLoaded;
    imgOrig.onerror = () => resolve("");
    imgEdit.onerror = () => resolve("");

    imgOrig.src = originalUrl;
    imgEdit.src = editedBase64;
  });
}

export interface InlineMaskEditorProps {
  imageUrl: string;
  onChange: (maskBase64: string | null) => void;
  height?: number | string;
  className?: string;
}

export function InlineMaskEditor({
  imageUrl,
  onChange,
  height = 540,
  className,
}: InlineMaskEditorProps) {
  const handleSave = async (savedImageObject: any) => {
    const editedBase64 = savedImageObject.imageBase64;
    if (!editedBase64) return;

    toast.info("Calculating drawing mask...");
    const mask = await getPixelDiffMask(imageUrl, editedBase64);
    if (mask) {
      toast.success("Mask calculated! Ready to refine.");
      onChange(mask);
    } else {
      toast.error("Failed to generate mask from drawing");
    }
  };

  const containerHeight = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      style={{ height: containerHeight }}
      className={cn(
        "relative w-full rounded-lg border border-border/40 overflow-hidden bg-zinc-950",
        className
      )}
    >
      <FilerobotImageEditor
        source={imageUrl}
        onSave={handleSave}
        tabsIds={[TABS.ADJUST, TABS.ANNOTATE]}
        defaultTabId={TABS.ANNOTATE}
        defaultToolId={TOOLS.PEN}
        annotationsCommon={{
          fill: "#ff0000",
          stroke: "#ff0000",
          strokeWidth: 20,
        }}
        Text={{ text: "Mask Area" }}
        closeAfterSave={false}
        avoidChangesNotSavedAlertOnLeave={true}
        theme={{
          palette: {
            "bg-secondary": "#18181b",
            "bg-primary": "#09090b",
            "bg-primary-active": "#27272a",
            "accent-primary": "#a855f7",
            "accent-primary-active": "#c084fc",
            "borders-secondary": "#27272a",
            "borders-primary": "#3f3f46",
          },
        }}
        {...({} as any)}
      />
    </div>
  );
}

export default InlineMaskEditor;
