import type * as Three from "three";

/** A fixed pool of short-lived facets: no ribbon, accumulating objects, or CPU animation loop. */
export function buildVehicleTrails(THREE: typeof import("three"), parent: Three.Group) {
  const capacity = 192;
  const primitive = new THREE.TetrahedronGeometry(1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", primitive.getAttribute("position").clone());
  if (primitive.index) geometry.setIndex(primitive.index.clone());
  primitive.dispose();
  geometry.instanceCount = capacity;
  const origins = new Float32Array(capacity * 3);
  const births = new Float32Array(capacity).fill(-10);
  const seeds = new Float32Array(capacity);
  const colours = new Float32Array(capacity * 3);
  const palette = [0x7f1024, 0xab1631, 0xd82742, 0xe74452, 0xb6202f].map((hex) => new THREE.Color(hex));
  for (let index = 0; index < capacity; index++) {
    seeds[index] = ((index + 1) * .61803398875) % 1;
    palette[index % palette.length].toArray(colours, index * 3);
  }
  const originAttribute = new THREE.InstancedBufferAttribute(origins, 3).setUsage(THREE.DynamicDrawUsage);
  const birthAttribute = new THREE.InstancedBufferAttribute(births, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aOrigin", originAttribute);
  geometry.setAttribute("aBirth", birthAttribute);
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute("aColour", new THREE.InstancedBufferAttribute(colours, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 aOrigin;
      attribute float aBirth;
      attribute float aSeed;
      attribute vec3 aColour;
      uniform float uTime;
      varying vec3 vColour;
      varying float vAlpha;
      void main() {
        float age = uTime - aBirth;
        float life = .82 + .18 * aSeed;
        float alive = step(0., age) * (1. - step(life, age));
        float fade = 1. - smoothstep(life * .15, life, age);
        float angle = aSeed * 6.283 + age * .8;
        mat2 turn = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        vec3 facet = position * (.17 + aSeed * .18);
        facet.xy = turn * facet.xy;
        facet.xz = turn * facet.xz;
        facet.y *= .48;
        vec3 drift = vec3((aSeed - .5) * .4, .18 + aSeed * .3, (aSeed - .5) * .25) * max(age, 0.);
        vColour = aColour;
        vAlpha = alive * fade * .9;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(aOrigin + drift + facet * alive, 1.);
      }
    `,
    fragmentShader: `
      varying vec3 vColour;
      varying float vAlpha;
      void main() {
        if (vAlpha < .01) discard;
        gl_FragColor = vec4(vColour, vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Short crimson vehicle wakes";
  mesh.frustumCulled = false;
  parent.add(mesh);
  let cursor = 0;
  let dirty = false;
  const lastEmitted = [-1, -1, -1];
  const previous = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const emit = (source: number, point: Three.Vector3, tangent: Three.Vector3, time: number, moving: boolean) => {
    if (!moving || time - lastEmitted[source] < .075) return;
    if (lastEmitted[source] >= 0 && previous[source].distanceToSquared(point) < .0004) return;
    // A small cluster follows the vehicle, rather than painting its future route.
    for (let shard = 0; shard < 3; shard++) {
      const seed = seeds[cursor];
      const offset = cursor * 3;
      origins[offset] = point.x - tangent.x * 1.4 + (seed - .5) * .45;
      origins[offset + 1] = point.y - tangent.y * 1.4 + (seed - .5) * .25;
      origins[offset + 2] = point.z - tangent.z * 1.4 + (seed - .5) * .45;
      births[cursor] = time;
      cursor = (cursor + 1) % capacity;
    }
    previous[source].copy(point);
    lastEmitted[source] = time;
    dirty = true;
  };
  const update = (time: number, reduced: boolean) => {
    mesh.visible = !reduced;
    material.uniforms.uTime.value = time;
    if (reduced) {
      births.fill(-10);
      lastEmitted.fill(-1);
      dirty = true;
    }
    if (dirty) {
      originAttribute.needsUpdate = true;
      birthAttribute.needsUpdate = true;
      dirty = false;
    }
  };
  return { emit, update, mesh };
}
