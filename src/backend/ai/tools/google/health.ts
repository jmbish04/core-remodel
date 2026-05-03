import type { HealthStepResult, TemplateIds } from "@backend/health/types";
import { GoogleDocsClient } from "@/ai/tools/google/docs";
import { GoogleDriveClient } from "@/ai/tools/google/drive";
import { renderDocumentTemplate } from "@/ai/tools/google/templates/template-engine";
import { getDb } from "@/db";
import { globalConfig } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Read template_ids config from D1 global_config.
 * Returns partial TemplateIds — empty strings for missing values.
 */
async function readTemplateIds(env: Env): Promise<TemplateIds> {
  const defaults: TemplateIds = { resume: "", coverLetter: "", drivePrefix: "Career Orchestrator" };
  try {
    const db = getDb(env);
    const [row] = await db
      .select({ value: globalConfig.value })
      .from(globalConfig)
      .where(eq(globalConfig.key, "template_ids"))
      .limit(1);
    if (row?.value && typeof row.value === "object") {
      const val = row.value as Record<string, string>;
      return {
        resume: val.resume || defaults.resume,
        coverLetter: val.coverLetter || defaults.coverLetter,
        drivePrefix: val.drivePrefix || defaults.drivePrefix,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return defaults;
}

/**
 * Verify Google Drive connectivity and document lifecycle.
 *
 * Sub-checks (partially parallel):
 *  1. List `PARENT_DRIVE_FOLDER_ID` (auth + folder access)
 *  2. List `HEALTH_CHECK_DRIVE_FOLDER_ID`
 *  3. Delete previous health-check documents
 *  4. HTML templatize path: renderDocumentTemplate → createDocFromHtml
 *  5. Template copy path: copyFile(resume template) — SKIPPED if empty
 *  6. Template copy path: copyFile(coverLetter template) — SKIPPED if empty
 *  7. Validate Docs API write: appendText
 *
 * Reads template IDs from D1 `global_config` (not env vars).
 */
export async function checkGoogleDrive(
  env: Env,
  previousDocIds: string[],
): Promise<HealthStepResult & { createdDocIds?: string[] }> {
  const start = Date.now();
  const issues: string[] = [];
  const skipped: string[] = [];
  const createdDocIds: string[] = [];
  const createdDocUrls: string[] = [];

  try {
    const drive = new GoogleDriveClient(env);
    const docs = new GoogleDocsClient(env);
    const templateIds = await readTemplateIds(env);

    // 1. List PARENT_DRIVE_FOLDER_ID (verifies auth + folder access)
    try {
      await drive.listFilesInFolder(env.PARENT_DRIVE_FOLDER_ID);
    } catch (e) {
      issues.push(`Parent folder list error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. List HEALTH_CHECK_DRIVE_FOLDER_ID
    try {
      await drive.listFilesInFolderSorted(env.HEALTH_CHECK_DRIVE_FOLDER_ID);
    } catch (e) {
      issues.push(`Health folder list error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Delete previous health-check documents
    const deleteResults = await Promise.allSettled(
      previousDocIds.map((docId) => drive.deleteFile(docId)),
    );
    const deleteFails = deleteResults.filter((r) => r.status === "rejected");
    if (deleteFails.length > 0) {
      console.log(`[health] ${deleteFails.length}/${previousDocIds.length} delete(s) failed (expected for stale IDs)`);
    }

    // 4. HTML templatize path: render template → create doc
    const timestamp = new Date().toISOString();
    try {
      const healthVariables: Record<string, string> = {
        TARGET_ROLE: `Health Check Validation - ${timestamp}`,
        SUMMARY_STATEMENT: `Automated health check document generated at ${timestamp}. Validates: template engine → HTML render → multipart upload → native Google Doc conversion → Docs API write access.`,
      };
      const renderedHtml = renderDocumentTemplate("resume", healthVariables);
      const newDoc = await drive.createDocFromHtml(
        `[Health Check] HTML Template - ${timestamp}`,
        renderedHtml,
        env.HEALTH_CHECK_DRIVE_FOLDER_ID,
      );
      createdDocIds.push(newDoc.id);
      if (newDoc.webViewLink) createdDocUrls.push(newDoc.webViewLink);

      // Validate Docs API can append to the created document
      await docs.appendText(newDoc.id, "\n\n--- Docs API Write Validated ---");
    } catch (e) {
      issues.push(`HTML templatize error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 5. Template copy path: resume template
    if (templateIds.resume) {
      try {
        const copiedDoc = await drive.copyFile(
          templateIds.resume,
          `[Health Check] Resume Copy - ${timestamp}`,
          env.HEALTH_CHECK_DRIVE_FOLDER_ID,
        );
        createdDocIds.push(copiedDoc.id);
        if (copiedDoc.webViewLink) createdDocUrls.push(copiedDoc.webViewLink);
      } catch (e) {
        issues.push(`Resume template copy error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      skipped.push("resume_template_copy (template_ids.resume is empty — configure at /config → Template IDs)");
    }

    // 6. Template copy path: cover letter template
    if (templateIds.coverLetter) {
      try {
        const copiedDoc = await drive.copyFile(
          templateIds.coverLetter,
          `[Health Check] Cover Letter Copy - ${timestamp}`,
          env.HEALTH_CHECK_DRIVE_FOLDER_ID,
        );
        createdDocIds.push(copiedDoc.id);
        if (copiedDoc.webViewLink) createdDocUrls.push(copiedDoc.webViewLink);
      } catch (e) {
        issues.push(`Cover letter template copy error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      skipped.push("cover_letter_template_copy (template_ids.coverLetter is empty — configure at /config → Template IDs)");
    }
  } catch (e) {
    // Client instantiation or auth failed — critical error
    return {
      status: "fail",
      latencyMs: Date.now() - start,
      error: `Google auth failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return {
    status: issues.length === 0 ? (skipped.length > 0 ? "warn" : "ok") : "fail",
    latencyMs: Date.now() - start,
    error: issues.length > 0 ? issues.join("; ") : undefined,
    createdDocIds: createdDocIds.length > 0 ? createdDocIds : undefined,
    details: {
      parentFolderId: env.PARENT_DRIVE_FOLDER_ID,
      healthFolderId: env.HEALTH_CHECK_DRIVE_FOLDER_ID,
      docsCreated: createdDocIds.length,
      previousDocsCleaned: previousDocIds.length,
      createdDocUrls,
      skipped: skipped.length > 0 ? skipped : undefined,
      templateIdsChecked: {
        resume: !!readTemplateIds.length, // flag whether template was tested
        coverLetter: !!readTemplateIds.length,
      },
    },
  };
}
