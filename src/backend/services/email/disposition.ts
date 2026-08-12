/**
 * @fileoverview Suggest attach-vs-link for a set of Drive files.
 *
 * Gmail caps a whole message at 25 MiB and base64 transfer-encoding inflates
 * bytes by ~1.33x, so the real usable budget for raw attachment bytes is about
 * 18 MiB. This is only a RECOMMENDATION — the google-workspace-mcp worker makes
 * the final call and does the actual attaching/sharing. A file is suggested for
 * `link` when its size is unknown or when attaching it would cross the running
 * budget; the running total only counts files actually kept as `attach`.
 */
export type Disposition = "attach" | "link";

export const GMAIL_ATTACH_BUDGET_BYTES = 18 * 1024 * 1024;

export function suggestDispositions(
  files: { driveDocumentId: number; sizeBytes: number | null }[],
  budgetBytes: number = GMAIL_ATTACH_BUDGET_BYTES,
): { driveDocumentId: number; suggestedDisposition: Disposition }[] {
  let used = 0;
  return files.map((f) => {
    if (f.sizeBytes == null || used + f.sizeBytes > budgetBytes) {
      return { driveDocumentId: f.driveDocumentId, suggestedDisposition: "link" as const };
    }
    used += f.sizeBytes;
    return { driveDocumentId: f.driveDocumentId, suggestedDisposition: "attach" as const };
  });
}
