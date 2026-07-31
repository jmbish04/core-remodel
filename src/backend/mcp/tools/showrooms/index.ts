import type { RemodelTool } from "../../types";

import { listShowrooms } from "./list_showrooms";
import { listStoreTypes } from "./list_store_types";
import { getShowroom } from "./get_showroom";
import { createShowroom } from "./create_showroom";
import { updateShowroom } from "./update_showroom";
import { addShowroomNote } from "./add_showroom_note";
import { addShowroomPoc } from "./add_showroom_poc";
import { setShowroomHours } from "./set_showroom_hours";
import { setShowroomLinks } from "./set_showroom_links";
import { recordShowroomVisit } from "./record_showroom_visit";
import { searchShowrooms } from "./search_showrooms";
import { importShowroomFromPlace } from "./import_showroom_from_place";
import { bulkImportShowroomsFromPlaces } from "./bulk_import_showrooms_from_places";
import { checkShowroomIntakeStatus } from "./check_showroom_intake_status";
import { checkBulkIntakeStatus } from "./check_bulk_intake_status";
import { backfillShowroomGeo } from "./backfill_showroom_geo";
import { backfillShowroomMedia } from "./backfill_showroom_media";
import { findKnownShowrooms } from "./find_known_showrooms";
import { getUserLocation } from "./get_user_location";
import { whatsNearMe } from "./whats_near_me";
import { dedupShowroomStores } from "./dedup_showroom_stores";
import { deleteShowroom } from "./delete_showroom";
import { listParkFinds } from "./list_park_finds";
import { decideParkFind } from "./decide_park_find";
import { findShowroomsTool } from "./find_showrooms";
import { listShowroomSearches } from "./list_showroom_searches";
import { getShowroomSearch } from "./get_showroom_search";
import { getSearchRevisions_ } from "./get_search_revisions";
import { finalizeShowroomSearch } from "./finalize_showroom_search";
import { importSearchResultsTool } from "./import_search_results";
import { excludeSearchResultTool } from "./exclude_search_result";
import { addShowroomExclusion } from "./add_showroom_exclusion";
import { listShowroomExclusions } from "./list_showroom_exclusions";
import { removeShowroomExclusion } from "./remove_showroom_exclusion";

export const showroomTools: RemodelTool[] = [
  listShowrooms,
  listStoreTypes,
  getShowroom,
  createShowroom,
  updateShowroom,
  addShowroomNote,
  addShowroomPoc,
  setShowroomHours,
  setShowroomLinks,
  recordShowroomVisit,
  searchShowrooms,
  importShowroomFromPlace,
  bulkImportShowroomsFromPlaces,
  checkShowroomIntakeStatus,
  checkBulkIntakeStatus,
  backfillShowroomGeo,
  backfillShowroomMedia,
  findKnownShowrooms,
  getUserLocation,
  whatsNearMe,
  dedupShowroomStores,
  deleteShowroom,
  listParkFinds,
  decideParkFind,
  // 0032 D2c-2 — discovery finder (parity with /api/showroom-searches* + /api/showroom-exclusions*)
  findShowroomsTool,
  listShowroomSearches,
  getShowroomSearch,
  getSearchRevisions_,
  finalizeShowroomSearch,
  importSearchResultsTool,
  excludeSearchResultTool,
  addShowroomExclusion,
  listShowroomExclusions,
  removeShowroomExclusion,
];
