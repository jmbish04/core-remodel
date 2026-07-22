/**
 * @fileoverview Browser chalk shim with truecolor support, for ink-web.
 *
 * ## Why this exists
 *
 * `ink-web` ships its own chalk shim and aliases `chalk` to it. That shim covers
 * the 16 named ANSI colors and the modifiers, and nothing else — it has no
 * `hex`, `rgb`, `ansi256`, or any of their `bg` variants.
 *
 * Ink resolves a color prop by calling chalk directly: a `#rrggbb` value becomes
 * `chalk.hex(color)(text)`. Any themed component therefore dies on
 * `TypeError: chalk.hex is not a function` — and termcn's theme is entirely hex,
 * so every one of its components fails to render, with the failure surfacing as
 * "[ink-web] Error initializing Yoga or rendering Ink" rather than as anything
 * pointing at color.
 *
 * This replaces that shim: same ANSI-escape approach, plus the truecolor and
 * 256-color methods, and chaining (`chalk.bold.hex("#fff")(text)`) since Ink and
 * component code both use it.
 *
 * Emitting escape codes rather than resolving to CSS is the whole point — the
 * output goes to an xterm.js terminal, which is what interprets them.
 */

type Pair = readonly [open: string, close: string];

/** `[openCode, closeCode]` for every named style, as chalk defines them. */
const NAMED: Record<string, readonly [number, number]> = {
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  overline: [53, 55],
  inverse: [7, 27],
  hidden: [8, 28],
  strikethrough: [9, 29],

  black: [30, 39],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
  grey: [90, 39],
  blackBright: [90, 39],
  redBright: [91, 39],
  greenBright: [92, 39],
  yellowBright: [93, 39],
  blueBright: [94, 39],
  magentaBright: [95, 39],
  cyanBright: [96, 39],
  whiteBright: [97, 39],

  bgBlack: [40, 49],
  bgRed: [41, 49],
  bgGreen: [42, 49],
  bgYellow: [43, 49],
  bgBlue: [44, 49],
  bgMagenta: [45, 49],
  bgCyan: [46, 49],
  bgWhite: [47, 49],
  bgGray: [100, 49],
  bgGrey: [100, 49],
  bgBlackBright: [100, 49],
  bgRedBright: [101, 49],
  bgGreenBright: [102, 49],
  bgYellowBright: [103, 49],
  bgBlueBright: [104, 49],
  bgMagentaBright: [105, 49],
  bgCyanBright: [106, 49],
  bgWhiteBright: [107, 49],
};

const esc = (code: string) => `\u001b[${code}m`;

/** `#abc` / `#aabbcc` / `aabbcc` → `[r, g, b]`. Invalid input falls back to white. */
function hexToRgb(value: string): [number, number, number] {
  let hex = value.replace(/^#/, "").trim();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return [255, 255, 255];
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export interface ChalkStyler {
  (text: string): string;
  hex(color: string): ChalkStyler;
  bgHex(color: string): ChalkStyler;
  rgb(r: number, g: number, b: number): ChalkStyler;
  bgRgb(r: number, g: number, b: number): ChalkStyler;
  ansi256(code: number): ChalkStyler;
  bgAnsi256(code: number): ChalkStyler;
  [style: string]: unknown;
}

/**
 * Build a styler carrying `pairs` so far.
 *
 * Every access returns a NEW styler with one more pair rather than mutating a
 * shared one, so `chalk.red` and `chalk.bold.red` cannot contaminate each other
 * — the bug that makes hand-rolled chalk clones produce colors that leak between
 * unrelated call sites.
 */
function createStyler(pairs: Pair[]): ChalkStyler {
  const apply = (text: string): string => {
    let out = String(text);
    // Innermost first, so the outermost style closes last.
    for (let i = pairs.length - 1; i >= 0; i--) {
      const [open, close] = pairs[i];
      out = `${open}${out}${close}`;
    }
    return out;
  };

  const extend = (pair: Pair) => createStyler([...pairs, pair]);

  const styler = apply as ChalkStyler;

  styler.hex = (color) => {
    const [r, g, b] = hexToRgb(color);
    return extend([esc(`38;2;${r};${g};${b}`), esc("39")]);
  };
  styler.bgHex = (color) => {
    const [r, g, b] = hexToRgb(color);
    return extend([esc(`48;2;${r};${g};${b}`), esc("49")]);
  };
  styler.rgb = (r, g, b) => extend([esc(`38;2;${r};${g};${b}`), esc("39")]);
  styler.bgRgb = (r, g, b) => extend([esc(`48;2;${r};${g};${b}`), esc("49")]);
  styler.ansi256 = (code) => extend([esc(`38;5;${code}`), esc("39")]);
  styler.bgAnsi256 = (code) => extend([esc(`48;5;${code}`), esc("49")]);

  for (const [name, [open, close]] of Object.entries(NAMED)) {
    Object.defineProperty(styler, name, {
      configurable: true,
      get: () => extend([esc(String(open)), esc(String(close))]),
    });
  }

  return styler;
}

const chalk = createStyler([]);

// Truecolor, unconditionally. Detection is meaningless here: the target is
// always xterm.js, which supports 24-bit color, and ink-web has already shimmed
// away the environment chalk would otherwise sniff.
chalk.level = 3;
chalk.supportsColor = { level: 3, hasBasic: true, has256: true, has16m: true };

export { chalk };
export type { ChalkStyler as Chalk };
export default chalk;
