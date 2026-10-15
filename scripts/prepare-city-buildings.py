"""Prepare a small, texture-free Quipus city library from the supplied GLB.

Run in Blender (the source is data, never Python):
  blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python \
    scripts/prepare-city-buildings.py -- --source SOURCE.glb \
    --output public/landing/quipus-city-buildings.glb \
    --manifest public/landing/city-buildings.json

Each exported group is at the origin, +Y up in glTF, ground Y=0,
centred in X/Z and scaled uniformly to a largest X/Z dimension of one.
Original files are never modified. Only the chosen complete building
groups are retained. Source material colours, UVs and textures are omitted;
the only output materials are white body and neutral grey windows/recesses.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SELECTION = [
    (18, "low"), (15, "low"), (10, "low"), (28, "low"),
    (53, "low"), (62, "low"),
    (33, "medium"), (24, "medium"), (43, "medium"), (46, "medium"),
    (65, "medium"), (70, "medium"), (83, "medium"),
    (59, "tall"), (86, "tall"), (94, "tall"), (95, "tall"), (98, "tall"),
]


def glb_document(path):
    """Read metadata without evaluating embedded content or bundled scripts."""
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError("Source is too short to be a GLB")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Expected an intact glTF 2.0 binary")
    offset = 12
    while offset < len(data):
        size, kind = struct.unpack_from("<I4s", data, offset)
        offset += 8
        if kind == b"JSON":
            return json.loads(data[offset:offset + size]), data
        offset += size
    raise ValueError("Source GLB has no JSON chunk")


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def material(name, colour, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*colour, 1)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = 0
    mat.use_backface_culling = False
    return mat


def material_role(obj, polygon):
    """Only the pack's blue glazing remains a separately shaded surface."""
    slot = obj.material_slots[polygon.material_index]
    name = slot.material.name.casefold() if slot.material else ""
    return "windows" if name == "blue" or name.startswith("blue.") else "body"


def extract_group(group):
    objects = [obj for obj in group.children_recursive if obj.type == "MESH"]
    if not objects:
        raise ValueError(f"No meshes inside {group.name}")
    world_coords = [
        obj.matrix_world @ vertex.co
        for obj in objects for vertex in obj.data.vertices
    ]
    low = Vector(tuple(min(v[i] for v in world_coords) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in world_coords) for i in range(3)))
    footprint = max(high.x - low.x, high.y - low.y)
    if footprint <= 0:
        raise ValueError(f"Degenerate footprint: {group.name}")
    centre = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    buckets = {
        "body": {"vertices": [], "faces": [], "normals": [], "dropped": 0},
        "windows": {"vertices": [], "faces": [], "normals": [], "dropped": 0},
    }
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        world = obj.matrix_world
        normal_matrix = world.to_3x3().inverted().transposed()
        mirrored = world.to_3x3().determinant() < 0
        remaps = {"body": {}, "windows": {}}
        for triangle in mesh.loop_triangles:
            role = material_role(obj, mesh.polygons[triangle.polygon_index])
            bucket = buckets[role]
            remap = remaps[role]
            vertex_ids = list(triangle.vertices)
            loop_ids = list(triangle.loops)
            corners = [world @ mesh.vertices[index].co for index in vertex_ids]
            face_normal = (corners[1] - corners[0]).cross(corners[2] - corners[0])
            if face_normal.length_squared < 1e-20:
                bucket["dropped"] += 1
                continue
            face_normal.normalize()
            if mirrored:
                vertex_ids.reverse()
                loop_ids.reverse()
                face_normal.negate()
            face = []
            for vertex_id, loop_id in zip(vertex_ids, loop_ids):
                if vertex_id not in remap:
                    coord = (world @ mesh.vertices[vertex_id].co - centre) / footprint
                    remap[vertex_id] = len(bucket["vertices"])
                    bucket["vertices"].append(tuple(coord))
                face.append(remap[vertex_id])
                normal = normal_matrix @ mesh.corner_normals[loop_id].vector
                if normal.length_squared < 1e-12:
                    normal = face_normal.copy()
                normal.normalize()
                bucket["normals"].append(tuple(normal))
            bucket["faces"].append(face)
    return buckets


def build_model(model_id, kind, buckets, palette):
    # Some source primitives contain unused vertices. Re-centre the retained
    # rendered surfaces, rather than relying on the source accessor bounds.
    retained = [Vector(v) for bucket in buckets.values() for v in bucket["vertices"]]
    low = Vector(tuple(min(v[i] for v in retained) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in retained) for i in range(3)))
    centre = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    span = max(high.x - low.x, high.y - low.y)
    for bucket in buckets.values():
        bucket["vertices"] = [tuple((Vector(v) - centre) / span)
                              for v in bucket["vertices"]]
    group = bpy.data.objects.new(model_id, None)
    bpy.context.collection.objects.link(group)
    all_coords = []
    triangles = 0
    for role, bucket in buckets.items():
        if not bucket["faces"]:
            continue
        mesh = bpy.data.meshes.new(f"{model_id}_{role}_geometry")
        mesh.from_pydata(bucket["vertices"], [], bucket["faces"])
        mesh.update()
        # Retain authored split normals: planar walls stay flat and rounded
        # corners keep their supplied smoothing. No UV or colour layers exist.
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        mesh.normals_split_custom_set(bucket["normals"])
        mesh.materials.append(palette[role])
        obj = bpy.data.objects.new(f"{model_id}_{role}", mesh)
        obj.parent = group
        bpy.context.collection.objects.link(obj)
        all_coords.extend(bucket["vertices"])
        triangles += len(bucket["faces"])
    low = [min(v[i] for v in all_coords) for i in range(3)]
    high = [max(v[i] for v in all_coords) for i in range(3)]
    width, depth, height = [high[i] - low[i] for i in range(3)]
    if abs(low[2]) > 1e-6 or abs(max(width, depth) - 1) > 1e-6:
        raise ValueError(f"Normalization failed: {model_id}")
    if abs(low[0] + high[0]) > 1e-6 or abs(low[1] + high[1]) > 1e-6:
        raise ValueError(f"Model is not centred: {model_id}")
    return {
        "id": model_id,
        "groupName": model_id,
        "kind": kind,
        "width": round(width, 7),
        "depth": round(depth, 7),
        "height": round(height, 7),
        "triangles": triangles,
    }


def validate_export(path, expected):
    doc, data = glb_document(path)
    if doc.get("images") or doc.get("textures"):
        raise ValueError("Prepared library unexpectedly contains textures")
    if len(doc.get("materials", [])) > 2:
        raise ValueError("Prepared library has too many materials")
    names = {node.get("name") for node in doc["nodes"]}
    if any(model["groupName"] not in names for model in expected):
        raise ValueError("An exported building group is missing")
    triangles = 0
    accessors = doc["accessors"]
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            if set(primitive["attributes"]) - {"POSITION", "NORMAL"}:
                raise ValueError("Prepared geometry contains unused attributes")
            count = accessors[primitive["indices"]]["count"]
            if primitive.get("mode", 4) != 4 or count % 3:
                raise ValueError("Prepared geometry must contain triangles")
            triangles += count // 3
    if triangles != sum(model["triangles"] for model in expected):
        raise ValueError("Triangle count changed during export")
    return {
        "bytes": len(data),
        "triangles": triangles,
        "meshes": len(doc["meshes"]),
        "materials": len(doc.get("materials", [])),
        "textures": len(doc.get("textures", [])),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if args.output.resolve() == args.manifest.resolve():
        raise ValueError("The GLB and manifest must use different output paths")
    if args.source.resolve() in {args.output.resolve(), args.manifest.resolve()}:
        raise ValueError("Output cannot overwrite the source asset")
    source_document, source_bytes = glb_document(args.source)
    attribution = source_document.get("asset", {}).get("extras", {})
    required = ["author", "source", "license", "title"]
    if any(key not in attribution for key in required):
        raise ValueError("Source attribution metadata is incomplete")
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(args.source))
    prepared = []
    for number, kind in SELECTION:
        source_name = f"Building {number}"
        group = bpy.data.objects.get(source_name)
        if group is None:
            raise ValueError(f"Missing expected source group: {source_name}")
        prepared.append((f"Building_{number}", kind, extract_group(group)))
    reset_scene()
    palette = {
        "body": material("Quipus white body", (1, 1, 1), .83),
        "windows": material("Quipus neutral windows", (.27, .27, .27), .69),
    }
    models = [build_model(model_id, kind, buckets, palette)
              for model_id, kind, buckets in prepared]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(args.output), export_format="GLB", use_selection=True,
        export_yup=True, export_materials="EXPORT", export_normals=True,
        export_texcoords=False, export_tangents=False, export_animations=False,
        export_cameras=False, export_lights=False,
    )
    stats = validate_export(args.output, models)
    stats["removedDegenerateTriangles"] = sum(
        bucket["dropped"] for _, _, buckets in prepared for bucket in buckets.values()
    )
    manifest = {
        "formatVersion": 1,
        "file": args.output.name,
        "orientation": "+Y up; ground Y=0; centre X/Z=0; maximum footprint dimension=1",
        "source": {key: attribution[key] for key in required},
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "changes": [
            "Selected 18 complete building groups; originals remain unchanged.",
            "Baked source transforms and normalized each footprint uniformly.",
            "Merged surfaces into shared white-body and neutral-window materials.",
            "Removed original colours, UV layers and unused material splits; no textures.",
            "Retained authored split normals; removed zero-area source triangles.",
        ],
        "models": models,
        "stats": stats,
    }
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
