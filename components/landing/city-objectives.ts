import type * as Three from "three";
import type { CityDestination } from "./city";

type Objective = { id: CityDestination; position: Three.Vector3 };

/** A single shared batch of floating red wedges, fading out at the upper edge. */
export function buildCityObjectives(
  THREE: typeof import("three"), parent: Three.Group, objectives: Objective[],
) {
  const height = 3.1;
  const halfWidth = 1.2;
  const shoulder = height * .64;
  const shoulderWidth = halfWidth * shoulder / height;
  const face = [
    [0, 0], [-shoulderWidth, shoulder], [shoulderWidth, shoulder],
    [-halfWidth, height], [halfWidth, height],
  ];
  const vertices = [.12, -.12].flatMap(z => face.flatMap(([x, y]) => [x, y, z]));
  const indices = [0, 2, 1, 1, 2, 4, 1, 4, 3, 5, 6, 7, 6, 9, 7, 6, 8, 9];
  const edge = [0, 2, 4, 3, 1];
  edge.forEach((a, index) => {
    const b = edge[(index + 1) % edge.length];
    indices.push(a, b + 5, b, a, a + 5, b + 5);
  });
  const prism = new THREE.BufferGeometry();
  prism.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  prism.setIndex(indices);
  const geometry = prism.toNonIndexed();
  prism.dispose();
  geometry.computeVertexNormals();
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const colours: number[] = [];
  for (let index = 0; index < positions.count; index++) {
    const y = positions.getY(index);
    const shade = normals.getZ(index) > .5 ? 1 : .76;
    // Keep the point clearly red; dissolve the broad upper edge into the city.
    const alpha = y <= shoulder
      ? THREE.MathUtils.lerp(.96, .84, y / shoulder)
      : THREE.MathUtils.lerp(.84, .025, (y - shoulder) / (height - shoulder));
    colours.push(shade, shade, shade, alpha);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 4));
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: .94,
    depthWrite: false, toneMapped: false,
  });
  const body = new THREE.InstancedMesh(geometry, material, objectives.length);
  body.name = "Translucent red objective wedges";
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.frustumCulled = false;
  body.userData.cityObjectives = true;
  parent.add(body);
  const placement = new THREE.Object3D();
  const objectiveIndices = new Map(objectives.map((objective, index) => [objective.id, index]));
  const labelMatrix = new THREE.Matrix4();
  const idle = new THREE.Color(0xe51d2e);
  const active = new THREE.Color(0xff3945);
  let lastSelected: CityDestination | null | undefined;
  let lastHovered: CityDestination | null | undefined;
  const update = (
    time: number, reduced: boolean, camera: Three.Camera,
    selected: CityDestination | null, hovered: CityDestination | null,
  ) => {
    const colourChanged = lastSelected !== selected || lastHovered !== hovered;
    objectives.forEach((objective, index) => {
      const highlighted = objective.id === selected || objective.id === hovered;
      const hover = reduced ? 0 : Math.sin(time * 1.65 + index * .45) * .12;
      placement.position.copy(objective.position);
      placement.position.y += hover;
      placement.quaternion.copy(camera.quaternion);
      placement.scale.setScalar(highlighted ? 1.1 : 1);
      placement.updateMatrix();
      body.setMatrixAt(index, placement.matrix);
      if (colourChanged) body.setColorAt(index, highlighted ? active : idle);
    });
    body.instanceMatrix.needsUpdate = true;
    if (colourChanged && body.instanceColor) body.instanceColor.needsUpdate = true;
    lastSelected = selected;
    lastHovered = hovered;
  };
  const destination = (hit: Three.Intersection): CityDestination | null => {
    if (!hit.object.userData.cityObjectives || hit.instanceId === undefined) return null;
    return objectives[hit.instanceId]?.id ?? null;
  };
  const labelAnchor = (id: CityDestination, target: Three.Vector3) => {
    const index = objectiveIndices.get(id);
    if (index === undefined) return null;
    body.getMatrixAt(index, labelMatrix);
    target.set(0, height, 0).applyMatrix4(labelMatrix);
    return body.localToWorld(target);
  };
  return { update, destination, labelAnchor, targets: [body] };
}
