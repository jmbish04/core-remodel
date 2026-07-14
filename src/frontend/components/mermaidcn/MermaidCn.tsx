/**
 * Thin wrapper around the mermaidcn `Mermaid` renderer (installed via
 * `pnpm run mermaid:setup-ui`). Renders a diagram + optional caption in a
 * horizontally-scrollable figure, dark-themed to match Monolith.
 */
import { Mermaid } from "./mermaid";

export function MermaidCn({ code, caption }: { code: string; caption?: string }) {
  return (
    <figure className="w-full">
      <div className="overflow-x-auto">
        <Mermaid chart={code} config={{ theme: "dark" }} />
      </div>
      {caption ? (
        <figcaption className="mt-2 text-center text-xs text-muted-foreground">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
