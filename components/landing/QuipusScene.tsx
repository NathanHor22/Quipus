"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type * as Three from "three";
import { CITY_DESTINATIONS, PRODUCT_FEATURES, type CityDestination, type ProductFeature } from "./city";
import { buildCityArchitecture } from "./city-architecture";
import { buildCityAerial } from "./city-aerial";
import { buildVehicleTrails } from "./city-trails";
import { loadCityAsset, disposeCityAsset } from "./city-assets";
import { roadRoute, roadPosition, advanceCar, trafficColour } from "./city-motion";
import styles from "./city-scene.module.css";

export type { CityDestination, ProductFeature } from "./city";
export type QuipusSceneProps = {
  destination: CityDestination | null;
  onDestinationChange: (destination: CityDestination) => void;
  reducedMotion: boolean;
  feature?: ProductFeature;
  onFeatureChange?: (feature: ProductFeature) => void;
  resetSequence?: number;
  rotationCommand?: { direction: "left" | "right" | "reset"; sequence: number };
  onReady?: () => void;
  onUnavailable?: () => void;
};
type SceneRuntime = { sync: () => void };
type PrototypeRequest = {
  promise: Promise<ArrayBuffer>;
  controller: AbortController;
  consumers: Set<symbol>;
  settled: boolean;
};
let prototypeBytes: ArrayBuffer | undefined;
let prototypeRequest: PrototypeRequest | undefined;

/** Cache bounded bytes, never GPU resources owned by another canvas. */
function getPrototypeBytes(signal: AbortSignal): Promise<ArrayBuffer> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (prototypeBytes) return Promise.resolve(prototypeBytes);
  if (!prototypeRequest) {
    const controller = new AbortController();
    const pending: PrototypeRequest = {
      controller, consumers: new Set(), settled: false,
      promise: Promise.resolve(new ArrayBuffer(0)),
    };
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    pending.promise = fetch("/landing/quipus-prototype.glb", {
      signal: controller.signal, credentials: "omit",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Prototype model unavailable");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 16 * 1024 * 1024) throw new Error("Prototype asset exceeds its budget");
      prototypeBytes = buffer;
      return buffer;
    }).finally(() => {
      pending.settled = true;
      window.clearTimeout(timeout);
      if (prototypeRequest === pending) prototypeRequest = undefined;
    });
    prototypeRequest = pending;
  }
  const pending = prototypeRequest;
  const consumer = Symbol();
  pending.consumers.add(consumer);
  return new Promise((resolve, reject) => {
    const release = () => {
      pending.consumers.delete(consumer);
      signal.removeEventListener("abort", abort);
      if (!pending.settled && pending.consumers.size === 0) {
        if (prototypeRequest === pending) prototypeRequest = undefined;
        pending.controller.abort();
      }
    };
    const abort = () => {
      release();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.promise.then((buffer) => {
      release();
      if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      else resolve(buffer);
    }, (error: unknown) => { release(); reject(error); });
  });
}

/** One city, camera and renderer; HTML markers provide accessible controls. */
export default function QuipusScene(props: QuipusSceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const markerElements = useRef(new Map<CityDestination, HTMLButtonElement>());
  const featureElements = useRef(new Map<ProductFeature, HTMLButtonElement>());
  const lineElements = useRef(new Map<ProductFeature, SVGPathElement>());
  const dotElements = useRef(new Map<ProductFeature, SVGCircleElement>());
  const latest = useRef(props);
  const runtime = useRef<SceneRuntime | null>(null);
  const dragHintElement = useRef<HTMLDivElement>(null);
  const arrivalCueElement = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { latest.current = props; });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const host = element;
    let disposed = false;
    let unavailable = false;
    let teardown: (() => void) | undefined;
    const reportUnavailable = () => {
      if (disposed || unavailable) return;
      unavailable = true;
      host.dataset.state = "unavailable";
      latest.current.onUnavailable?.();
    };

    async function initialize() {
      const THREE = await import("three");
      if (disposed) return;
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      let renderer: Three.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas, alpha: true, antialias: true, powerPreference: "low-power",
        });
      } catch { reportUnavailable(); return; }
      if (disposed) { renderer.dispose(); return; }
      host.prepend(canvas);
      host.dataset.state = "initializing";
      teardown = () => { renderer.dispose(); canvas.remove(); };
      renderer.setClearColor(0xffffff, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xffffff, 120, 220);
      const camera = new THREE.OrthographicCamera(-50, 50, 28, -28, .1, 300);
      const city = new THREE.Group();
      const background = new THREE.Group();
      city.add(background);
      scene.add(city);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b8b8, 2.7));
      const sunlight = new THREE.DirectionalLight(0xffffff, 3.6);
      sunlight.position.set(-35, 70, 40);
      const rim = new THREE.DirectionalLight(0xffffff, 1.3);
      rim.position.set(45, 20, -30);
      scene.add(sunlight, rim);
      const box = new THREE.BoxGeometry(1, 1, 1);
      const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .75 });
      const pearl = new THREE.MeshStandardMaterial({ color: 0xe4e4e4, roughness: .7 });
      const slate = new THREE.MeshStandardMaterial({ color: 0xababab, roughness: .7 });
      const navy = new THREE.MeshStandardMaterial({ color: 0x343434, roughness: .5, metalness: .12 });
      const red = new THREE.MeshStandardMaterial({ color: 0xc40012, roughness: .3, metalness: .14 });
      const redGlass = new THREE.MeshStandardMaterial({
        color: 0xcd001b, transparent: true, opacity: .63,
        roughness: .22, metalness: .12, depthWrite: false,
      });
      const roseGlass = new THREE.MeshStandardMaterial({
        color: 0xf23e48, transparent: true, opacity: .42, roughness: .3, depthWrite: false,
      });
      const darkRedGlass = new THREE.MeshStandardMaterial({
        color: 0x81021c, transparent: true, opacity: .73, roughness: .35, depthWrite: false,
      });
      const contact = new THREE.MeshBasicMaterial({
        color: 0x7e7e7e, transparent: true, opacity: .1, depthWrite: false,
      });
      const staticBoxes = new Map<Three.Material, Three.Matrix4[]>();
      const transform = new THREE.Object3D();
      const staticBox = (
        position: readonly [number, number, number],
        size: readonly [number, number, number],
        material: Three.Material,
        rotation = 0,
      ) => {
        transform.position.set(...position);
        transform.scale.set(...size);
        transform.rotation.set(0, rotation, 0);
        transform.updateMatrix();
        const batch = staticBoxes.get(material) ?? [];
        batch.push(transform.matrix.clone());
        staticBoxes.set(material, batch);
      };
      const meshBox = (
        parent: Three.Object3D, position: readonly [number, number, number],
        size: readonly [number, number, number], material: Three.Material,
      ) => {
        const mesh = new THREE.Mesh(box, material);
        mesh.position.set(...position);
        mesh.scale.set(...size);
        parent.add(mesh);
        return mesh;
      };

      const architecture = buildCityArchitecture(THREE, staticBox, {
        white, pearl, slate, navy, red, contact,
      });
      host.dataset.buildings = String(architecture.buildingCount);
      architecture.extras.forEach((object) => background.add(object));
      host.dataset.cityArchetypes = Object.keys(architecture.typeCounts).join(",");
      const cityAssetRequest = new AbortController();
      const constructionSite = architecture.constructionSite;
      const construction = new THREE.Group();
      const constructionFallback = new THREE.Group();
      const siteWidth = constructionSite?.width ?? 0;
      if (constructionSite) {
        construction.position.set(...constructionSite.position);
        // Keep a readable frame when the small optional model cannot load.
        construction.add(constructionFallback);
        for (let level = 0; level < 3; level++) {
          meshBox(constructionFallback, [0, level * 1.35 + .12, 0], [siteWidth, .14, siteWidth * .67], pearl);
          for (const x of [-1, 1]) for (const z of [-1, 1]) {
            meshBox(constructionFallback, [x * siteWidth * .43, level * 1.35 + .78, z * siteWidth * .27], [.19, 1.3, .19], slate);
          }
        }
        background.add(construction);
      }
      type Landmark = {
        id: CityDestination; hit: Three.Mesh; anchor: Three.Vector3;
        accent: Three.MeshStandardMaterial; halo: Three.MeshBasicMaterial;
      };
      const landmarks: Landmark[] = [];
      const showroom = new THREE.Group();
      const showroomBaseY = 8.5;
      showroom.position.set(8, showroomBaseY, 14);
      city.add(showroom);
      const placeholder = new THREE.Group();
      showroom.add(placeholder);
      meshBox(placeholder, [0, 0, 0], [7.7, 9.4, 3.15], white);
      meshBox(placeholder, [0, .65, 1.6], [6.6, 6.4, .13], navy);
      meshBox(placeholder, [0, -3.1, 1.7], [4.3, .08, .04], red);
      for (let index = 0; index < 4; index++) {
        meshBox(placeholder, [-2.4 + index * 1.6, 4.15, 1.66], [.36, .36, .05], navy);
      }
      meshBox(placeholder, [3.89, -.7, 0], [.08, 2.6, 1.6], navy);

      CITY_DESTINATIONS.forEach((item, index) => {
        const [x, , z] = item.position;
        const height = item.height;
        staticBox([x + .6, .08, z + .8], [12.7, .06, 11.5], contact);
        staticBox([x, .3, z], [12.1, .6, 10.9], pearl);
        staticBox([x, .7, z], [11.5, .22, 10.2], white);
        const accent = red.clone();
        accent.emissive.set(0x65000b);
        const halo = new THREE.MeshBasicMaterial({
          color: 0xc40012, transparent: true, opacity: .18, depthWrite: false,
        });
        meshBox(background, [x, .87, z + 5.2], [11.2, .06, .38], halo);
        if (item.id === "device") {
          staticBox([x, 1.6, z], [10.5, 1.6, 7.5], white);
          meshBox(background, [x, 2.45, z], [10.8, .11, 7.8], accent);
          staticBox([x - 5.6, 3.8, z - 2], [.5, 6.4, .5], pearl);
          staticBox([x + 5.6, 3.8, z - 2], [.5, 6.4, .5], pearl);
        } else if (item.id === "capture") {
          staticBox([x, height / 2 + .85, z], [7.8, height, 7.1], white);
          staticBox([x - 3.3, height + 1.4, z], [1.2, 1.3, 7.7], pearl);
          staticBox([x + 3.3, height + 1.4, z], [1.2, 1.3, 7.7], pearl);
          meshBox(background, [x, height + 2.08, z], [9, .16, 8], accent);
          meshBox(background, [x, height / 2 + .9, z + 3.58], [6.1, height * .7, .08], redGlass);
          for (let band = 0; band < 5; band++) {
            staticBox([x, 2.2 + band * 1.2, z + 3.67], [5.7, .1, .07], pearl);
          }
        } else if (item.id === "understand") {
          staticBox([x - 2.8, height / 2 + .8, z], [3.9, height, 6.5], white);
          staticBox([x + 2.8, height * .4 + .8, z], [3.9, height * .8, 6.5], white);
          meshBox(background, [x, height * .65, z], [8.9, .5, 6.9], accent);
          meshBox(background, [x, height / 2 + .8, z + 3.31], [1.5, height * .8, .09], darkRedGlass);
          staticBox([x - 2.8, height + .95, z], [4.4, .3, 6.9], pearl);
          staticBox([x + 2.8, height * .8 + .95, z], [4.4, .3, 6.9], pearl);
        } else if (item.id === "follow-up") {
          staticBox([x, height / 2 + .8, z], [7.5, height, 6.6], white);
          staticBox([x, height + 1.6, z], [5.8, 1.6, 5], pearl);
          const fin = meshBox(background, [x + 4.1, height / 2 + 1, z], [.17, height + 2, 8.6], redGlass);
          fin.rotation.z = -.12;
          meshBox(background, [x, height + 2.47, z], [6.4, .14, 5.6], accent);
          for (let band = 0; band < 3; band++) {
            staticBox([x, 3.2 + band * 2.6, z + 3.35], [6.8, .13, .12], slate);
          }
        } else if (item.id === "about") {
          staticBox([x, height * .32 + .8, z], [9.6, height * .64, 8.3], white);
          staticBox([x - 2.2, height * .81 + .8, z - 1], [4.5, height * .34, 5.8], pearl);
          staticBox([x + 2.8, height * .49 + .8, z + 1.2], [3.6, height * .28, 4.2], white);
          meshBox(background, [x, height * .65 + 1, z + 4.2], [8.4, .12, .08], accent);
          staticBox([x - 2.2, height + 1.04, z - 1], [4.8, .25, 6.1], white);
        } else if (item.id === "privacy") {
          staticBox([x - 3.2, height / 2 + .8, z], [2.1, height, 7.4], white);
          staticBox([x + 3.2, height / 2 + .8, z], [2.1, height, 7.4], white);
          staticBox([x, height * .43 + .8, z], [4.4, height * .86, 6.4], navy);
          staticBox([x, height + .95, z], [9.2, .35, 7.8], pearl);
          meshBox(background, [x, height + 1.18, z], [7.8, .1, 6.9], accent);
          for (let band = 0; band < 4; band++) {
            staticBox([x, 2.4 + band * height * .19, z + 3.27], [4.2, .08, .09], slate);
          }
        } else if (item.id === "terms") {
          staticBox([x, height * .44 + .8, z], [8.1, height * .88, 6.8], white);
          for (let band = 0; band < 4; band++) {
            staticBox([x + (band % 2 ? .4 : -.4), 1.6 + band * height * .24, z], [9.8, .38, 8], pearl);
          }
          meshBox(background, [x, height + 1.18, z], [8.3, .1, 6.7], accent);
          staticBox([x, height * .45, z + 3.43], [6.6, height * .62, .08], navy);
        } else {
          staticBox([x, height / 2 + .8, z], [7.7, height, 7.3], white);
          staticBox([x, height * .78, z], [9.5, .6, 9], pearl);
          staticBox([x, height + 1.65, z], [5.9, 1.8, 5.9], white);
          meshBox(background, [x, height + 2.62, z], [6.2, .13, 6.2], accent);
          meshBox(background, [x, height / 2 + .9, z + 3.7], [1.1, height * .86, .08], redGlass);
          for (let band = 0; band < 5; band++) {
            staticBox([x, 2.8 + band * 3.1, z + 3.72], [6.5, .09, .08], slate);
          }
        }
        const hit = new THREE.Mesh(
          new THREE.BoxGeometry(12, height + 3.5, 11),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hit.position.set(x, (height + 3.5) / 2, z);
        hit.userData.destination = item.id;
        background.add(hit);
        landmarks.push({
          id: item.id, hit, accent, halo,
          anchor: new THREE.Vector3(x, height + (index === 0 ? 2 : 3.3), z),
        });
      });
      const trails = buildVehicleTrails(THREE, background);
      const shardGeometry = new THREE.TetrahedronGeometry(.36);
      const shardMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: .35, metalness: .1,
        transparent: true, opacity: .86, depthWrite: false,
      });
      const shardColours = [0x7f0719, 0xa10819, 0xc40016, 0xe21c2c, 0xf6575d];
      const ambientCount = 6;
      const ambientShards = new THREE.InstancedMesh(shardGeometry, shardMaterial, ambientCount);
      ambientShards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ambientShards.frustumCulled = false;
      for (let index = 0; index < ambientCount; index++) {
        ambientShards.setColorAt(index, new THREE.Color(shardColours[(index * 3) % shardColours.length]));
      }
      background.add(ambientShards);
      for (let index = 0; index < 4; index++) {
        const fin = meshBox(background, [-38 + index * 12, 5 + index % 3, -36 + index % 3 * 15],
          [.12, 10 + index % 3 * 2, 4], index % 2 ? roseGlass : redGlass);
        fin.rotation.z = index % 2 ? -.16 : .09;
      }

      // Sparse stylised traffic follows a single fixed road loop. Cars pause at
      // the paired lights; no physics, path-finding, collisions or dynamic lights.
      const road = roadRoute([
        { x: -30, z: -30 }, { x: 40, z: -30 }, { x: 40, z: 30 }, { x: -30, z: 30 },
      ]);
      const carCount = 7;
      const carMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .65, metalness: .1 });
      const carBodies = new THREE.InstancedMesh(box, carMaterial, carCount);
      const carCabins = new THREE.InstancedMesh(box, slate, carCount);
      const carBases = new THREE.InstancedMesh(box, navy, carCount);
      const carColours = [0x858585, 0xb3b3b3, 0xe8e8e8, 0x3c3c3c];
      const cars = Array.from({ length: carCount }, (_, index) => ({ distance: index * road.length / carCount }));
      [carBodies, carCabins, carBases].forEach((mesh) => {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        background.add(mesh);
      });
      for (let index = 0; index < carCount; index++) {
        carBodies.setColorAt(index, new THREE.Color(carColours[index % carColours.length]));
      }
      const signals: { x: number; z: number; axis: "x" | "z"; offset: number; previous: string }[] = [];
      road.segments.forEach((segment) => {
        (["x", "z"] as const).forEach((axis, index) => {
          const x = segment.end.x + (index ? 1.2 : -1.2);
          const z = segment.end.z + (index ? -1.2 : 1.2);
          staticBox([x, .73, z], [.13, 1.46, .13], navy);
          staticBox([x, 1.58, z], [.3, .74, .28], navy);
          signals.push({ x, z, axis, offset: segment.lightOffset, previous: "" });
        });
      });
      const signalLamps = new THREE.InstancedMesh(
        new THREE.SphereGeometry(.09, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        signals.length * 3,
      );
      signals.forEach((signal, index) => {
        for (let lamp = 0; lamp < 3; lamp++) {
          transform.position.set(signal.x, 1.82 - lamp * .24, signal.z + .17);
          transform.rotation.set(0, 0, 0);
          transform.scale.setScalar(1);
          transform.updateMatrix();
          signalLamps.setMatrixAt(index * 3 + lamp, transform.matrix);
        }
      });
      background.add(signalLamps);
      const shadowCanvas = document.createElement("canvas");
      shadowCanvas.width = shadowCanvas.height = 96;
      const shadowContext = shadowCanvas.getContext("2d");
      if (shadowContext) {
        const gradient = shadowContext.createRadialGradient(48, 48, 5, 48, 48, 46);
        gradient.addColorStop(0, "rgba(13,35,60,.48)");
        gradient.addColorStop(.5, "rgba(13,35,60,.2)");
        gradient.addColorStop(1, "rgba(13,35,60,0)");
        shadowContext.fillStyle = gradient;
        shadowContext.fillRect(0, 0, 96, 96);
      }
      const productShadowMaterial = new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true, opacity: .57, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      const productShadow = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 6.1), productShadowMaterial);
      productShadow.rotation.x = -Math.PI / 2;
      productShadow.position.set(8, 2.525, 14);
      city.add(productShadow);
      const decorationTransform = new THREE.Object3D();
      const carTrailPoint = new THREE.Vector3();
      const carTrailTangent = new THREE.Vector3();
      const updateDecorations = (time: number, delta: number, reduced: boolean) => {
        const drift = reduced ? 0 : time;
        for (let index = 0; index < ambientCount; index++) {
          const phase = index * .7;
          decorationTransform.position.set(
            -35 + index * 8.2 + Math.sin(drift * .25 + phase) * 1.1,
            12 + index % 3 * 2.4 + Math.sin(drift * .34 + phase) * .6,
            26 - index % 5 * 9,
          );
          decorationTransform.rotation.set(index * .29, index * .37 + drift * .1, phase + drift * .13);
          decorationTransform.scale.set(1.6, .5, .85);
          decorationTransform.updateMatrix();
          ambientShards.setMatrixAt(index, decorationTransform.matrix);
        }
        ambientShards.instanceMatrix.needsUpdate = true;
        cars.forEach((car, index) => {
          const previousDistance = car.distance;
          if (!reduced) car.distance = advanceCar(road, car.distance, 1.7, delta, time);
          const position = roadPosition(road, car.distance);
          const x = position.x + Math.cos(position.heading) * .7;
          const z = position.z - Math.sin(position.heading) * .7;
          if (index === 0 && !reduced) {
            carTrailPoint.set(x, .45, z);
            carTrailTangent.set(Math.sin(position.heading), 0, Math.cos(position.heading));
            trails.emit(2, carTrailPoint, carTrailTangent, time, car.distance !== previousDistance);
          }
          decorationTransform.rotation.set(0, position.heading, 0);
          for (const [mesh, y, sx, sy, sz] of [
            [carBodies, .35, .9, .32, 1.85],
            [carCabins, .62, .71, .26, .86],
            [carBases, .16, 1, .14, 1.86],
          ] as const) {
            decorationTransform.position.set(x, y, z);
            decorationTransform.scale.set(sx, sy, sz);
            decorationTransform.updateMatrix();
            mesh.setMatrixAt(index, decorationTransform.matrix);
          }
        });
        [carBodies, carCabins, carBases].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
        let changed = false;
        signals.forEach((signal, index) => {
          const colour = trafficColour(drift, signal.axis, signal.offset);
          if (signal.previous === colour) return;
          signal.previous = colour;
          changed = true;
          ["red", "amber", "green"].forEach((lamp, lampIndex) => {
            const hex = colour === lamp
              ? lamp === "red" ? 0xc40016 : lamp === "amber" ? 0xe6b764 : 0x589a75
              : 0x343a35;
            signalLamps.setColorAt(index * 3 + lampIndex, new THREE.Color(hex));
          });
        });
        if (changed && signalLamps.instanceColor) signalLamps.instanceColor.needsUpdate = true;
      };
      const aerial = buildCityAerial(THREE, background, staticBox, { white, pearl, navy, red }, trails.emit);
      staticBoxes.forEach((matrices, material) => {
        const instances = new THREE.InstancedMesh(box, material, matrices.length);
        matrices.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
        instances.instanceMatrix.needsUpdate = true;
        instances.computeBoundingSphere();
        background.add(instances);
      });
      // Inspection has its own quiet, cheap backdrop. The detailed city keeps
      // its GPU resources cached but is not drawn while the model is inspected.
      const inspectionStage = new THREE.Group();
      inspectionStage.visible = false;
      city.add(inspectionStage);
      const quietMaterial = new THREE.MeshBasicMaterial({ color: 0xe9e9e9 });
      const quietBackdrop = new THREE.InstancedMesh(box, quietMaterial, 5);
      [
        [-20, 7, -20, 8, 14, 5], [-5, 11, -30, 7, 22, 6],
        [28, 10, -29, 8, 20, 5], [40, 6, -13, 7, 12, 5], [-31, 5, -6, 6, 10, 4],
      ].forEach(([x, y, z, sx, sy, sz], index) => {
        transform.position.set(x, y, z);
        transform.scale.set(sx, sy, sz);
        transform.rotation.set(0, 0, 0);
        transform.updateMatrix();
        quietBackdrop.setMatrixAt(index, transform.matrix);
      });
      quietBackdrop.instanceMatrix.needsUpdate = true;
      quietBackdrop.computeBoundingSphere();
      inspectionStage.add(quietBackdrop);
      const quietFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(130, 110),
        new THREE.MeshBasicMaterial({ color: 0xf7f7f7 }),
      );
      quietFloor.rotation.x = -Math.PI / 2;
      quietFloor.position.set(8, -.02, 0);
      inspectionStage.add(quietFloor);
      meshBox(inspectionStage, [8, 1.6, 14], [10.5, 1.6, 7.5], white);
      meshBox(inspectionStage, [8, .4, 14], [12.1, .55, 10.9], pearl);
      meshBox(inspectionStage, [8, 2.45, 14], [10.8, .11, 7.8], red);
      const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const projectPoint = new THREE.Vector3();
      const cameraRight = new THREE.Vector3();
      const cameraForward = new THREE.Vector3();
      const overview = { centre: new THREE.Vector3(23, 4, -9), span: 65 };
      const currentTarget = overview.centre.clone();
      const currentEye = overview.centre.clone().add(new THREE.Vector3(57, 70, 88));
      const goalTarget = currentTarget.clone();
      const goalEye = currentEye.clone();
      let currentSpan = overview.span;
      let goalSpan = overview.span;
      let width = 1;
      let height = 1;
      let frame = 0;
      let lastTime = 0;
      let activeTime = 0;
      let hoverTime = 0;
      let markersDirty = true;
      let mobileIntroductionTop: number | null = null;
      let markerLayout: { x: number; y: number; width: number; height: number }[] = [];
      let projectedDevice: boolean | undefined;
      const markerSizes = new Map<CityDestination, { width: number; height: number }>();
      const featureSizes = new Map<ProductFeature, { width: number; height: number }>();
      const anchorPoint = new THREE.Vector3();
      let arrivalUntil = 0;
      let lastArrival = -100;
      let arrivalDock: Three.Vector3 | null = null;
      let decorationTimer = 0;
      let dragHintTimer = 0;
      let lastDecorationTime = -1;
      let ready = false;
      let isIntersecting = true;
      let currentDestination: CityDestination | null | undefined;
      let lastResetSequence = latest.current.resetSequence;
      let hovered: CityDestination | null = null;
      let devicePointerUpdate = false;
      let desiredYaw = -.22;
      let productYaw = desiredYaw;
      let desiredPitch = .04;
      let productPitch = desiredPitch;
      let lastFeature: ProductFeature | undefined;
      let lastRotationSequence: number | undefined;
      let modelRequested = false;
      const modelRequest = new AbortController();
      const featureAnchors: Record<ProductFeature, Three.Vector3> = {
        // CAD coordinates, normalized to the 9.4-unit enclosure height.
        microphone: new THREE.Vector3(.46, 3.28, 1.64),
        screen: new THREE.Vector3(-.8, .26, 1.42),
        speaker: new THREE.Vector3(3.86, 0, .02),
        storage: new THREE.Vector3(-3.86, .67, .71),
        charging: new THREE.Vector3(-.8, -4.7, .55),
      };
      let gesture: {
        id: number; x: number; y: number; centre: Three.Vector3;
        yaw: number; pitch: number; moved: boolean;
      } | null = null;
      const releaseResources = (root: Three.Object3D) => {
        const geometries = new Set<Three.BufferGeometry>();
        const materials = new Set<Three.Material>();
        const textures = new Set<Three.Texture>();
        root.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
            if (object instanceof THREE.InstancedMesh) object.dispose();
            geometries.add(object.geometry);
            const assigned = Array.isArray(object.material) ? object.material : [object.material];
            assigned.forEach((material) => {
              materials.add(material);
              Object.values(material).forEach((value: unknown) => {
                if (value instanceof THREE.Texture) textures.add(value);
              });
            });
          }
        });
        textures.forEach((texture) => {
          const bitmap = texture.source?.data;
          if (typeof ImageBitmap !== "undefined" && bitmap instanceof ImageBitmap) bitmap.close();
          texture.dispose();
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
      };
      const visible = () => !disposed && !unavailable && isIntersecting && document.visibilityState !== "hidden";
      const requestFrame = () => {
        if (!visible()) return;
        window.clearTimeout(decorationTimer);
        decorationTimer = 0;
        if (!frame) frame = window.requestAnimationFrame(render);
      };
      const requestAmbient = () => {
        if (decorationTimer || !visible() || latest.current.reducedMotion || (latest.current.destination === "device" && gesture?.moved)) return;
        decorationTimer = window.setTimeout(() => {
          decorationTimer = 0;
          requestFrame();
        }, latest.current.destination === "device" ? 90 : 34);
      };
      const loadProduct = async () => {
        if (modelRequested || disposed || unavailable) return;
        modelRequested = true;
        host.dataset.model = "loading";
        try {
          const [{ GLTFLoader }, bytes] = await Promise.all([
            import("three/addons/loaders/GLTFLoader.js"), getPrototypeBytes(modelRequest.signal),
          ]);
          if (disposed || unavailable) return;
          const gltf = await new GLTFLoader().parseAsync(bytes, "/landing/");
          if (disposed || unavailable) { releaseResources(gltf.scene); return; }
          const bounds = new THREE.Box3().setFromObject(gltf.scene);
          const size = bounds.getSize(new THREE.Vector3());
          const centre = bounds.getCenter(new THREE.Vector3());
          if (!Number.isFinite(size.length()) || size.length() <= 0) {
            releaseResources(gltf.scene);
            throw new Error("Invalid prototype bounds");
          }
          gltf.scene.position.sub(centre);
          const wrapper = new THREE.Group();
          wrapper.add(gltf.scene);
          wrapper.scale.setScalar(9.4 / Math.max(size.x, size.y, size.z));
          showroom.add(wrapper);
          placeholder.visible = false;
          host.dataset.model = "loaded";
          requestFrame();
        } catch {
          if (!disposed && !unavailable) {
            host.dataset.model = "fallback";
            placeholder.visible = true;
            requestFrame();
          }
        }
      };
      const resize = () => {
        const bounds = host.getBoundingClientRect();
        if (bounds.width < 1 || bounds.height < 1) return;
        width = bounds.width;
        height = bounds.height;
        const introduction = host.closest("main")?.querySelector<HTMLElement>("[data-city-introduction]");
        const introductionRect = introduction?.getBoundingClientRect();
        mobileIntroductionTop = width < 760 && introductionRect && introductionRect.height > 0
          ? introductionRect.top - bounds.top : null;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        const area = width * height * pixelRatio * pixelRatio;
        const inspecting = latest.current.destination === "device";
        const budget = inspecting ? (finePointer.matches ? 1_100_000 : 650_000)
          : (finePointer.matches ? 1_650_000 : 900_000);
        const ratio = pixelRatio * Math.min(1, Math.sqrt(budget / area));
        renderer.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), false);
        markerElements.current.forEach((button, id) => {
          markerSizes.set(id, { width: button.offsetWidth, height: button.offsetHeight });
        });
        featureElements.current.forEach((button, id) => {
          featureSizes.set(id, { width: button.offsetWidth, height: button.offsetHeight });
        });
        markersDirty = true;
        requestFrame();
      };
      const project = (point: Three.Vector3) => {
        projectPoint.copy(point).project(camera);
        return {
          x: (projectPoint.x * .5 + .5) * width,
          y: (-projectPoint.y * .5 + .5) * height,
          inFront: projectPoint.z > -1 && projectPoint.z < 1,
        };
      };

      const updateMarkers = (device: boolean, mobile: boolean) => {
        const leftReserve = mobile ? 20 : currentDestination ? Math.min(460, Math.max(385, width * .4)) : Math.min(480, width * .34);
        const topReserve = mobile ? 102 : 122;
        const bottomReserve = mobile ? (currentDestination ? height * .5 + 18 : 105) : 35;
        const markerBottom = mobile && !currentDestination && mobileIntroductionTop !== null
          ? Math.min(height - bottomReserve, mobileIntroductionTop - 14) : height - bottomReserve;
        const placed: { x: number; y: number; width: number; height: number }[] = [];
        if (!device || projectedDevice !== device) landmarks.forEach((landmark) => {
          const button = markerElements.current.get(landmark.id);
          if (!button) return;
          const point = project(landmark.anchor);
          const size = markerSizes.get(landmark.id);
          const bw = size?.width || 170;
          const bh = size?.height || 42;
          const show = !device && point.inFront && point.x > leftReserve - 50
            && point.x < width + 25 && point.y > 30 && point.y < markerBottom + 35 && markerBottom >= topReserve + bh;
          if (!show) { button.style.visibility = "hidden"; return; }
          let x = THREE.MathUtils.clamp(point.x - bw / 2, leftReserve, width - bw - 24);
          let y = THREE.MathUtils.clamp(point.y - bh - 18, topReserve, markerBottom - bh);
          for (let attempt = 0; attempt < 5; attempt++) {
            const collision = placed.find((other) =>
              x < other.x + other.width + 8 && x + bw + 8 > other.x
              && y < other.y + other.height + 12 && y + bh + 12 > other.y);
            if (!collision) break;
            if (collision.y + collision.height + bh + 28 < markerBottom) {
              y = collision.y + collision.height + 12;
            } else {
              x = Math.max(leftReserve, collision.x - bw - 12);
            }
          }
          const crowded = placed.some((other) =>
            x < other.x + other.width + 8 && x + bw + 8 > other.x
            && y < other.y + other.height + 12 && y + bh + 12 > other.y);
          if (crowded) { button.style.visibility = "hidden"; return; }
          placed.push({ x, y, width: bw, height: bh });
          button.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
          button.style.visibility = "visible";
        });
        PRODUCT_FEATURES.forEach(({ id }) => {
          const button = featureElements.current.get(id);
          const line = lineElements.current.get(id);
          const dot = dotElements.current.get(id);
          if (!button || !line || !dot) return;
          if (!device) {
            button.style.visibility = "hidden";
            line.style.visibility = "hidden";
            dot.style.visibility = "hidden";
            return;
          }
          showroom.updateMatrixWorld(true);
          const anchor = showroom.localToWorld(anchorPoint.copy(featureAnchors[id]));
          const point = project(anchor);
          const size = featureSizes.get(id);
          const bw = size?.width || 100;
          const bh = size?.height || 35;
          const direction = id === "screen" || id === "storage" ? -1 : 1;
          let x = THREE.MathUtils.clamp(
            point.x + direction * (mobile ? 24 : 46) - (direction < 0 ? bw : 0),
            leftReserve + 4, width - bw - (mobile ? 14 : 30),
          );
          const labelOffset = { microphone: -47, screen: -22, speaker: 8, storage: 66, charging: 27 };
          let y = point.y - bh / 2 + labelOffset[id];
          y = THREE.MathUtils.clamp(y, mobile ? 116 : 150, height - bottomReserve - bh - 10);
          if (mobile && height < 680) {
            const maximumY = height - bottomReserve - bh - 6;
            x = id === "screen" || id === "storage" ? 14 : width - bw - (id === "microphone" ? 40 : 14);
            const compactY = { microphone: 80, screen: 116, speaker: 116, storage: maximumY - 20, charging: maximumY };
            y = Math.min(compactY[id], maximumY);
          }
          button.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
          button.style.visibility = point.inFront ? "visible" : "hidden";
          const endX = direction < 0 ? x + bw : x;
          const endY = y + bh / 2;
          const bend = endX + (direction < 0 ? 14 : -14);
          line.setAttribute("d", "M " + point.x + " " + point.y + " L " + bend + " " + endY + " L " + endX + " " + endY);
          dot.setAttribute("cx", String(point.x));
          dot.setAttribute("cy", String(point.y));
          line.style.visibility = point.inFront ? "visible" : "hidden";
          dot.style.visibility = point.inFront ? "visible" : "hidden";
        });
        if (!device) markerLayout = placed;
        projectedDevice = device;
      };
      function render(now: number) {
        frame = 0;
        if (!visible()) return;
        const current = latest.current;
        const reduced = current.reducedMotion;
        const mobile = width < 760;
        const delta = lastTime ? Math.min(.05, Math.max(0, (now - lastTime) / 1000)) : 1 / 60;
        lastTime = now;
        const device = current.destination === "device";
        const deviceDragging = device && Boolean(gesture?.moved);
        if (!reduced) {
          if (!device) activeTime += delta;
          if (!deviceDragging) hoverTime += delta;
        }
        background.visible = !device;
        inspectionStage.visible = device;
        if (current.resetSequence !== lastResetSequence) {
          lastResetSequence = current.resetSequence;
          overview.centre.set(23, 4, -9);
          overview.span = 65;
          desiredYaw = -.22;
          desiredPitch = .04;

        }
        if (current.destination !== currentDestination) {
          currentDestination = current.destination;
          hovered = null;
          markersDirty = true;
          resize();
          window.clearTimeout(dragHintTimer);
          host.dataset.dragHint = currentDestination === "device" ? "visible" : "";
          if (currentDestination === "device") {
            dragHintTimer = window.setTimeout(() => { host.dataset.dragHint = ""; }, 3000);
            void loadProduct();
          }
        }
        const sideReserve = Math.min(460, Math.max(385, width * .4));
        const availableWidth = Math.max(240, width - sideReserve - 30);
        if (current.feature !== lastFeature) {
          lastFeature = current.feature;
          if (current.feature) {
            const orientation: Record<ProductFeature, [number, number]> = {
              microphone: [-.15, .17], screen: [-.08, .02],
              speaker: [-1.05, .04], storage: [1.05, .04], charging: [-.16, -.18],
            };
            [desiredYaw, desiredPitch] = orientation[current.feature];
          }
        }
        const command = current.rotationCommand;
        if (command && command.sequence !== lastRotationSequence) {
          lastRotationSequence = command.sequence;
          desiredYaw = command.direction === "reset" ? -.22
            : desiredYaw + (command.direction === "left" ? -.42 : .42);
          if (command.direction === "reset") desiredPitch = .04;
        }
        if (!currentDestination) {
          goalTarget.copy(overview.centre);
          goalEye.copy(goalTarget).add(new THREE.Vector3(57, 58, 78));
          goalSpan = mobile ? overview.span * 1.98 : overview.span;
        } else if (device) {
          goalTarget.set(8, showroomBaseY + .05, 14);
          goalEye.copy(goalTarget).add(new THREE.Vector3(3, 3.6, 27));
          goalSpan = mobile ? (height < 680 ? 35 : 30) : Math.max(18.5, height * 11 / availableWidth);
        } else {
          const destination = CITY_DESTINATIONS.find((item) => item.id === currentDestination)!;
          goalTarget.set(destination.position[0], destination.height * .45, destination.position[2]);
          goalEye.copy(goalTarget).add(new THREE.Vector3(27, 28, 38));
          goalSpan = mobile ? 64 : Math.max(31, height * 14 / availableWidth);
        }
        const cameraMoving = currentEye.distanceToSquared(goalEye) > .00005
          || currentTarget.distanceToSquared(goalTarget) > .00005 || Math.abs(currentSpan - goalSpan) > .001;
        const blend = reduced ? 1 : 1 - Math.exp(-delta * 8.5);
        currentTarget.lerp(goalTarget, blend);
        currentEye.lerp(goalEye, blend);
        currentSpan = THREE.MathUtils.lerp(currentSpan, goalSpan, blend);
        // The model follows the pointer directly; only deliberate view changes ease.
        productYaw = deviceDragging || devicePointerUpdate ? desiredYaw : THREE.MathUtils.lerp(productYaw, desiredYaw, blend);
        productPitch = deviceDragging || devicePointerUpdate ? desiredPitch : THREE.MathUtils.lerp(productPitch, desiredPitch, blend);
        devicePointerUpdate = false;
        showroom.rotation.set(productPitch, productYaw, 0);
        const aspect = width / Math.max(1, height);
        const horizontalFocus = mobile ? .5 : currentDestination ? .5 + sideReserve / (2 * width) : .66;
        const verticalFocus = mobile && currentDestination ? .27 : mobile ? .38 : .51;
        camera.left = -currentSpan * aspect * horizontalFocus;
        camera.right = currentSpan * aspect * (1 - horizontalFocus);
        camera.top = currentSpan * verticalFocus;
        camera.bottom = -currentSpan * (1 - verticalFocus);
        camera.position.copy(currentEye);
        camera.lookAt(currentTarget);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        let highlightMoving = false;
        if (!device) landmarks.forEach((landmark) => {
          const selected = currentDestination === landmark.id;
          const over = hovered === landmark.id;
          const glow = over ? .55 : selected ? .3 : .04;
          const opacity = over ? .78 : selected ? .58 : .18;
          landmark.accent.emissiveIntensity = THREE.MathUtils.lerp(landmark.accent.emissiveIntensity, glow, blend);
          landmark.halo.opacity = THREE.MathUtils.lerp(landmark.halo.opacity, opacity, blend);
          if (Math.abs(landmark.halo.opacity - opacity) > .002) highlightMoving = true;
        });
        // Inspection pauses the illustrated city entirely. Only the tiny
        // hover transform changes at rest; a drag does no decorative buffer work.
        if (!device && (reduced || lastDecorationTime < 0 || activeTime - lastDecorationTime >= 1 / 24)) {
          const decorationDelta = lastDecorationTime < 0 ? 0 : activeTime - lastDecorationTime;
          updateDecorations(activeTime, decorationDelta, reduced);
          const arrived = aerial.update(activeTime, reduced);
          trails.update(activeTime, reduced);
          if (arrived && !currentDestination && activeTime - lastArrival > 28) {
            arrivalDock = arrived;
            arrivalUntil = activeTime + 2.2;
            lastArrival = activeTime;
          }
          lastDecorationTime = activeTime;
        }
        if (!deviceDragging) {
          const hover = reduced ? 0 : Math.sin(hoverTime * .7) * .09;
          showroom.position.y = showroomBaseY + hover;
          productShadowMaterial.opacity = .57 - hover * .6;
        }
        try {
          renderer.render(scene, camera);
          if (device || markersDirty || cameraMoving) {
            updateMarkers(device, mobile);
            markersDirty = false;
          }
          const arrival = arrivalCueElement.current;
          host.dataset.cityArrival = !device && !currentDestination && !reduced && activeTime < arrivalUntil ? "visible" : "";
          if (arrival && arrivalDock && host.dataset.cityArrival) {
            const point = project(anchorPoint.copy(arrivalDock).add(new THREE.Vector3(0, 1.2, 0)));
            const cueX = THREE.MathUtils.clamp(point.x - 70, mobile ? 20 : 485, width - 185);
            let cueY = THREE.MathUtils.clamp(point.y + 56, mobile ? 120 : 176, mobile ? height * .43 : height - 85);
            const cueWidth = mobile ? 146 : 166;
            const cueHeight = 52;
            for (let attempt = 0; attempt < 4; attempt++) {
              const nearby = markerLayout.find((marker) =>
                cueX < marker.x + marker.width + 10 && cueX + cueWidth + 10 > marker.x
                && cueY < marker.y + marker.height + 10 && cueY + cueHeight + 10 > marker.y);
              if (!nearby) break;
              cueY = nearby.y + nearby.height + 14;
            }
            const bottomLimit = mobile ? (mobileIntroductionTop ?? height * .5) - 10 : height - 40;
            if (cueY + cueHeight > bottomLimit) host.dataset.cityArrival = "";
            arrival.style.transform = "translate3d(" + Math.round(cueX) + "px," + Math.round(cueY) + "px,0)";
          }
          const hint = dragHintElement.current;
          if (device && hint) {
            const anchor = showroom.localToWorld(anchorPoint.set(-.8, -1.3, 2));
            const point = project(anchor);
            hint.style.transform = "translate3d(" + Math.round(point.x) + "px," + Math.round(point.y) + "px,0) translate(-50%,-50%)";
          }
          if (!ready) {
            ready = true;
            host.dataset.state = "ready";
            latest.current.onReady?.();
          }
        } catch {
          canvas.style.visibility = "hidden";
          reportUnavailable();
          return;
        }
        const moving = currentEye.distanceToSquared(goalEye) > .00005
          || currentTarget.distanceToSquared(goalTarget) > .00005
          || Math.abs(currentSpan - goalSpan) > .001
          || Math.abs(productYaw - desiredYaw) > .0002
          || Math.abs(productPitch - desiredPitch) > .0002 || highlightMoving;
        if (!reduced) {
          if (moving) requestFrame();
          else requestAmbient();
        }
      }
      const pick = (event: PointerEvent) => {
        const bounds = canvas.getBoundingClientRect();
        pointer.set(
          (event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1,
          -(event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(landmarks.map((landmark) => landmark.hit), false)[0];
        return hit ? hit.object.userData.destination as CityDestination : null;
      };
      const onDown = (event: PointerEvent) => {
        if (!visible() || !event.isPrimary || event.button !== 0) return;
        gesture = {
          id: event.pointerId, x: event.clientX, y: event.clientY,
          centre: overview.centre.clone(), yaw: productYaw, pitch: productPitch, moved: false,
        };
        canvas.setPointerCapture(event.pointerId);
      };
      const onMove = (event: PointerEvent) => {
        if (!visible()) return;
        if (gesture && gesture.id === event.pointerId) {
          const dx = event.clientX - gesture.x;
          const dy = event.clientY - gesture.y;
          if (Math.hypot(dx, dy) > 7) gesture.moved = true;
          if (gesture.moved) {
            canvas.style.cursor = "grabbing";
            if (latest.current.destination === "device") {
              window.clearTimeout(dragHintTimer);
              host.dataset.dragHint = "";
              devicePointerUpdate = true;
              desiredYaw = gesture.yaw + dx * .009;
              desiredPitch = THREE.MathUtils.clamp(gesture.pitch + dy * .004, -.28, .3);
            } else if (!latest.current.destination) {
              cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
              cameraForward.setFromMatrixColumn(camera.matrixWorld, 1);
              cameraForward.y = 0;
              cameraForward.normalize();
              const units = currentSpan / height;
              overview.centre.copy(gesture.centre)
                .addScaledVector(cameraRight, -dx * units)
                .addScaledVector(cameraForward, dy * units * 1.3);
              overview.centre.x = THREE.MathUtils.clamp(overview.centre.x, -40, 63);
              overview.centre.z = THREE.MathUtils.clamp(overview.centre.z, -56, 30);
            }
            requestFrame();
          }
          return;
        }
        if (!finePointer.matches || event.pointerType === "touch") return;
        const next = latest.current.destination === "device" ? null : pick(event);
        if (next !== hovered) {
          hovered = next;
          host.dataset.hoveredDestination = next ?? "";
          canvas.style.cursor = next ? "pointer" : "grab";

          requestFrame();
        }
      };
      const onUp = (event: PointerEvent) => {
        const previous = gesture;
        gesture = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (!previous || previous.id !== event.pointerId || !visible()) return;
        if (previous.moved && latest.current.destination === "device") devicePointerUpdate = true;
        if (!previous.moved && latest.current.destination !== "device") {
          const destination = pick(event);
          if (destination) latest.current.onDestinationChange(destination);
        }
        canvas.style.cursor = hovered ? "pointer" : "grab";
        requestFrame();
      };
      const resetPointer = () => {
        if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
        gesture = null;
        hovered = null;
        host.dataset.hoveredDestination = "";
        canvas.style.cursor = "grab";
        requestFrame();
      };
      const onWheel = (event: WheelEvent) => {
        if (!visible() || latest.current.destination || event.ctrlKey) return;
        event.preventDefault();
        overview.span = THREE.MathUtils.clamp(
          overview.span * Math.exp(THREE.MathUtils.clamp(event.deltaY, -100, 100) * .0018), 45, 90,
        );

        requestFrame();
      };
      const pauseOrResume = () => {
        lastTime = 0;
        if (!visible()) {
          window.cancelAnimationFrame(frame);
          window.clearTimeout(decorationTimer);
          decorationTimer = 0;
          frame = 0;
          resetPointer();
        } else requestFrame();
      };
      const contextLost = (event: Event) => {
        event.preventDefault();
        window.cancelAnimationFrame(frame);
        window.clearTimeout(decorationTimer);
        window.clearTimeout(dragHintTimer);
        decorationTimer = 0;
        frame = 0;
        modelRequest.abort();
        cityAssetRequest.abort();
        reportUnavailable();
      };
      const resizeObserver = new ResizeObserver(resize);
      const intersectionObserver = new IntersectionObserver(([entry]) => {
        isIntersecting = entry.isIntersecting;
        pauseOrResume();
      }, { threshold: .01 });
      resizeObserver.observe(host);
      intersectionObserver.observe(host);
      canvas.addEventListener("pointerdown", onDown, { passive: true });
      canvas.addEventListener("pointermove", onMove, { passive: true });
      canvas.addEventListener("pointerup", onUp, { passive: true });
      canvas.addEventListener("pointercancel", resetPointer, { passive: true });
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("webglcontextlost", contextLost);
      finePointer.addEventListener("change", resetPointer);
      document.addEventListener("visibilitychange", pauseOrResume);
      window.addEventListener("blur", resetPointer);
      runtime.current = { sync: requestFrame };
      teardown = () => {
        runtime.current = null;
        modelRequest.abort();
        cityAssetRequest.abort();
        window.cancelAnimationFrame(frame);
        window.clearTimeout(decorationTimer);
        window.clearTimeout(dragHintTimer);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", resetPointer);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("webglcontextlost", contextLost);
        finePointer.removeEventListener("change", resetPointer);
        document.removeEventListener("visibilitychange", pauseOrResume);
        window.removeEventListener("blur", resetPointer);
        releaseResources(scene);
        renderer.dispose();
        canvas.remove();
      };
      resize();
      requestFrame();
      // Public scenery loads alongside the usable city, never ahead of its first frame.
      host.dataset.shuttle = "loading";
      host.dataset.construction = constructionSite ? "loading" : "absent";
      void aerial.load(cityAssetRequest.signal).then(() => {
        if (disposed || unavailable) return;
        host.dataset.shuttle = "loaded";
        lastDecorationTime = -1;
        requestFrame();
      }).catch(() => {
        if (!disposed && !unavailable) host.dataset.shuttle = "fallback";
      });
      if (constructionSite) void loadCityAsset(THREE, "/landing/quipus-city-construction.glb", cityAssetRequest.signal).then((asset) => {
        if (disposed || unavailable) { disposeCityAsset(THREE, asset); return; }
        asset.scale.setScalar(siteWidth);
        construction.add(asset);
        constructionFallback.visible = false;
        host.dataset.construction = "loaded";
        requestFrame();
      }).catch(() => {
        if (!disposed && !unavailable) host.dataset.construction = "fallback";
      });
    }
    void initialize().catch(() => { teardown?.(); reportUnavailable(); });
    return () => { disposed = true; teardown?.(); };
  }, []);

  useEffect(() => { runtime.current?.sync(); }, [
    props.destination, props.feature, props.reducedMotion, props.resetSequence, props.rotationCommand?.sequence,
  ]);

  return <div ref={container} className={styles.scene} data-quipus-scene="" data-destination={props.destination ?? "overview"}>
    <div className={styles.markers} role="group" aria-label="Explore Quipus locations">
      {CITY_DESTINATIONS.map((destination) => <button
        key={destination.id}
        ref={(element) => {
          if (element) markerElements.current.set(destination.id, element);
          else markerElements.current.delete(destination.id);
        }}
        type="button"
        className={styles.marker}
        data-city-marker={destination.id}
        aria-pressed={props.destination === destination.id}
        onClick={() => props.onDestinationChange(destination.id)}
      ><span>{destination.label}</span></button>)}
    </div>
    <svg className={styles.leaders} aria-hidden="true" focusable="false">
      {PRODUCT_FEATURES.map(({ id }) => <g key={id} style={{ visibility: "hidden" }}>
        <path ref={(element) => {
          if (element) lineElements.current.set(id, element);
          else lineElements.current.delete(id);
        }} />
        <circle r="3" ref={(element) => {
          if (element) dotElements.current.set(id, element);
          else dotElements.current.delete(id);
        }} />
      </g>)}
    </svg>
    <div ref={arrivalCueElement} className={styles.arrivalCue} aria-hidden="true" data-city-arrival-cue=""><span>City illustration</span><strong>Meeting completed</strong></div>
    <div ref={dragHintElement} className={styles.dragHint} aria-hidden="true" data-device-drag-hint="">Drag to turn</div>
    <div className={styles.callouts} role="group" aria-label="Explore the prototype hardware">
      {PRODUCT_FEATURES.map(({ id, label }) => <button
        key={id}
        ref={(element) => {
          if (element) featureElements.current.set(id, element);
          else featureElements.current.delete(id);
        }}
        type="button"
        className={styles.feature}
        data-product-feature={id}
        aria-pressed={props.feature === id}
        onClick={() => props.onFeatureChange?.(id)}
      >{label}</button>)}
    </div>
  </div>;
}
