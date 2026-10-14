import { CITY_DESTINATIONS } from "./city";

export type CityArchetype = "bank" | "office" | "retail" | "park" | "construction" | "studio";
export type CityBuilding = Readonly<{
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  style: number;
  detail: number;
  kind: CityArchetype;
}>;

export function citySeed(x: number, z: number) {
  return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

function blockKind(x: number, z: number, detail: number): CityArchetype {
  // A few civic places are deliberately composed near the central district.
  if ((x === 25 && z === 15) || (x === -25 && z === 15) || (x === 45 && z === 35)) return "park";
  if (x === 15 && z === -5) return "bank";
  if (x === 35 && z === 25) return "retail";
  if (x === -15 && z === -25) return "construction";
  if (z < -45 && detail > 0.42) return "office";
  if (detail < 0.17) return "park";
  if (detail < 0.29) return "bank";
  if (detail < 0.48) return "retail";
  if (detail < 0.59) return "construction";
  if (detail < 0.77) return "studio";
  return "office";
}

const style: Record<CityArchetype, number> = {
  bank: 0,
  office: 1,
  retail: 2,
  park: 3,
  construction: 4,
  studio: 5,
};

/** Fixed parcels leave streets, landmark plazas and the showroom approach clear. */
export function createCityBuildings(): CityBuilding[] {
  const parcels: CityBuilding[] = [];
  for (let row = -9; row <= 8; row++) {
    for (let column = -11; column <= 10; column++) {
      const x = column * 10 + 5;
      const z = row * 10 + 5;
      const nearDestination = CITY_DESTINATIONS.some(
        (item) => Math.abs(item.position[0] - x) < 10 && Math.abs(item.position[2] - z) < 10,
      );
      if (nearDestination || (Math.abs(x - 8) < 12 && z > 8) || (x === 5 && z > -40)) continue;
      const detail = citySeed(column, row);
      if (detail < 0.025) continue;
      const kind = blockKind(x, z, detail);
      const variation = citySeed(row + 3, column + 6);
      const heights: Record<CityArchetype, number> = {
        bank: 5.2 + variation * 2.8,
        office: (z < -35 ? 18 : 12) + variation * 12,
        retail: 2.8 + variation * 1.45,
        park: 4,
        construction: 7.8 + variation * 4,
        studio: 4 + variation * 2.6,
      };
      parcels.push({
        x,
        z,
        detail,
        kind,
        style: style[kind],
        height: heights[kind],
        width: kind === "office" ? 4.6 + variation * 1.4 : 6.3 + citySeed(row + 4, column) * 1.1,
        depth:
          kind === "office"
            ? 4.8 + citySeed(column + 8, row + 1) * 1.4
            : 6.3 + citySeed(column + 8, row + 1) * 1.1,
      });
    }
  }
  return parcels;
}
