/** Return the configured Pascal editor origin without a trailing slash. */
export function pascalEditorBase(env: Env): string {
  return env.PASCAL_EDITOR_URL.replace(/\/$/, "");
}
