import { Moon, Palette, Sun } from "lucide-react";
import React, { useCallback } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { DesignConfig } from "./types";

interface DesignConfigPanelProps {
  value: DesignConfig;
  onChange: (config: DesignConfig) => void;
  className?: string;
}

const FLOOR_OPTIONS = [
  "White Oak",
  "Walnut",
  "Polished Concrete",
  "Porcelain Tile",
  "Marble",
  "Herringbone Wood",
];

const COUNTER_OPTIONS = [
  "Carrara Marble",
  "Quartz",
  "Soapstone",
  "Butcher Block",
  "Black Granite",
  "Concrete",
];

export const DEFAULT_DESIGN_CONFIG: DesignConfig = {
  floorMaterial: "White Oak",
  wallColor: "#F5F5F4",
  cabinetColor: "#3B3B3B",
  counterMaterial: "Carrara Marble",
  fixtures: "Brushed Brass",
  lighting: "day",
};

/**
 * DesignConfigPanel — a compact form for the staged-render design config:
 * floor / wall paint / cabinet / counter / fixtures + a day/night lighting
 * toggle. Calls onChange with the full DesignConfig on every edit.
 */
export function DesignConfigPanel({
  value,
  onChange,
  className,
}: DesignConfigPanelProps) {
  const patch = useCallback(
    (next: Partial<DesignConfig>) => {
      onChange({ ...value, ...next });
    },
    [onChange, value],
  );

  return (
    <div className={cn("space-y-4 rounded-xl bg-card p-4 ring-1 ring-border/40", className)}>
      <div className="flex items-center gap-2">
        <Palette className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Design Configuration</h3>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="design-floor" className="text-xs text-muted-foreground">
            Floor Material
          </Label>
          <Select
            value={value.floorMaterial}
            onValueChange={(floorMaterial) =>
              patch({ floorMaterial: floorMaterial ?? value.floorMaterial })
            }
          >
            <SelectTrigger id="design-floor" className="w-full">
              <SelectValue placeholder="Select floor" />
            </SelectTrigger>
            <SelectContent>
              {FLOOR_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="design-counter" className="text-xs text-muted-foreground">
            Counter Material
          </Label>
          <Select
            value={value.counterMaterial}
            onValueChange={(counterMaterial) =>
              patch({ counterMaterial: counterMaterial ?? value.counterMaterial })
            }
          >
            <SelectTrigger id="design-counter" className="w-full">
              <SelectValue placeholder="Select counter" />
            </SelectTrigger>
            <SelectContent>
              {COUNTER_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="design-wall" className="text-xs text-muted-foreground">
            Wall Paint
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.wallColor}
              onChange={(event) => patch({ wallColor: event.target.value })}
              aria-label="Wall paint color"
              className="size-9 shrink-0 cursor-pointer rounded-md border border-border/50 bg-transparent p-0.5"
            />
            <Input
              id="design-wall"
              value={value.wallColor}
              onChange={(event) => patch({ wallColor: event.target.value })}
              placeholder="#F5F5F4"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="design-cabinet" className="text-xs text-muted-foreground">
            Cabinet Color
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.cabinetColor}
              onChange={(event) => patch({ cabinetColor: event.target.value })}
              aria-label="Cabinet color"
              className="size-9 shrink-0 cursor-pointer rounded-md border border-border/50 bg-transparent p-0.5"
            />
            <Input
              id="design-cabinet"
              value={value.cabinetColor}
              onChange={(event) => patch({ cabinetColor: event.target.value })}
              placeholder="#3B3B3B"
            />
          </div>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="design-fixtures" className="text-xs text-muted-foreground">
            Fixtures
          </Label>
          <Input
            id="design-fixtures"
            value={value.fixtures}
            onChange={(event) => patch({ fixtures: event.target.value })}
            placeholder="Brushed brass faucet, matte black hardware..."
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Lighting</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch({ lighting: "day" })}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-border/40 transition",
              value.lighting === "day"
                ? "bg-primary/10 text-foreground ring-2 ring-primary"
                : "bg-background text-muted-foreground hover:bg-muted/30",
            )}
          >
            <Sun className="size-4" />
            Day
          </button>
          <button
            type="button"
            onClick={() => patch({ lighting: "night" })}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-border/40 transition",
              value.lighting === "night"
                ? "bg-primary/10 text-foreground ring-2 ring-primary"
                : "bg-background text-muted-foreground hover:bg-muted/30",
            )}
          >
            <Moon className="size-4" />
            Night
          </button>
        </div>
      </div>
    </div>
  );
}

export default DesignConfigPanel;
