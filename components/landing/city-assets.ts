import type * as Three from "three";

/** Bounded public scenery downloads never block city controls. */
export async function loadCityAsset(
  THREE: typeof import("three"), path: string, signal: AbortSignal, maxBytes = 128 * 1024,
): Promise<Three.Group> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 10000);
  try {
    const [{ GLTFLoader }, response] = await Promise.all([
      import("three/addons/loaders/GLTFLoader.js"),
      fetch(path, { signal: controller.signal, credentials: "omit" }),
    ]);
    if (!response.ok) throw new Error("City asset unavailable");
    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > maxBytes) throw new Error("City asset exceeds its budget");
    const bytes = await response.arrayBuffer();
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (bytes.byteLength > maxBytes) throw new Error("City asset exceeds its budget");
    const gltf = await new GLTFLoader().parseAsync(bytes, "/landing/");
    if (controller.signal.aborted) {
      disposeCityAsset(THREE, gltf.scene);
      throw new DOMException("Aborted", "AbortError");
    }
    return gltf.scene;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function disposeCityAsset(THREE: typeof import("three"), root: Three.Object3D) {
  const geometries = new Set<Three.BufferGeometry>();
  const materials = new Set<Three.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
