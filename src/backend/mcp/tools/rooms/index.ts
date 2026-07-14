import type { RemodelTool } from "../../types";

import { listRooms } from "./list_rooms";
import { getRoom } from "./get_room";
import { updateRoom } from "./update_room";

export const roomTools: RemodelTool[] = [listRooms, getRoom, updateRoom];
