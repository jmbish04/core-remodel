import { floors, rooms } from "@backend/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

interface SeedFloor {
  key: string;
  name: string;
  levelOrder: number;
  livingSqFt: number | null;
}

interface SeedRoom {
  floorKey: string;
  roomCode: string;
  roomName: string;
  asIsUse: string;
  lengthFeet: number | null;
  lengthInches: number | null;
  widthFeet: number | null;
  widthInches: number | null;
  isLivingSpace: boolean;
}

const DEFAULT_FLOORS: SeedFloor[] = [
  {
    key: "lower_level",
    name: "Lower Level",
    levelOrder: 1,
    livingSqFt: 763,
  },
  {
    key: "upper_level",
    name: "Upper Level",
    levelOrder: 2,
    livingSqFt: 1429,
  },
];

const DEFAULT_ROOMS: SeedRoom[] = [
  {
    floorKey: "lower_level",
    roomCode: "lower-bedroom-1",
    roomName: "Bedroom",
    asIsUse: "Bedroom",
    lengthFeet: 11,
    lengthInches: 11,
    widthFeet: 13,
    widthInches: 7,
    isLivingSpace: true,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-family-room",
    roomName: "Family Room",
    asIsUse: "Family Room",
    lengthFeet: 11,
    lengthInches: 9,
    widthFeet: 22,
    widthInches: 6,
    isLivingSpace: true,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-bath-1",
    roomName: "Bath",
    asIsUse: "Bath",
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    isLivingSpace: true,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-laundry",
    roomName: "Laundry",
    asIsUse: "Laundry",
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    isLivingSpace: false,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-storage",
    roomName: "Storage",
    asIsUse: "Storage",
    lengthFeet: 8,
    lengthInches: 1,
    widthFeet: 3,
    widthInches: 0,
    isLivingSpace: false,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-garage",
    roomName: "Garage",
    asIsUse: "Garage",
    lengthFeet: 18,
    lengthInches: 2,
    widthFeet: 21,
    widthInches: 9,
    isLivingSpace: false,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-entryway",
    roomName: "Entryway",
    asIsUse: "Entryway",
    lengthFeet: 5,
    lengthInches: 8,
    widthFeet: 11,
    widthInches: 5,
    isLivingSpace: false,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-patio",
    roomName: "Patio",
    asIsUse: "Patio",
    lengthFeet: 23,
    lengthInches: 6,
    widthFeet: 9,
    widthInches: 8,
    isLivingSpace: false,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-rear-patio",
    roomName: "Rear Patio",
    asIsUse: "Rear Patio",
    lengthFeet: 25,
    lengthInches: 0,
    widthFeet: 9,
    widthInches: 0,
    isLivingSpace: false,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-backyard",
    roomName: "Backyard",
    asIsUse: "Backyard",
    lengthFeet: 25,
    lengthInches: 0,
    widthFeet: 60,
    widthInches: 0,
    isLivingSpace: false,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-primary-bedroom",
    roomName: "Primary Bedroom",
    asIsUse: "Primary Bedroom",
    lengthFeet: 11,
    lengthInches: 11,
    widthFeet: 13,
    widthInches: 7,
    isLivingSpace: true,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-bedroom-2",
    roomName: "Bedroom",
    asIsUse: "Bedroom",
    lengthFeet: 12,
    lengthInches: 0,
    widthFeet: 13,
    widthInches: 4,
    isLivingSpace: true,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-bedroom-3",
    roomName: "Bedroom",
    asIsUse: "Bedroom",
    lengthFeet: 11,
    lengthInches: 10,
    widthFeet: 10,
    widthInches: 7,
    isLivingSpace: true,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-living-dining",
    roomName: "Living Room / Dining Room",
    asIsUse: "Living Room / Dining Room",
    lengthFeet: 15,
    lengthInches: 0,
    widthFeet: 24,
    widthInches: 10,
    isLivingSpace: true,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-kitchen-breakfast",
    roomName: "Kitchen / Breakfast Nook",
    asIsUse: "Kitchen / Breakfast Nook",
    lengthFeet: 8,
    lengthInches: 9,
    widthFeet: 18,
    widthInches: 3,
    isLivingSpace: true,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-bath-1",
    roomName: "Bath",
    asIsUse: "Bath",
    lengthFeet: 5,
    lengthInches: 4,
    widthFeet: 11,
    widthInches: 3,
    isLivingSpace: true,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-bath-2",
    roomName: "Bath (Second)",
    asIsUse: "Bath (Second)",
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    isLivingSpace: true,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-lightwell",
    roomName: "Lightwell",
    asIsUse: "Lightwell",
    lengthFeet: 10,
    lengthInches: 2,
    widthFeet: 3,
    widthInches: 11,
    isLivingSpace: false,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-workshop",
    roomName: "Workshop",
    asIsUse: "Workshop",
    lengthFeet: 10,
    lengthInches: 11,
    widthFeet: 7,
    widthInches: 6,
    isLivingSpace: false,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-deck",
    roomName: "Deck",
    asIsUse: "Deck",
    lengthFeet: 16,
    lengthInches: 1,
    widthFeet: 5,
    widthInches: 6,
    isLivingSpace: false,
  },
];

let _catalogSeeded: Promise<void> | null = null;

export async function ensureHomeCatalogSeed(env: Env): Promise<void> {
  if (_catalogSeeded) return _catalogSeeded;

  _catalogSeeded = _doSeedHomeCatalog(env).catch((err) => {
    // Allow retry on failure
    _catalogSeeded = null;
    throw err;
  });

  return _catalogSeeded;
}

async function _doSeedHomeCatalog(env: Env): Promise<void> {
  const db = drizzle(env.DB);

  for (const floor of DEFAULT_FLOORS) {
    await db
      .insert(floors)
      .values({
        key: floor.key,
        name: floor.name,
        levelOrder: floor.levelOrder,
        livingSqFt: floor.livingSqFt,
      })
      .onConflictDoNothing()
      .run();
  }

  const existingFloors = await db.select().from(floors).all();
  const floorIdByKey = new Map(existingFloors.map((floor) => [floor.key, floor.id]));

  for (const room of DEFAULT_ROOMS) {
    const floorId = floorIdByKey.get(room.floorKey);
    if (!floorId) {
      continue;
    }
    await db
      .insert(rooms)
      .values({
        floorId,
        roomCode: room.roomCode,
        roomName: room.roomName,
        asIsUse: room.asIsUse,
        lengthFeet: room.lengthFeet,
        lengthInches: room.lengthInches,
        widthFeet: room.widthFeet,
        widthInches: room.widthInches,
        isLivingSpace: room.isLivingSpace,
      })
      .onConflictDoNothing()
      .run();
  }
}

export async function getHomeCatalog(env: Env) {
  const db = drizzle(env.DB);

  const floorRows = await db.select().from(floors).orderBy(asc(floors.levelOrder)).all();
  const roomRows = await db.select().from(rooms).orderBy(asc(rooms.floorId), asc(rooms.id)).all();

  const roomCountsByFloorAndName = new Map<string, number>();
  for (const room of roomRows) {
    const key = `${room.floorId}::${room.roomName.toLowerCase()}`;
    roomCountsByFloorAndName.set(key, (roomCountsByFloorAndName.get(key) || 0) + 1);
  }

  const roomIndexByFloorAndName = new Map<string, number>();
  const roomsByFloorId = new Map<
    number,
    Array<(typeof roomRows)[number] & { displayName: string }>
  >();

  for (const room of roomRows) {
    const key = `${room.floorId}::${room.roomName.toLowerCase()}`;
    const currentIndex = (roomIndexByFloorAndName.get(key) || 0) + 1;
    roomIndexByFloorAndName.set(key, currentIndex);

    const totalWithSameName = roomCountsByFloorAndName.get(key) || 1;
    const displayName = totalWithSameName > 1 ? `${room.roomName} ${currentIndex}` : room.roomName;

    const payload = {
      ...room,
      displayName,
    };

    if (!roomsByFloorId.has(room.floorId)) {
      roomsByFloorId.set(room.floorId, []);
    }
    roomsByFloorId.get(room.floorId)!.push(payload);
  }

  return {
    floors: floorRows.map((floor) => ({
      ...floor,
      rooms: roomsByFloorId.get(floor.id) || [],
    })),
    rooms: roomRows,
  };
}

export async function getRoomById(env: Env, roomId: number) {
  const db = drizzle(env.DB);
  return db.select().from(rooms).where(eq(rooms.id, roomId)).get();
}
