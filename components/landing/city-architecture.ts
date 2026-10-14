import type * as Three from "three";
import { createCityBuildings, type CityArchetype } from "./city-layout";

type Position = readonly [number, number, number];
type BoxWriter = (
  position: Position,
  size: Position,
  material: Three.Material,
  rotation?: number,
) => void;
type Materials = {
  white: Three.Material;
  pearl: Three.Material;
  slate: Three.Material;
  navy: Three.Material;
  red: Three.Material;
  contact: Three.Material;
};
type Canopy = { position: Position; scale: Position; rotation: number; colour: number };

/** Recognisable static parcels share material batches and never update during animation. */
export function buildCityArchitecture(
  THREE: typeof import("three"),
  box: BoxWriter,
  materials: Materials,
) {
  const { white, pearl, red, contact } = materials;
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.89 });
  const graphite = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.63,
    metalness: 0.04,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xc2c2c2,
    roughness: 0.31,
    metalness: 0.12,
  });
  const wood = new THREE.MeshStandardMaterial({ color: 0xa19277, roughness: 0.88 });
  const grass = new THREE.MeshStandardMaterial({ color: 0xc3cbb5, roughness: 1 });
  const canopies: Canopy[] = [];
  const parcels = createCityBuildings();
  const typeCounts: Record<CityArchetype, number> = {
    bank: 0,
    office: 0,
    retail: 0,
    park: 0,
    construction: 0,
    studio: 0,
  };
  const constructionParcel = parcels.find((parcel) => parcel.x === -15 && parcel.z === -25);
  const constructionSite = constructionParcel
    ? {
        position: [-15, 0.12, -25] as const,
        width: constructionParcel.width * 0.86,
        depth: constructionParcel.depth * 0.86,
      }
    : null;

  box([0, -0.5, -5], [248, 0.8, 214], stone);
  box([0, -0.05, -5], [240, 0.1, 206], white);
  for (let lane = -11; lane <= 11; lane++) {
    box([lane * 10, 0.02, -5], [0.065, 0.025, 204], stone);
    if (Math.abs(lane) < 10) box([0, 0.025, lane * 10], [238, 0.025, 0.065], stone);
  }

  const bench = (x: number, z: number, turn = 0) => {
    box([x, 0.47, z], [1.7, 0.16, 0.47], wood, turn);
    box([x, 0.9, z - 0.23], [1.7, 0.62, 0.12], wood, turn);
    box([x - 0.6, 0.22, z], [0.12, 0.44, 0.36], graphite, turn);
    box([x + 0.6, 0.22, z], [0.12, 0.44, 0.36], graphite, turn);
  };
  const tree = (x: number, z: number, size: number, detail: number) => {
    box([x, size * 0.48, z], [0.18, size * 0.96, 0.18], wood);
    canopies.push({
      position: [x, size * 1.12, z],
      scale: [size * 0.62, size * 0.78, size * 0.58],
      rotation: detail * 2.2,
      colour: detail > 0.5 ? 0x77876a : 0x8c9878,
    });
  };

  parcels.forEach(({ x, z, width: w, height: h, depth: d, kind, detail }) => {
    typeCounts[kind]++;
    if (kind === "park") {
      box([x, 0.055, z], [w, 0.09, d], stone);
      box([x, 0.12, z], [w * 0.92, 0.08, d * 0.92], grass);
      box([x, 0.17, z], [w * 0.12, 0.06, d * 0.91], pearl);
      box([x, 0.175, z + d * 0.12], [w * 0.9, 0.06, d * 0.12], pearl);
      tree(x - w * 0.25, z - d * 0.23, 2.3, detail);
      tree(x + w * 0.25, z - d * 0.2, 2.05, 1 - detail);
      tree(x + w * 0.25, z + d * 0.28, 1.8, detail + 0.1);
      bench(x - w * 0.22, z + d * 0.29);
      if (detail > 0.09) {
        box([x - w * 0.31, 0.26, z - d * 0.36], [w * 0.3, 0.4, d * 0.15], stone);
        box([x - w * 0.31, 0.48, z - d * 0.36], [w * 0.25, 0.04, d * 0.12], grass);
      }
      return;
    }

    box([x + 0.24, 0.06, z + 0.27], [w, 0.045, d], contact);
    box([x, 0.15, z], [w, 0.3, d], stone);
    if (kind === "bank") {
      // A broad, recessed civic entrance and four substantial square columns.
      const columnHeight = h * 0.76;
      const columnTop = 0.35 + columnHeight;
      box([x, 0.35 + columnHeight / 2, z - d * 0.12], [w * 0.91, columnHeight, d * 0.66], white);
      box([x, columnTop + 0.23, z], [w * 0.98, 0.44, d * 0.9], pearl);
      box([x, columnTop + 0.58, z - d * 0.06], [w * 0.82, 0.25, d * 0.78], white);
      box([x, columnTop + 0.8, z - d * 0.08], [w * 0.58, 0.18, d * 0.62], stone);
      box(
        [x, columnHeight * 0.49 + 0.42, z + d * 0.217],
        [w * 0.75, columnHeight * 0.73, 0.065],
        graphite,
      );
      for (let index = 0; index < 4; index++) {
        const cx = x + (index - 1.5) * w * 0.22;
        box([cx, 0.34 + columnHeight / 2, z + d * 0.34], [0.37, columnHeight, 0.43], pearl);
        box([cx, 0.42, z + d * 0.34], [0.55, 0.23, 0.59], stone);
        box([cx, columnTop - 0.01, z + d * 0.34], [0.56, 0.22, 0.6], pearl);
      }
      box([x, 0.19, z + d * 0.34], [w * 0.85, 0.16, d * 0.28], stone);
      box([x, 0.33, z + d * 0.3], [w * 0.71, 0.15, d * 0.19], pearl);
      box([x, 1.04, z + d * 0.24], [1.13, 1.5, 0.075], glass);
      box([x, columnTop + 0.47, z + d * 0.45], [w * 0.32, 0.065, 0.055], red);
    } else if (kind === "office") {
      // Slender towers use a few large neutral panes, not an endless window grid.
      const stepped = detail > 0.87;
      const mainHeight = stepped ? h * 0.77 : h;
      const bodyW = w * 0.78;
      const bodyD = d * 0.79;
      box([x, 0.3 + mainHeight / 2, z], [bodyW, mainHeight, bodyD], white);
      box([x, mainHeight + 0.43, z], [bodyW * 1.07, 0.25, bodyD * 1.05], stone);
      if (stepped) {
        box([x, h * 0.887 + 0.3, z - d * 0.06], [w * 0.55, h * 0.226, d * 0.59], pearl);
        box([x, h * 0.885 + 0.3, z + d * 0.235 + 0.026], [w * 0.32, h * 0.16, 0.05], glass);
        box([x, h + 0.44, z - d * 0.06], [w * 0.58, 0.2, d * 0.62], graphite);
      }
      for (const side of [-1, 1]) {
        box(
          [x + side * w * 0.18, mainHeight * 0.49 + 0.4, z + bodyD / 2 + 0.027],
          [w * 0.145, mainHeight * 0.74, 0.052],
          glass,
        );
      }
      box(
        [x + bodyW / 2 + 0.026, mainHeight * 0.48 + 0.4, z],
        [0.05, mainHeight * 0.67, d * 0.45],
        glass,
      );
      box([x, mainHeight * 0.38, z + bodyD / 2 + 0.06], [bodyW * 0.96, 0.12, 0.08], stone);
      box([x, 0.83, z + bodyD / 2 + 0.05], [w * 0.38, 1.12, 0.07], graphite);
      box([x, 1.48, z + bodyD / 2 + 0.22], [w * 0.44, 0.11, 0.45], stone);
      if (detail > 0.93)
        box(
          [x - bodyW * 0.46, mainHeight * 0.5 + 0.3, z],
          [0.065, mainHeight * 0.9, bodyD * 0.8],
          red,
        );
    } else if (kind === "retail") {
      // A low corner storefront with an angled corner and a wraparound canopy.
      box([x - w * 0.12, h / 2 + 0.3, z], [w * 0.67, h, d * 0.82], white);
      box([x + w * 0.22, h / 2 + 0.3, z - d * 0.09], [w * 0.33, h, d * 0.64], pearl);
      box([x + w * 0.23, h / 2 + 0.3, z + d * 0.18], [w * 0.22, h, d * 0.2], white, Math.PI / 4);
      box([x - w * 0.025, h + 0.46, z], [w * 0.92, 0.28, d * 0.93], stone);
      box(
        [x - w * 0.12, h * 0.48 + 0.35, z + d * 0.41 + 0.032],
        [w * 0.57, h * 0.58, 0.065],
        glass,
      );
      box([x + w * 0.386, h * 0.48 + 0.35, z - d * 0.09], [0.065, h * 0.58, d * 0.47], glass);
      box(
        [
          x + w * 0.23 + (d * 0.1 + 0.027) * Math.SQRT1_2,
          h * 0.48 + 0.35,
          z + d * 0.18 + (d * 0.1 + 0.027) * Math.SQRT1_2,
        ],
        [w * 0.185, h * 0.58, 0.055],
        glass,
        Math.PI / 4,
      );
      box([x - w * 0.13, h * 0.82 + 0.3, z + d * 0.427], [w * 0.6, 0.19, 0.045], red);
      box([x - w * 0.12, 0.97, z + d * 0.425], [0.72, 1.36, 0.07], graphite);
      box([x + w * 0.06, h + 0.68, z - d * 0.09], [w * 0.25, 0.2, d * 0.24], pearl);
      if (detail > 0.39) {
        box([x - w * 0.32, 0.49, z + d * 0.454], [0.38, 0.56, 0.38], wood);
        box([x - w * 0.32, 0.9, z + d * 0.454], [0.57, 0.18, 0.57], stone);
      }
    } else if (kind === "construction") {
      // Most sites are open concrete frames; one parcel is reserved for the asset.
      const reserved = x === constructionParcel?.x && z === constructionParcel?.z;
      if (!reserved) {
        const levels = detail > 0.54 ? 3 : 2;
        const levelHeight = h / levels;
        for (let level = 0; level <= levels; level++) {
          const y = 0.32 + level * levelHeight;
          box([x, y, z], [w * 0.87, 0.18, d * 0.85], pearl);
          if (level === levels) continue;
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 0, 1]) {
              box(
                [x + sx * w * 0.36, y + levelHeight / 2, z + sz * d * 0.34],
                [0.27, levelHeight, 0.27],
                stone,
              );
            }
          }
          box([x, y + levelHeight - 0.23, z + d * 0.34], [w * 0.82, 0.26, 0.28], stone);
          box([x + w * 0.36, y + levelHeight - 0.23, z], [0.28, 0.26, d * 0.79], stone);
        }
      }
      box([x, 0.57, z + d * 0.47], [w * 0.9, 0.8, 0.065], wood);
      box([x + w * 0.47, 0.57, z], [0.065, 0.8, d * 0.9], wood);
      box([x - w * 0.31, 0.57, z - d * 0.28], [0.71, 0.85, 0.88], pearl);
      box([x - w * 0.31, 1.06, z - d * 0.28], [0.76, 0.12, 0.94], red);
    } else {
      // Studios and workshops have lower roof monitors and a sheltered entrance.
      box([x, h / 2 + 0.3, z], [w * 0.87, h, d * 0.86], white);
      box([x, h + 0.41, z], [w * 0.95, 0.2, d * 0.93], stone);
      for (let monitor = 0; monitor < 3; monitor++) {
        const mz = z + (monitor - 1) * d * 0.23;
        const rise = 0.22 + (monitor % 2) * 0.16;
        box([x, h + 0.54 + rise / 2, mz], [w * 0.58, rise, d * 0.17], pearl);
        box([x, h + 0.58 + rise, mz + d * 0.06], [w * 0.46, 0.13, 0.04], glass);
      }
      box([x - w * 0.21, h * 0.46 + 0.34, z + d * 0.43 + 0.027], [w * 0.25, h * 0.59, 0.05], glass);
      box([x + w * 0.18, 1.41, z + d * 0.43 + 0.032], [w * 0.3, 2.09, 0.055], graphite);
      box([x + w * 0.18, 2.56, z + d * 0.445], [w * 0.39, 0.15, d * 0.08], wood);
      box([x + w * 0.365, 1.41, z + d * 0.455], [0.12, 2.18, 0.12], wood);
      if (detail > 0.69) box([x - w * 0.3, h + 0.73, z - d * 0.28], [0.18, 0.9, 0.18], graphite);
    }
  });

  // A few bridges belong to the office district, leaving low streets and parks open.
  let bridges = 0;
  parcels.forEach((building) => {
    if (bridges >= 6 || building.kind !== "office" || building.height < 15) return;
    const neighbour = parcels.find(
      (other) =>
        other.kind === "office" &&
        other.x === building.x + 10 &&
        other.z === building.z &&
        other.height > 14,
    );
    if (!neighbour || (building.x + building.z) % 30 !== 0) return;
    const left = building.x + building.width * 0.39;
    const right = neighbour.x - neighbour.width * 0.39;
    const y = Math.min(building.height, neighbour.height) * 0.44;
    box([(left + right) / 2, y, building.z], [right - left, 0.78, 0.93], glass);
    box([(left + right) / 2, y + 0.44, building.z], [right - left + 0.09, 0.1, 1.05], pearl);
    box([(left + right) / 2, y - 0.44, building.z], [right - left + 0.09, 0.1, 1.05], stone);
    bridges++;
  });

  const extras: Three.Object3D[] = [];
  if (canopies.length) {
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      flatShading: true,
    });
    const canopyMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      canopyMaterial,
      canopies.length,
    );
    const placement = new THREE.Object3D();
    canopies.forEach((canopy, index) => {
      placement.position.set(...canopy.position);
      placement.scale.set(...canopy.scale);
      placement.rotation.set(0, canopy.rotation, 0);
      placement.updateMatrix();
      canopyMesh.setMatrixAt(index, placement.matrix);
      canopyMesh.setColorAt(index, new THREE.Color(canopy.colour));
    });
    canopyMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.computeBoundingSphere();
    extras.push(canopyMesh);
  }
  return {
    buildingCount: parcels.length - typeCounts.park,
    parkCount: typeCounts.park,
    bridges,
    typeCounts,
    extras,
    constructionSite,
  };
}
