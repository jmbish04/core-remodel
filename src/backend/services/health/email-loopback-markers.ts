/**
 * @fileoverview Pure helpers + constants for the email round-trip probe.
 *
 * Split out from `email-loopback.ts` (which imports `cloudflare:email`, a
 * Workers-only module) so this logic can be unit-tested in plain Node and
 * imported by the inbound pipeline without dragging the send runtime in.
 */

/**
 * The worker's own name — the predictable, programmatic Gmail label namespace.
 * The user can always guess the labels: `core-remodel`, `core-remodel/unit-testing`,
 * `core-remodel/inbox`. No configurable var by design.
 */
export const WORKER_LABEL_NS = "core-remodel";
export const LABEL_UNIT_TESTING = `${WORKER_LABEL_NS}/unit-testing`;
export const LABEL_INBOX = `${WORKER_LABEL_NS}/inbox`;

/** Subject marker: makes the probe email findable AND lets the pipeline skip AI on it. */
export const SUBJECT_PREFIX = "[core-remodel healthcheck]";

/** True if an inbound subject is one of our loopback probe emails. */
export function isHealthcheckSubject(subject: string | null | undefined): boolean {
  return (subject ?? "").includes(SUBJECT_PREFIX);
}

/** A 6-digit check number the far side is expected to store/echo verbatim. */
export function checkNumber(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return 100000 + (buf[0] % 900000);
}

/** The planted body. Both legs share the shape; extraction success = both markers present. */
export function probeBody(token: string, n: number, leg: "outbound" | "reply"): string {
  const dir = leg === "outbound" ? "Gmail → worker" : "worker → Gmail";
  return [
    "This is an automated core-remodel health-check message. You can ignore or delete it.",
    "",
    `LOOPBACK-TOKEN: ${token}`,
    `LOOPBACK-NUMBER: ${n}`,
    `LOOPBACK-LEG: ${dir}`,
    "",
    "It verifies that email flows end-to-end in both directions. See /admin/system/health.",
  ].join("\n");
}

/**
 * Did `bodyText` faithfully carry this cycle's token AND the expected number?
 * This is the extraction check — the far side stored what we planted.
 */
export function extractionMatches(
  bodyText: string | null | undefined,
  token: string,
  expected: number,
): boolean {
  const body = bodyText ?? "";
  return body.includes(token) && new RegExp(`LOOPBACK-NUMBER:\\s*${expected}\\b`).test(body);
}
