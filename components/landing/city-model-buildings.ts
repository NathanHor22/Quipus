import type * as Three from "three";
import { loadCityAsset, disposeCityAsset } from "./city-assets";
import { citySeed, type CityModelKind, type CityModelPlacement } from "./city-layout";

export type { CityModelPlacement } from "./city-layout";
type Materials = { white: Three.Material; windows: Three.Material; red: Three.Material };
type Options = {
  /** Enable only after the renderer confirms WEBGL_multi_draw support. */
  multiDraw?: boolean;
  onBounds?: (id: string, width: number, height: number, depth: number) => void;
};
type CityBatch = Three.InstancedMesh | Three.BatchedMesh;
type ModelMetadata = {
  id: string; groupName: string; kind: CityModelKind;
  width: number; depth: number; height: number;
};
type Role = "body" | "windows";
type LibraryModel = {
  id: string; kind: CityModelKind; bounds: Three.Box3;
  parts: Map<Role, Three.BufferGeometry>;
  roof: readonly [Three.Vector3, Three.Vector3] | null;
};
export type CityModelBounds = Readonly<{
  x: number; y: number; z: number; width: number; height: number; depth: number; modelId: string;
}>;
type ModelStats = {
  instanceCount: number; modelCount: number; drawCalls: number;
  bounds: ReadonlyMap<string, CityModelBounds>;
};

function metadata(value: unknown): ModelMetadata[] {
  if (!value || typeof value !== "object" || !("models" in value) || !Array.isArray(value.models) ||
    value.models.length < 1 || value.models.length > 32) throw new Error("Invalid city model metadata");
  const ids = new Set<string>();
  return value.models.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid city model");
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.groupName !== "string" ||
      !["low", "medium", "tall"].includes(String(record.kind)) ||
      ![record.width, record.depth, record.height].every(n => typeof n === "number" && Number.isFinite(n) && n > 0 && n < 20) ||
      ids.has(record.id)) throw new Error("Invalid city model dimensions");
    ids.add(record.id);
    return { id: record.id, groupName: record.groupName, kind: record.kind as CityModelKind,
      width: record.width as number, depth: record.depth as number, height: record.height as number };
  });
}

async function loadMetadata(signal: AbortSignal) {
  const response = await fetch("/landing/city-buildings.json", { signal, credentials: "omit" });
  if (!response.ok) throw new Error("City model metadata unavailable");
  const text = await response.text();
  if (text.length > 64 * 1024) throw new Error("City model metadata exceeds its budget");
  return metadata(JSON.parse(text) as unknown);
}

/** Models and fallbacks share uniform placement logic; no geometry changes during animation. */
export function buildCityModelBuildings(
  THREE: typeof import("three"), parent: Three.Object3D,
  placements: readonly CityModelPlacement[], materials: Materials, options: Options = {},
) {
  const group = new THREE.Group();
  group.name = "Quipus instanced city architecture";
  const fallback = new THREE.Group();
  fallback.name = "Quipus neutral city fallback";
  group.add(fallback);
  parent.add(group);
  const bounds = new Map<string, CityModelBounds>();
  const owned = new Set<Three.BufferGeometry>();
  const releasedBatches = new WeakSet<CityBatch>();
  const fallbackGeometry = new THREE.BoxGeometry(1, 1, 1);
  owned.add(fallbackGeometry);
  const fallbackMesh = new THREE.InstancedMesh(fallbackGeometry, materials.white, placements.length);
  const transform = new THREE.Object3D();
  placements.forEach((placement, index) => {
    const y = placement.y ?? 0;
    transform.position.set(placement.x, y + placement.targetHeight / 2, placement.z);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(placement.width, placement.targetHeight, placement.depth);
    transform.updateMatrix();
    fallbackMesh.setMatrixAt(index, transform.matrix);
    bounds.set(placement.id, { x: placement.x, y, z: placement.z,
      width: placement.width, depth: placement.depth, height: placement.targetHeight, modelId: "fallback" });
  });
  fallbackMesh.instanceMatrix.needsUpdate = true;
  if (placements.length) {
    fallbackMesh.computeBoundingBox();
    fallbackMesh.computeBoundingSphere();
    fallback.add(fallbackMesh);
  }
  let disposed = false;
  let currentRequest: AbortController | null = null;
  let pending: Promise<ModelStats> | null = null;

  function releaseGeometry(geometry: Three.BufferGeometry) {
    if (owned.delete(geometry)) geometry.dispose();
  }
  function releaseBatch(batch: CityBatch) {
    if (releasedBatches.has(batch)) return;
    releasedBatches.add(batch);
    // BatchedMesh also owns its combined geometry and matrix/indirect textures.
    // Neither mesh type owns the caller's shared material.
    batch.dispose();
  }
  function removeFallback() {
    fallback.remove(fallbackMesh);
    releaseBatch(fallbackMesh);
    releaseGeometry(fallbackGeometry);
    group.remove(fallback);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    currentRequest?.abort();
    currentRequest = null;
    group.traverse(object => {
      if (object instanceof THREE.InstancedMesh || (typeof THREE.BatchedMesh === "function" && object instanceof THREE.BatchedMesh)) releaseBatch(object);
    });
    owned.forEach(geometry => geometry.dispose());
    owned.clear();
    group.clear();
    parent.remove(group);
    bounds.clear();
  }

  function chooseModel(models: readonly LibraryModel[], placement: CityModelPlacement) {
    const explicit = placement.modelId && models.find(model => model.id === placement.modelId);
    if (explicit) return explicit;
    const candidates = models.filter(model => model.kind === placement.kind);
    const choices = candidates.length ? candidates : models;
    const angle = placement.rotation ?? 0;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const targetRatio = placement.targetHeight / Math.max(placement.width, placement.depth);
    const weighted = choices.map(model => {
      const size = model.bounds.getSize(new THREE.Vector3());
      const w = c * size.x + s * size.z, d = s * size.x + c * size.z;
      const score = Math.abs(Math.log((size.y / Math.max(w, d)) / targetRatio)) +
        Math.abs(Math.log((w / d) / (placement.width / placement.depth))) * 0.35;
      return { model, weight: 1 / (1 + score * 2.5) ** 2 };
    });
    let ticket = citySeed(placement.x + placement.id.length * 0.19, placement.z + 17) *
      weighted.reduce((sum, entry) => sum + entry.weight, 0);
    for (const entry of weighted) {
      ticket -= entry.weight;
      if (ticket <= 0) return entry.model;
    }
    return weighted[weighted.length - 1].model;
  }

  function findRoof(geometry: Three.BufferGeometry, height: number) {
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    let best: readonly [Three.Vector3, Three.Vector3] | null = null;
    let score = -Infinity;
    for (let i = 0; i < positions.count; i += 3) {
      if (normals.getY(i) < 0.97) continue;
      const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, i + offset));
      if (vertices[0].y < height * 0.65) continue;
      for (let edge = 0; edge < 3; edge++) {
        const a = vertices[edge], b = vertices[(edge + 1) % 3];
        const length = a.distanceTo(b);
        if (Math.abs(a.y - b.y) > 0.002 || length < 0.18 ||
          (Math.abs(a.x - b.x) > 0.002 && Math.abs(a.z - b.z) > 0.002)) continue;
        const next = a.y + Math.min(length, 0.6) * 0.08;
        if (next > score) { score = next; best = [a.clone(), b.clone()]; }
      }
    }
    return best;
  }

  async function load(signal: AbortSignal): Promise<ModelStats> {
    if (pending) return pending;
    if (disposed || signal.aborted) throw new DOMException("Aborted", "AbortError");
    pending = (async () => {
      const controller = new AbortController();
      currentRequest = controller;
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = window.setTimeout(abort, 10_000);
      let source: Three.Group | null = null;
      const acquired = new Set<Three.BufferGeometry>();
      const batches: CityBatch[] = [];
      try {
        const [root, manifest, utils] = await Promise.all([
          loadCityAsset(THREE, "/landing/quipus-city-buildings.glb", controller.signal, 2 * 1024 * 1024)
            .then(asset => { source = asset; return asset; }).catch(error => { abort(); throw error; }),
          loadMetadata(controller.signal).catch(error => { abort(); throw error; }),
          import("three/addons/utils/BufferGeometryUtils.js"),
        ]);
        if (disposed || signal.aborted || controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        root.updateMatrixWorld(true);
        const models: LibraryModel[] = [];
        for (const entry of manifest) {
          const modelRoot = root.getObjectByName(entry.groupName);
          if (!modelRoot) throw new Error("City model group unavailable");
          const collected = new Map<Role, Three.BufferGeometry[]>();
          modelRoot.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            const cloned = object.geometry.clone();
            const geometry = cloned.index ? cloned.toNonIndexed() : cloned;
            if (geometry !== cloned) cloned.dispose();
            Object.keys(geometry.attributes).forEach(name => {
              if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
            });
            geometry.applyMatrix4(object.matrixWorld);
            if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
            if (object.matrixWorld.determinant() < 0) {
              for (const name of ["position", "normal"]) {
                const attribute: Three.BufferAttribute | Three.InterleavedBufferAttribute = geometry.getAttribute(name);
                for (let i = 0; i < attribute.count; i += 3) {
                  const x = attribute.getX(i + 1), y = attribute.getY(i + 1), z = attribute.getZ(i + 1);
                  attribute.setXYZ(i + 1, attribute.getX(i + 2), attribute.getY(i + 2), attribute.getZ(i + 2));
                  attribute.setXYZ(i + 2, x, y, z);
                }
              }
            }
            const role: Role = /window|glass/i.test(object.name) ? "windows" : "body";
            const list = collected.get(role) ?? [];
            list.push(geometry);
            collected.set(role, list);
            acquired.add(geometry);
          });
          const parts = new Map<Role, Three.BufferGeometry>();
          collected.forEach((pieces, role) => {
            const merged = pieces.length === 1 ? pieces[0] : utils.mergeGeometries(pieces, false);
            if (!merged) throw new Error("City geometry cannot be batched");
            acquired.add(merged);
            if (pieces.length > 1) pieces.forEach(piece => { piece.dispose(); acquired.delete(piece); });
            parts.set(role, merged);
          });
          const modelBounds = new THREE.Box3();
          parts.forEach(geometry => { geometry.computeBoundingBox(); modelBounds.union(geometry.boundingBox!); });
          if (modelBounds.isEmpty()) throw new Error("Empty city model");
          const centre = modelBounds.getCenter(new THREE.Vector3());
          const offset = new THREE.Vector3(-centre.x, -modelBounds.min.y, -centre.z);
          parts.forEach(geometry => geometry.translate(offset.x, offset.y, offset.z));
          modelBounds.translate(offset);
          const body = parts.get("body");
          models.push({ id: entry.id, kind: entry.kind, bounds: modelBounds, parts,
            roof: body ? findRoof(body, modelBounds.max.y) : null });
        }
        const used = new Map<LibraryModel, Three.Matrix4[]>();
        const nextBounds = new Map<string, CityModelBounds>();
        const accents: Three.Matrix4[] = [];
        placements.forEach((placement, index) => {
          if (![placement.width, placement.depth, placement.targetHeight].every(value => Number.isFinite(value) && value > 0))
            throw new Error("Invalid city placement");
          const model = chooseModel(models, placement);
          const size = model.bounds.getSize(new THREE.Vector3());
          const rotation = placement.rotation ?? 0;
          const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation));
          const width = c * size.x + s * size.z, depth = s * size.x + c * size.z;
          const scale = Math.min(placement.width / width, placement.depth / depth, placement.targetHeight / size.y);
          const actualW = width * scale, actualD = depth * scale, actualH = size.y * scale;
          const actualZ = placement.frontage ? placement.frontage.z - placement.frontage.side * actualD / 2 : placement.z;
          const y = placement.y ?? 0;
          transform.position.set(placement.x, y, actualZ);
          transform.rotation.set(0, rotation, 0);
          transform.scale.setScalar(scale);
          transform.updateMatrix();
          const matrix = transform.matrix.clone();
          const list = used.get(model) ?? [];
          list.push(matrix);
          used.set(model, list);
          nextBounds.set(placement.id, { x: placement.x, y, z: actualZ,
            width: actualW, depth: actualD, height: actualH, modelId: model.id });
          if (model.roof && (placement.landmark || index % 23 === 9)) {
            const a = model.roof[0].clone().applyMatrix4(matrix);
            const b = model.roof[1].clone().applyMatrix4(matrix);
            const midpoint = a.clone().lerp(b, 0.5);
            const length = Math.min(a.distanceTo(b) * 0.68, 5.2);
            transform.position.copy(midpoint);
            transform.position.y += 0.035;
            transform.rotation.set(0, Math.atan2(-(b.z - a.z), b.x - a.x), 0);
            transform.scale.set(length, 0.045, 0.065);
            transform.updateMatrix();
            accents.push(transform.matrix.clone());
          }
        });
        if (options.multiDraw && typeof THREE.BatchedMesh === "function") {
          for (const role of ["body", "windows"] as const) {
            const entries = [...used].flatMap(([model, instances]) => {
              const geometry = model.parts.get(role);
              return geometry ? [{ geometry, instances }] : [];
            });
            if (!entries.length) continue;
            const vertexCount = entries.reduce((sum, entry) =>
              sum + entry.geometry.getAttribute("position").count, 0);
            const instanceCount = entries.reduce((sum, entry) => sum + entry.instances.length, 0);
            // The buffers contain each variant once, not one expanded copy per building.
            const mesh = new THREE.BatchedMesh(instanceCount, vertexCount, 0,
              role === "body" ? materials.white : materials.windows);
            batches.push(mesh);
            mesh.name = "Quipus multi-draw " + role;
            mesh.sortObjects = false;
            mesh.perObjectFrustumCulled = false;
            entries.forEach(({ geometry, instances }) => {
              const geometryId = mesh.addGeometry(geometry);
              instances.forEach(matrix => mesh.setMatrixAt(mesh.addInstance(geometryId), matrix));
            });
            mesh.computeBoundingBox();
            mesh.computeBoundingSphere();
          }
        } else {
          used.forEach((instances, model) => {
            model.parts.forEach((geometry, role) => {
              const mesh = new THREE.InstancedMesh(geometry, role === "body" ? materials.white : materials.windows, instances.length);
              instances.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
              mesh.instanceMatrix.needsUpdate = true;
              mesh.computeBoundingBox();
              mesh.computeBoundingSphere();
              mesh.name = model.id + " instanced " + role;
              batches.push(mesh);
            });
          });
        }
        if (accents.length) {
          const geometry = new THREE.BoxGeometry(1, 1, 1);
          acquired.add(geometry);
          const mesh = new THREE.InstancedMesh(geometry, materials.red, accents.length);
          accents.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
          mesh.name = "Sparse roof edge accents";
          batches.push(mesh);
        }
        if (disposed || signal.aborted || controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const attached = new Set(batches.map(mesh => mesh.geometry));
        acquired.forEach(geometry => {
          if (attached.has(geometry)) owned.add(geometry);
          else geometry.dispose();
        });
        acquired.clear();
        batches.forEach(mesh => group.add(mesh));
        removeFallback();
        bounds.clear();
        nextBounds.forEach((value, id) => bounds.set(id, value));
        bounds.forEach((value, id) => options.onBounds?.(id, value.width, value.height, value.depth));
        return { instanceCount: placements.length, modelCount: used.size, drawCalls: batches.length, bounds };
      } catch (error) {
        batches.forEach(mesh => releaseBatch(mesh));
        acquired.forEach(geometry => geometry.dispose());
        throw error;
      } finally {
        if (source) disposeCityAsset(THREE, source);
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        if (currentRequest === controller) currentRequest = null;
      }
    })();
    return pending;
  }
  return { load, fallback, group, bounds: bounds as ReadonlyMap<string, CityModelBounds>, dispose };
}
