import * as React from "react";

import { ConfigShell } from "./ConfigShell";
import { DefinitionTablePanel, type DefinitionTablePanelProps } from "./DefinitionTablePanel";

export interface ConfigDefinitionPageProps extends DefinitionTablePanelProps {
  /** Active config nav href, e.g. "/config/photo/colors" — highlights the sidebar item. */
  activeHref: string;
}

/**
 * One React island per `/config/*` page: the ConfigShell chrome (grouped sidebar +
 * page header) wrapping a DefinitionTablePanel. Mount with `client:load` from a
 * thin Astro page — that keeps a new config page to ~3 lines of Astro.
 */
export function ConfigDefinitionPage({ activeHref, ...panel }: ConfigDefinitionPageProps) {
  return (
    <ConfigShell activeHref={activeHref} title={panel.title} description={panel.description}>
      <DefinitionTablePanel {...panel} />
    </ConfigShell>
  );
}
