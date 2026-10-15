import { CITY_DESTINATIONS } from "./city";

export type CityArchetype = "bank" | "office" | "retail" | "park" | "construction" | "studio";
export type CityModelKind = "low" | "medium" | "tall";
export type CityModelPlacement = Readonly<{
  id: string;
  x: number;
  z: number;
  y?: number;
  width: number;
  depth: number;
  targetHeight: number;
  kind: CityModelKind;
  rotation?: number;
  modelId?: string;
  landmark?: boolean;
  frontage?: Readonly<{ z: number; side: -1 | 1 }>;
}>;
export type CityBuilding = Readonly<{
  id: string;
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  style: number;
  detail: number;
  kind: CityArchetype;
  modelKind: CityModelKind;
  rotation: number;
  plaza?: boolean;
  frontage?: CityModelPlacement["frontage"];
}>;
export type CityBlock = Readonly<{ x: number; z: number; width: number; depth: number }>;

export const CITY_ROAD_LOOP = [
  [-30, -30], [40, -30], [40, 30], [-30, 30],
] as const;
const avenues = [-104, -80, -55, -30, -6, 17, 40, 65, 90, 114] as const;
const streets = [-88, -65, -46, -30, -8, 10, 30, 50, 72, 94] as const;
export const CITY_ROAD_WIDTH = 3.4;
const setback = CITY_ROAD_WIDTH / 2 + 1.2;

export function citySeed(x: number, z: number) {
  return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

function reserved(x: number, z: number, width: number, depth: number) {
  if (CITY_DESTINATIONS.some(item =>
    Math.abs(item.position[0] - x) < 7.4 + width / 2 &&
    Math.abs(item.position[2] - z) < 6.9 + depth / 2)) return true;
  // Keep a short, clear approach to the separate hardware exhibit.
  return x + width / 2 > -4 && x - width / 2 < 20 &&
    z + depth / 2 > 6 && z - depth / 2 < 46;
}

/** Continuous streets, aligned frontages and deliberately graded skyline. */
export function createCityLayout() {
  const parcels: CityBuilding[] = [];
  const blocks: CityBlock[] = [];
  for (let row = 0; row < streets.length - 1; row++) {
    for (let column = 0; column < avenues.length - 1; column++) {
      const west = avenues[column], east = avenues[column + 1];
      const north = streets[row], south = streets[row + 1];
      const block = { x: (west + east) / 2, z: (north + south) / 2,
        width: east - west - setback * 2, depth: south - north - setback * 2 };
      blocks.push(block);
      const publicSpace = (column === 3 && row === 5) || (column === 6 && row === 6) ||
        (column === 1 && row === 2) || (column === 7 && row === 1) ||
        (column === 5 && row === 7) || (column === 3 && row === 1);
      if (publicSpace && !reserved(block.x, block.z, block.width, block.depth)) {
        parcels.push({ ...block, id: "park-" + column + "-" + row, height: 3.6,
          style: 3, detail: citySeed(column, row), kind: "park", modelKind: "low",
          rotation: 0, plaza: row === 7 || (column === 3 && row === 1) });
        continue;
      }
      const columns = east - west >= 24 ? 3 : 2;
      const gap = 0.7;
      const cell = (block.width - gap * (columns - 1)) / columns;
      for (let side = 0; side < 2; side++) {
        for (let slot = 0; slot < columns; slot++) {
          const detail = citySeed(column * 7 + slot, row * 3 + side);
          const width = cell * (0.94 + detail * 0.05);
          const depth = Math.min(block.depth / 2 - 0.8, cell * (1.02 + detail * 0.24));
          const x = west + setback + cell / 2 + slot * (cell + gap);
          const frontageZ = side ? south - setback : north + setback;
          const z = frontageZ + (side ? -1 : 1) * depth / 2;
          if (reserved(x, z, width + 0.5, depth + 0.5)) continue;
          const variation = citySeed(row + slot + 19, column + side + 31);
          const modelKind: CityModelKind = z > 16 ? "low" : z < -30 ? "tall" : "medium";
          const height = modelKind === "low" ? 3.1 + variation * 3.5
            : modelKind === "tall" ? 14 + variation * 12 : 7.1 + variation * 6;
          const kind: CityArchetype = modelKind === "tall" ? "office"
            : modelKind === "medium" ? (detail > 0.58 ? "bank" : "office")
            : detail > 0.48 ? "retail" : "studio";
          parcels.push({ id: "parcel-" + column + "-" + row + "-" + side + "-" + slot,
            x, z, width, depth, height, kind, modelKind, detail,
            style: modelKind === "tall" ? 1 : modelKind === "medium" ? 0 : 2,
            rotation: side ? Math.PI : 0, frontage: { z: frontageZ, side: side ? 1 : -1 } });
        }
      }
    }
  }
  // A small central garden occupies the clear space between the two rooftop hubs.
  parcels.push({ id: "central-garden", x: 10.5, z: -20.5, width: 7.6, depth: 9.6,
    height: 3.6, style: 3, detail: 0.46, kind: "park", modelKind: "low", rotation: 0 });
  const modelPlacements: CityModelPlacement[] = parcels.filter(parcel => parcel.kind !== "park")
    .map(parcel => ({ id: parcel.id, x: parcel.x, z: parcel.z, y: 0.14,
      width: parcel.width, depth: parcel.depth, targetHeight: parcel.height,
      kind: parcel.modelKind, rotation: parcel.rotation, frontage: parcel.frontage }));
  return { parcels, blocks, modelPlacements,
    roads: { avenues, streets, width: CITY_ROAD_WIDTH, loop: CITY_ROAD_LOOP },
    bounds: { x: 5, z: 3, width: 232, depth: 198 } };
}

export function createCityBuildings(): CityBuilding[] {
  return createCityLayout().parcels;
}
