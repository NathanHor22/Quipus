import type * as Three from "three";
import { flightPhase } from "./city-motion";
import { loadCityAsset, disposeCityAsset } from "./city-assets";

type Position = readonly [number, number, number];
type BoxWriter = (position: Position, size: Position, material: Three.Material, rotation?: number) => void;
type TrailEmitter = (source: number, point: Three.Vector3, tangent: Three.Vector3, time: number, moving: boolean) => void;
type Materials = { white: Three.Material; pearl: Three.Material; navy: Three.Material; red: Three.Material };

export function buildCityAerial(
  THREE: typeof import("three"), parent: Three.Group, box: BoxWriter, materials: Materials,
  emitTrail: TrailEmitter,
) {
  const historyDock = new THREE.Vector3(27, 23.3, -25);
  const reportDock = new THREE.Vector3(-1, 16.8, -16);
  [historyDock, reportDock].forEach((point) => {
    box([point.x, point.y - 1.4, point.z - .2], [4.5, 2, 4.1], materials.navy);
    box([point.x, point.y - .45, point.z], [5.1, .14, 4.8], materials.pearl);
    box([point.x - 2.42, point.y + .76, point.z - .9], [.24, 2.25, 2.3], materials.white);
    box([point.x + 2.42, point.y + .76, point.z - .9], [.24, 2.25, 2.3], materials.white);
    box([point.x, point.y + 1.92, point.z - .1], [5.3, .2, 4.8], materials.pearl);
    box([point.x, point.y + 1.8, point.z + 2.3], [5.1, .065, .07], materials.red);
    box([point.x, point.y - .35, point.z], [4.5, .045, 4.2], materials.navy);
    box([point.x - 2.18, point.y - .31, point.z], [.065, .045, 4.2], materials.red);
    box([point.x + 2.18, point.y - .31, point.z], [.065, .045, 4.2], materials.red);
    box([point.x, point.y - .3, point.z], [1.2, .045, .07], materials.white);
    box([point.x, point.y - .3, point.z - .45], [.07, .045, 1], materials.white);
  });
  const curve = (points: number[][], closed = false) => new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), closed, "catmullrom", .3,
  );
  const flights = [
    {
      curve: curve([[27, 23.3, -25], [27, 23.6, -20], [28, 38, -12], [62, 45, -45], [83, 44, 24], [28, 40, 43], [27, 31.3, -15], [27, 23.75, -21], [27, 23.3, -25]]),
      cycle: 72, offset: 53, hold: 5.5, previousDocked: false, cue: true,
    },
    {
      curve: curve([[-1, 16.8, -16], [-1, 17.1, -11], [-4, 38, -3], [-46, 42, -57], [-58, 44, 27], [6, 40, 41], [-1, 24.8, -6], [-1, 17.25, -12], [-1, 16.8, -16]]),
      cycle: 96, offset: 18, hold: 5, previousDocked: false, cue: false,
    },
    {
      curve: curve([[-111, 43, -78], [-30, 46, -98], [112, 45, -71], [119, 40, 28], [-110, 42, 41]], true),
      cycle: 34, offset: 7, hold: 0, previousDocked: false, cue: false,
    },
    {
      curve: curve([[-83, 38, 45], [-48, 43, -84], [92, 42, -64], [91, 38, 45]], true),
      cycle: 44, offset: 19, hold: 0, previousDocked: false, cue: false,
    },
  ];
  const fallback = new THREE.Group();
  parent.add(fallback);
  const suppliedShips = new THREE.Group();
  parent.add(suppliedShips);
  const parts: { mesh: Three.InstancedMesh; local: Three.Matrix4 }[] = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .45, metalness: .17 });
  const bodies = new THREE.InstancedMesh(geometry, bodyMaterial, flights.length);
  const wings = new THREE.InstancedMesh(geometry, materials.pearl, flights.length);
  const cabins = new THREE.InstancedMesh(geometry, materials.navy, flights.length);
  const tails = new THREE.InstancedMesh(geometry, materials.red, flights.length);
  [bodies, wings, cabins, tails].forEach((mesh) => {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    fallback.add(mesh);
  });
  [0xbcbcbc, 0xffffff, 0x7e7e7e, 0xd6d6d6].forEach((hex, index) => bodies.setColorAt(index, new THREE.Color(hex)));
  const dockWindows = new THREE.InstancedMesh(
    geometry, new THREE.MeshBasicMaterial({ color: 0xffffff }), 2,
  );
  [historyDock, reportDock].forEach((dock, index) => {
    const window = new THREE.Object3D();
    window.position.set(dock.x, dock.y + .63, dock.z - 2.1);
    window.scale.set(4.45, 1.13, .055);
    window.updateMatrix();
    dockWindows.setMatrixAt(index, window.matrix);
    dockWindows.setColorAt(index, new THREE.Color(0x343434));
  });
  dockWindows.instanceMatrix.needsUpdate = true;
  dockWindows.computeBoundingSphere();
  parent.add(dockWindows);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const localOffset = new THREE.Vector3();
  const orientation = new THREE.Object3D();
  const placement = new THREE.Object3D();
  const worldPlacement = new THREE.Matrix4();
  const load = async (signal: AbortSignal) => {
    const root = await loadCityAsset(THREE, "/landing/quipus-city-shuttle.glb", signal);
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(object.geometry, object.material, flights.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      suppliedShips.add(mesh);
      parts.push({ mesh, local: object.matrixWorld.clone() });
    });
    if (parts.length === 0) {
      disposeCityAsset(THREE, root);
      throw new Error("Empty shuttle model");
    }
    fallback.visible = false;
  };
  const update = (time: number, reduced: boolean) => {
    let arrived = false;
    flights.forEach((flight, index) => {
      const phase = flightPhase(reduced ? 0 : time, flight.cycle, flight.offset, flight.hold);
      flight.curve.getPoint(phase.progress, point);
      flight.curve.getTangent(phase.progress, tangent);
      flight.curve.getTangent(Math.min(.9999, phase.progress + .012), ahead);
      const heading = Math.atan2(tangent.x, tangent.z);
      const nextHeading = Math.atan2(ahead.x, ahead.z);
      const turn = Math.atan2(Math.sin(nextHeading - heading), Math.cos(nextHeading - heading));
      const bank = phase.docked ? 0 : THREE.MathUtils.clamp(-turn * 1.8, -.34, .34);
      const pitch = phase.docked ? 0 : THREE.MathUtils.clamp(Math.asin(tangent.y) * .35, -.3, .3);
      orientation.rotation.set(-pitch, heading, bank, "YXZ");
      orientation.updateMatrix();
      if (index < 2 && !reduced) emitTrail(index, point, tangent, time, !phase.docked);
      if (parts.length > 0) {
        orientation.position.copy(point);
        orientation.scale.setScalar(index < 2 ? 1 : .82);
        orientation.updateMatrix();
        parts.forEach(({ mesh, local }) => {
          worldPlacement.multiplyMatrices(orientation.matrix, local);
          mesh.setMatrixAt(index, worldPlacement);
        });
      } else for (const [mesh, x, y, z, sx, sy, sz] of [
        [bodies, 0, .04, 0, 1.22, .42, 2.6],
        [wings, 0, -.11, .15, 3.3, .1, .72],
        [cabins, 0, .32, -.19, .82, .22, 1.15],
        [tails, 0, .02, -1.16, 1.7, .12, .28],
      ] as const) {
        localOffset.set(x, y, z).applyQuaternion(orientation.quaternion);
        placement.position.copy(point).add(localOffset);
        placement.quaternion.copy(orientation.quaternion);
        placement.scale.set(sx, sy, sz);
        placement.updateMatrix();
        mesh.setMatrixAt(index, placement.matrix);
      }
      // A lit dock pane provides the arrival beat without real-time lights.
      if (index < 2 && phase.docked !== flight.previousDocked) {
        dockWindows.setColorAt(index, new THREE.Color(phase.docked ? 0xf2dfe0 : 0x343434));
        if (dockWindows.instanceColor) dockWindows.instanceColor.needsUpdate = true;
      }
      if (flight.cue && phase.docked && !flight.previousDocked && !reduced) arrived = true;
      flight.previousDocked = phase.docked;
    });
    if (parts.length > 0) parts.forEach(({ mesh }) => { mesh.instanceMatrix.needsUpdate = true; });
    else [bodies, wings, cabins, tails].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
    return arrived ? historyDock : null;
  };
  return { update, load };
}
