import type * as Three from "three";
import { createCityLayout, type CityArchetype } from "./city-layout";

type Position = readonly [number, number, number];
type BoxWriter = (position: Position, size: Position, material: Three.Material, rotation?: number) => void;
type Materials = {
  white: Three.Material; pearl: Three.Material; slate: Three.Material;
  navy: Three.Material; red: Three.Material; contact: Three.Material;
};
type Canopy = { position: Position; scale: Position; rotation: number; colour: number };

/** Static public spaces and streets frame the separately instanced model library. */
export function buildCityArchitecture(
  THREE: typeof import("three"), box: BoxWriter, materials: Materials,
) {
  const { white, pearl, contact } = materials;
  const paving = new THREE.MeshStandardMaterial({ color: 0xe3e3e3, roughness: 0.92 });
  const asphalt = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.96 });
  const benchMaterial = new THREE.MeshStandardMaterial({ color: 0x979797, roughness: 0.86 });
  const grass = new THREE.MeshStandardMaterial({ color: 0xd1d8cc, roughness: 1 });
  const layout = createCityLayout();
  const canopies: Canopy[] = [];
  const typeCounts: Record<CityArchetype, number> = {
    bank: 0, office: 0, retail: 0, park: 0, construction: 0, studio: 0,
  };
  const { x, z, width, depth } = layout.bounds;
  box([x, -0.45, z], [width + 4, 0.8, depth + 4], paving);
  box([x, -0.035, z], [width, 0.07, depth], white);
  layout.roads.avenues.forEach(avenue =>
    box([avenue, 0.009, z], [layout.roads.width, 0.016, depth - 2], asphalt));
  layout.roads.streets.forEach(street =>
    box([x, 0.009, street], [width - 2, 0.016, layout.roads.width], asphalt));
  layout.blocks.forEach(block =>
    box([block.x, 0.045, block.z], [block.width + 1.25, 0.08, block.depth + 1.25], pearl));

  const aboutPlaza = layout.landmarkSpaces.find(space => space.id === "about");
  if (aboutPlaza) {
    // A complete, road-aligned courtyard gives the project story its own district.
    box([aboutPlaza.x, 0.105, aboutPlaza.z],
      [aboutPlaza.width, 0.12, aboutPlaza.depth], paving);
    box([aboutPlaza.x, 0.175, aboutPlaza.z],
      [3.2, 0.025, aboutPlaza.depth - 0.4], white);
    box([aboutPlaza.x, 0.18, aboutPlaza.z],
      [aboutPlaza.width - 0.4, 0.025, 1.1], white);
  }

  const tree = (tx: number, tz: number, size: number, detail: number) => {
    box([tx, size * 0.45, tz], [0.16, size * 0.9, 0.16], benchMaterial);
    canopies.push({ position: [tx, size * 1.07, tz],
      scale: [size * 0.59, size * 0.73, size * 0.57], rotation: detail * 2.2,
      colour: detail > 0.5 ? 0x91a086 : 0xa3ae97 });
  };
  layout.parcels.forEach(parcel => {
    typeCounts[parcel.kind]++;
    if (parcel.kind !== "park") return;
    const { x: px, z: pz, width: w, depth: d, detail } = parcel;
    box([px, 0.1, pz], [w, 0.13, d], paving);
    if (!parcel.plaza) {
      box([px, 0.19, pz], [w * 0.91, 0.08, d * 0.9], grass);
      box([px, 0.24, pz], [0.85, 0.045, d * 0.91], white);
      box([px, 0.245, pz], [w * 0.92, 0.045, 0.85], white);
    }
    for (const side of [-1, 1]) {
      if (w < 3 || d < 3) {
        const narrowX = w < d;
        tree(px + (narrowX ? 0 : side * w * 0.3),
          pz + (narrowX ? side * d * 0.3 : 0), 1.45, detail + side * 0.1);
      } else {
        tree(px + side * w * 0.28, pz - d * 0.27, 2.25, detail + side * 0.1);
        tree(px + side * w * 0.28, pz + d * 0.27, 1.95, 1 - detail);
        box([px + side * w * 0.27, 0.5, pz], [1.65, 0.16, 0.46], benchMaterial);
        box([px + side * w * 0.27, 0.9, pz - 0.19], [1.65, 0.6, 0.12], benchMaterial);
      }
    }
  });
  layout.modelPlacements.forEach(parcel =>
    box([parcel.x + 0.16, 0.095, parcel.z + 0.18],
      [parcel.width, 0.025, parcel.depth], contact));

  const extras: Three.Object3D[] = [];
  if (canopies.length) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material, canopies.length);
    const transform = new THREE.Object3D();
    canopies.forEach((canopy, index) => {
      transform.position.set(...canopy.position);
      transform.scale.set(...canopy.scale);
      transform.rotation.set(0, canopy.rotation, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, new THREE.Color(canopy.colour));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    extras.push(mesh);
  }
  return { buildingCount: layout.modelPlacements.length, parkCount: typeCounts.park,
    bridges: 0, typeCounts, extras, modelPlacements: layout.modelPlacements, layout,
    constructionSite: null as null | { position: Position; width: number; depth: number } };
}
