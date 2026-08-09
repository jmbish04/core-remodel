/**
 * @fileoverview Google Drive v3 client — the only place this repo talks to
 * Drive. Plain `fetch`; no SDK (googleapis does not run on Workers).
 *
 * Auth reuses the Gmail service-account JWT with domain-wide delegation, so the
 * `drive.readonly` scope must be delegated to the SA's client id — see
 * `services/gmail/auth.ts` and the delegation probe route.
 */
import { getGmailAccessToken } from "../gmail/auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type DriveSharing =
  | "ANYONE"
  | "ANYONE_WITH_LINK"
  | "DOMAIN"
  | "DOMAIN_WITH_LINK"
  | "PRIVATE";

export interface DriveNode {
  driveId: string;
  name: string;
  mimeType: string;
  parentDriveId: string | null;
  sizeBytes: number | null;
  md5Checksum: string | null;
  webViewUrl: string;
  sharing: DriveSharing;
  modifiedAt: Date | null;
  createdAt: Date | null;
  isFolder: boolean;
}

export interface DrivePermission {
  type: string;
  role?: string;
  /** Drive OMITS this key when it is false — treat absent as false. */
  allowFileDiscovery?: boolean;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Derive the sharing level from Drive's `permissions[]`.
 *
 * Drive v3 has no single "access level" field — it returns the permission list
 * and leaves the interpretation to the caller. `anyone` outranks `domain`
 * because it is strictly more open, and a MISSING `allowFileDiscovery` means
 * false (Drive omits false), so it must not be read as discoverable.
 */
export function deriveSharing(permissions: DrivePermission[] | undefined): DriveSharing {
  if (!permissions?.length) return "PRIVATE";
  const anyone = permissions.find((p) => p.type === "anyone");
  if (anyone) return anyone.allowFileDiscovery === true ? "ANYONE" : "ANYONE_WITH_LINK";
  const domain = permissions.find((p) => p.type === "domain");
  if (domain) return domain.allowFileDiscovery === true ? "DOMAIN" : "DOMAIN_WITH_LINK";
  return "PRIVATE";
}

export interface ExclusionOpts {
  excludedFolderIds: Set<string>;
  excludedMimePatterns: string[];
}

/** True when a node is excluded by folder id or by a `type/*`-style mime pattern. */
export function isExcluded(
  node: { driveId: string; mimeType: string },
  opts: ExclusionOpts,
): boolean {
  if (opts.excludedFolderIds.has(node.driveId)) return true;
  return opts.excludedMimePatterns.some((pattern) =>
    pattern.endsWith("/*")
      ? node.mimeType.startsWith(pattern.slice(0, -1))
      : node.mimeType === pattern,
  );
}

const FIELDS =
  "nextPageToken,files(id,name,mimeType,parents,size,md5Checksum," +
  "modifiedTime,createdTime,webViewLink,trashed,permissions(type,role,allowFileDiscovery))";

async function driveFetch(env: Env, path: string): Promise<Response> {
  const token = await getGmailAccessToken(env);
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`drive: ${res.status} ${path} — ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

function toNode(raw: Record<string, any>, parentDriveId: string | null): DriveNode {
  return {
    driveId: raw.id,
    name: raw.name,
    mimeType: raw.mimeType,
    parentDriveId,
    sizeBytes: raw.size != null ? Number(raw.size) : null,
    md5Checksum: raw.md5Checksum ?? null,
    webViewUrl: raw.webViewLink ?? "",
    sharing: deriveSharing(raw.permissions),
    modifiedAt: raw.modifiedTime ? new Date(raw.modifiedTime) : null,
    createdAt: raw.createdTime ? new Date(raw.createdTime) : null,
    isFolder: raw.mimeType === FOLDER_MIME,
  };
}

/** One page-through of a folder's direct children. */
async function listChildren(env: Env, folderId: string): Promise<DriveNode[]> {
  const out: DriveNode[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: FIELDS,
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const body = (await (await driveFetch(env, `/files?${params}`)).json()) as {
      files?: Record<string, any>[];
      nextPageToken?: string;
    };
    for (const raw of body.files ?? []) out.push(toNode(raw, folderId));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Walk a root recursively, breadth-first.
 *
 * Exclusions are applied DURING descent, so an excluded subtree costs one
 * membership check rather than a full traversal. That is the difference
 * between one check and thousands of API reads on a log folder.
 */
export async function listFolderRecursive(
  env: Env,
  rootDriveId: string,
  opts: ExclusionOpts,
): Promise<DriveNode[]> {
  const all: DriveNode[] = [];
  const queue: string[] = [rootDriveId];
  const seenFolders = new Set<string>([rootDriveId]);

  while (queue.length > 0) {
    const folderId = queue.shift() as string;
    for (const node of await listChildren(env, folderId)) {
      if (isExcluded(node, opts)) continue;
      all.push(node);
      if (node.isFolder && !seenFolders.has(node.driveId)) {
        seenFolders.add(node.driveId);
        queue.push(node.driveId);
      }
    }
  }
  return all;
}

/** Google-native export mime for text extraction. Null = not exportable. */
function exportMimeFor(mimeType: string): string | null {
  if (mimeType === "application/vnd.google-apps.document") return "text/plain";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "text/csv";
  if (mimeType === "application/vnd.google-apps.presentation") return "text/plain";
  return null;
}

/**
 * Text for a file: exported for Google-native types, downloaded for text/html.
 * Returns null for anything binary — PDFs go through `env.AI.toMarkdown()` in
 * PR 3, not here (`@llamaindex/liteparse` is native-only and cannot run on
 * Workers).
 */
export async function exportFileText(
  env: Env,
  driveId: string,
  mimeType: string,
): Promise<string | null> {
  const exportMime = exportMimeFor(mimeType);
  if (exportMime) {
    const res = await driveFetch(
      env,
      `/files/${driveId}/export?mimeType=${encodeURIComponent(exportMime)}`,
    );
    return res.text();
  }
  if (mimeType.startsWith("text/")) {
    return (await driveFetch(env, `/files/${driveId}?alt=media&supportsAllDrives=true`)).text();
  }
  return null;
}

/**
 * Content hash for change detection, with its provenance.
 *
 * Binary files carry Drive's own md5. Google-native files (Docs/Sheets/Slides)
 * carry NO md5Checksum at all, so they are hashed over their exported text —
 * which is also what makes a pure-formatting edit a no-op. A file we can
 * neither checksum nor export falls back to metadata, which is weaker but
 * still detects the common case.
 */
export async function contentHashFor(
  env: Env,
  node: DriveNode,
): Promise<{ hash: string; source: "drive_md5" | "exported_text" | "metadata" }> {
  if (node.md5Checksum) return { hash: node.md5Checksum, source: "drive_md5" };

  const text = await exportFileText(env, node.driveId, node.mimeType).catch(() => null);
  if (text != null) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { hash: hex, source: "exported_text" };
  }

  return {
    hash: `${node.name}:${node.modifiedAt?.toISOString() ?? "?"}:${node.sizeBytes ?? "?"}`,
    source: "metadata",
  };
}
