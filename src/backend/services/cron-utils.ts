/**
 * @fileoverview Minimal 5-field cron parser for runtime-mutable schedules.
 *
 * We deliberately avoid a heavy npm dependency (cron-parser is ~30KB minified)
 * because the Workers bundle should stay lean. This implementation supports the
 * five most common cron primitives:
 *
 *   - "*" wildcard
 *   - exact integer (e.g. "14")
 *   - comma list (e.g. "0,15,30,45")
 *   - range (e.g. "1-5")
 *   - step (e.g. "* / 15" or "0-30 / 5")
 *
 * Fields, in order: minute (0-59), hour (0-23), day-of-month (1-31),
 * month (1-12), day-of-week (0-7; 0 and 7 = Sunday).
 *
 * Day-of-month and day-of-week are OR'd when both are restricted, matching the
 * traditional Vixie cron behaviour used by Cloudflare's own cron parser.
 */

type FieldSpec = {
  min: number;
  max: number;
  allowed: Set<number>;
  isStar: boolean;
};

function parseField(raw: string, min: number, max: number): FieldSpec {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Empty cron field");
  }

  const allowed = new Set<number>();
  const segments = trimmed.split(",");

  for (const segment of segments) {
    const [rangePart, stepPart] = segment.split("/");
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid step "${stepPart}" in cron field`);
    }

    let from = min;
    let to = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [fromStr, toStr] = rangePart.split("-");
        from = Number.parseInt(fromStr, 10);
        to = Number.parseInt(toStr, 10);
      } else {
        from = Number.parseInt(rangePart, 10);
        to = from;
      }
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from < min ||
        to > max ||
        from > to
      ) {
        throw new Error(`Invalid range "${rangePart}" in cron field`);
      }
    }

    for (let value = from; value <= to; value += step) {
      allowed.add(value);
    }
  }

  return {
    min,
    max,
    allowed,
    isStar: trimmed === "*" || allowed.size === max - min + 1,
  };
}

type ParsedCron = {
  minute: FieldSpec;
  hour: FieldSpec;
  dayOfMonth: FieldSpec;
  month: FieldSpec;
  dayOfWeek: FieldSpec;
};

function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Cron expression must have exactly 5 fields, got ${parts.length}: "${expression}"`,
    );
  }
  const dayOfWeek = parseField(
    // Normalise Sunday alias 7 → 0 by clamping into the 0-6 range.
    parts[4].replace(/\b7\b/g, "0"),
    0,
    6,
  );
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek,
  };
}

export function isValidCronExpression(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the next UTC Date at which the cron expression fires, strictly AFTER
 * the supplied `from` timestamp. Throws on invalid expressions.
 *
 * Walks forward minute-by-minute up to a 1-year safety horizon. For the cron
 * expressions we support (sub-hour cadence, daily, weekly) this terminates in
 * at most a few thousand iterations — well within the Workers CPU budget.
 */
export function computeNextRunAt(expression: string, from: Date): Date {
  const cron = parseCron(expression);

  // Start at the next whole minute after `from`.
  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Safety horizon: 1 year of minutes.
  const horizon = 60 * 24 * 366;

  for (let i = 0; i < horizon; i += 1) {
    if (matches(cron, candidate)) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`Cron "${expression}" did not match within a 1-year horizon`);
}

function matches(cron: ParsedCron, when: Date): boolean {
  const minute = when.getUTCMinutes();
  const hour = when.getUTCHours();
  const dayOfMonth = when.getUTCDate();
  const month = when.getUTCMonth() + 1;
  const dayOfWeek = when.getUTCDay();

  if (!cron.minute.allowed.has(minute)) return false;
  if (!cron.hour.allowed.has(hour)) return false;
  if (!cron.month.allowed.has(month)) return false;

  // Vixie semantics: if BOTH day-of-month and day-of-week are restricted, OR them.
  const dayOfMonthRestricted = !cron.dayOfMonth.isStar;
  const dayOfWeekRestricted = !cron.dayOfWeek.isStar;

  if (dayOfMonthRestricted && dayOfWeekRestricted) {
    return (
      cron.dayOfMonth.allowed.has(dayOfMonth) || cron.dayOfWeek.allowed.has(dayOfWeek)
    );
  }
  if (dayOfMonthRestricted) return cron.dayOfMonth.allowed.has(dayOfMonth);
  if (dayOfWeekRestricted) return cron.dayOfWeek.allowed.has(dayOfWeek);
  return true;
}
