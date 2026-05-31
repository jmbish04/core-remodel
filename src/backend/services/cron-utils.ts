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
 * Uses field-jumping (not minute-by-minute scanning) so even annual jobs like
 * `0 12 1 1 *` terminate in O(hundreds) of iterations rather than the
 * naive O(525,600). Each loop body either advances by at least one full minute
 * AND in the worst case skips an entire month/day/hour when a coarser field
 * mismatches — comfortably within the Workers CPU budget.
 */
export function computeNextRunAt(expression: string, from: Date): Date {
  const cron = parseCron(expression);

  // Start at the next whole minute strictly after `from`.
  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // 10-year safety horizon. We never approach this in practice — each iteration
  // skips at least one minute and often a whole hour/day/month.
  const maxIterations = 10000;

  for (let i = 0; i < maxIterations; i += 1) {
    const month = candidate.getUTCMonth() + 1;
    if (!cron.month.allowed.has(month)) {
      // Jump to the 1st of the next allowed month (rolling year if needed).
      const next = nextAllowedValue(cron.month, month);
      const year = candidate.getUTCFullYear() + (next.wrapped ? 1 : 0);
      candidate.setUTCFullYear(year, next.value - 1, 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const dayOfMonth = candidate.getUTCDate();
    const dayOfWeek = candidate.getUTCDay();
    if (!dayMatches(cron, dayOfMonth, dayOfWeek)) {
      // Advance one day at a time — month length varies, and the next-allowed
      // day-of-month value may not exist in the current month (e.g. Feb 31).
      // Date.setUTCDate handles rollover automatically.
      candidate.setUTCDate(dayOfMonth + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const hour = candidate.getUTCHours();
    if (!cron.hour.allowed.has(hour)) {
      const next = nextAllowedValue(cron.hour, hour);
      if (next.wrapped) {
        // No remaining allowed hour today — roll into the next calendar day at 00:00.
        candidate.setUTCDate(dayOfMonth + 1);
        candidate.setUTCHours(0, 0, 0, 0);
      } else {
        candidate.setUTCHours(next.value, 0, 0, 0);
      }
      continue;
    }

    const minute = candidate.getUTCMinutes();
    if (!cron.minute.allowed.has(minute)) {
      const next = nextAllowedValue(cron.minute, minute);
      if (next.wrapped) {
        // No remaining allowed minute this hour — roll into the next hour at :00.
        candidate.setUTCHours(hour + 1, 0, 0, 0);
      } else {
        candidate.setUTCMinutes(next.value, 0, 0);
      }
      continue;
    }

    return candidate;
  }

  throw new Error(
    `Cron "${expression}" did not match within ${maxIterations} jump iterations`,
  );
}

function dayMatches(cron: ParsedCron, dayOfMonth: number, dayOfWeek: number): boolean {
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

/**
 * Finds the smallest allowed value `>= current` in `spec`, wrapping back to
 * `spec.min` if needed. Returns `wrapped=true` when the chosen value lies
 * before `current` — the caller uses that to roll the next coarser field
 * forward (e.g. next day when hour wraps).
 */
function nextAllowedValue(
  spec: FieldSpec,
  current: number,
): { value: number; wrapped: boolean } {
  const range = spec.max - spec.min + 1;
  for (let offset = 0; offset < range; offset += 1) {
    const candidate = spec.min + ((current - spec.min + offset) % range);
    if (spec.allowed.has(candidate)) {
      return { value: candidate, wrapped: offset > 0 && candidate < current };
    }
  }
  // Unreachable: parseField guarantees at least one allowed value.
  throw new Error("FieldSpec has no allowed values");
}
