import { useCallback, useState } from "react";

import { GeneratedMoodBoards } from "./GeneratedMoodBoards";
import { MoodBoardGenerator } from "./MoodBoardGenerator";

/**
 * Couples the generator and the generated-board list so a successful
 * generation refreshes the gallery. Mounted as a single island because the
 * two components share React state, which cannot cross separate hydration
 * roots.
 */
export function MoodBoardStudio() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleGenerated = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  return (
    <div className="space-y-8">
      <MoodBoardGenerator onGenerated={handleGenerated} />
      <GeneratedMoodBoards refreshKey={refreshKey} />
    </div>
  );
}
