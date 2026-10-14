"""Prepare the user-supplied city references. Run with Blender --background --python.

Arguments after --: --spaceships ZIP --construction GLB --output DIRECTORY
Only the known FBX is read from the archive; no bundled code is executed.
"""
import argparse
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument("--spaceships", type=Path, required=True)
parser.add_argument("--construction", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
args.output.mkdir(parents=True, exist_ok=True)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def material(name, rgb, roughness=.6):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*rgb, 1)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = .12
    return mat


def bake(obj, width, ground=False):
    world = obj.matrix_world.copy()
    coords = [world @ v.co for v in obj.data.vertices]
    low = Vector(tuple(min(v[i] for v in coords) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in coords) for i in range(3)))
    centre = (low + high) / 2
    if ground:
        centre.z = low.z
    scale = width / ((high.x - low.x) if ground else max(high - low))
    obj.parent = None
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = Matrix.Identity(4)
    obj.delta_location = Vector((0, 0, 0))
    obj.delta_rotation_euler = Vector((0, 0, 0))
    obj.delta_scale = Vector((1, 1, 1))
    for vertex, coord in zip(obj.data.vertices, coords):
        vertex.co = (coord - centre) * scale
    obj.data.update()


def export(obj, name):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.calc_loop_triangles()
    used = {index for polygon in obj.data.polygons for index in polygon.vertices}
    coords = [obj.data.vertices[index].co for index in used]
    spans = [max(v[i] for v in coords) - min(v[i] for v in coords) for i in range(3)]
    path = args.output / name
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
        export_yup=True, export_materials="EXPORT", export_cameras=False, export_lights=False)
    return {"file": name, "bytes": path.stat().st_size,
        "triangles": len(obj.data.loop_triangles), "vertices": len(obj.data.vertices),
        "dimensions_gltf_xyz": [spans[0], spans[2], spans[1]]}


reset()
with tempfile.TemporaryDirectory(prefix="quipus-city-source-") as temporary:
    with zipfile.ZipFile(args.spaceships) as archive:
        source = archive.read("source/Spaceships.fbx")
    fbx = Path(temporary) / "Spaceships.fbx"
    fbx.write_bytes(source)
    bpy.ops.import_scene.fbx(filepath=str(fbx), use_anim=False)
ship = bpy.data.objects.get("Box002")
if ship is None or ship.type != "MESH":
    raise RuntimeError("Expected Box002 shuttle in the supplied archive")
original = [slot.material.diffuse_color[:] if slot.material else (.6,.6,.6,1) for slot in ship.material_slots]
palette = [material("White hull", (.9,.9,.9), .5),
    material("Graphite canopy", (.045,.055,.06), .32),
    material("Crimson wing tips", (.55,.008,.025), .45)]
indices = []
for polygon in ship.data.polygons:
    r,g,b,_ = original[polygon.material_index]
    indices.append(1 if (b > r * 1.5 or max(r,g,b) < .25) else 2 if r > g * 1.5 else 0)
ship.data.materials.clear()
for mat in palette:
    ship.data.materials.append(mat)
for polygon, index in zip(ship.data.polygons, indices):
    polygon.material_index = index
    polygon.use_smooth = False
bake(ship, 3.3)
ship.name = "Quipus city shuttle"
ship_meta = export(ship, "quipus-city-shuttle.glb")

reset()
bpy.ops.import_scene.gltf(filepath=str(args.construction))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
site = max(meshes, key=lambda obj: len(obj.data.polygons))
bake(site, 1, ground=True)
site.data.materials.clear()
site.data.materials.append(material("Exposed concrete", (.62,.62,.62), .9))
for polygon in site.data.polygons:
    polygon.material_index = 0
    polygon.use_smooth = False
site.name = "Quipus exposed construction frame"
site_meta = export(site, "quipus-city-construction.glb")
manifest = {"purpose": "Lightweight public landing-page scenery, not Quipus hardware CAD.",
    "sources": [args.spaceships.name, args.construction.name],
    "shuttle": ship_meta, "construction": site_meta,
    "orientation": "glTF +Y up; shuttle nose +Z; construction ground Y=0, width X=1",
    "changes": "Selected Box002 only; merged three opaque materials; white hull, graphite canopy, crimson tips. Separate source ground slab omitted; frame foundation retained."}
(args.output / "city-assets.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest))
