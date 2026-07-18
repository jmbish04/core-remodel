/**
 * @fileoverview Shared sizing for the showroom viewport's touch-first dialogs.
 *
 * The hours, links, upload-photo and categories modals are all opened from a
 * Tesla touchscreen, where the stock `max-w-lg` dialog leaves controls too small
 * and too close together to hit while parked at a showroom. They all render at
 * ~80% of the viewport instead, and they share this constant so they cannot
 * drift apart — "same size as the hours modal" is the spec for all of them.
 *
 * Two overrides are load-bearing against `DialogContent`'s own base classes
 * (which twMerge resolves last-wins):
 *   - `max-w-none sm:max-w-none` — the default caps at `sm:max-w-sm`, which
 *     would otherwise clamp `w-[80vw]` straight back down.
 *   - `flex flex-col` — the default is `grid`, and a grid child can't `flex-1`
 *     into the remaining height, so the body wouldn't scroll inside the shell.
 */
export const TOUCH_DIALOG_CLASS =
  "flex h-[80vh] max-h-[80vh] w-[80vw] max-w-none flex-col gap-4 overflow-hidden p-5 sm:max-w-none";

/** Scroll container for a touch dialog's body — fills the fixed-height shell. */
export const TOUCH_DIALOG_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto pr-1";
