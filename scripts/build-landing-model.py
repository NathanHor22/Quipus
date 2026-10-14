"""Build the web prototype model from existing assembled enclosure CAD exports.

Run with Blender 5:
blender --background --factory-startup --python scripts/build-landing-model.py
Units are converted from CAD millimetres to browser metres. Front is +Z, top +Y.
The case geometry is the existing service enclosure, not a new production design.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "hardware" / "lantern-case" / "exports"
OUT = ROOT / "public" / "landing"
OUT.mkdir(parents=True, exist_ok=True)
manifest = json.loads((SOURCE / "preview-manifest.json").read_text(encoding="utf-8"))
scene = bpy.context.scene
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "METERS"

def material(name, color, roughness=0.4, metallic=0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return result

mats = {
    "front_shell": material("Off-white prototype shell", (0.78, 0.79, 0.8), 0.35),
    "rear_lid": material("Navy rear lid", (0.02, 0.045, 0.09), 0.42),
    "battery_tray": material("Internal tray", (0.08, 0.11, 0.16), 0.5),
    "speaker_retainer": material("Speaker ring", (0.025, 0.045, 0.08), 0.5),
    "board_reference": material("PCB reference envelope", (0.045, 0.11, 0.08), 0.65),
    "glass_reference": material("Touchscreen bezel", (0.004, 0.009, 0.018), 0.22),
    "display_reference": material("Display envelope", (0.006, 0.013, 0.024), 0.33),
    "battery_reference": material("Measured battery envelope", (0.45, 0.3, 0.07), 0.4, 0.1),
    "speaker_reference": material("Measured speaker envelope", (0.018, 0.024, 0.035), 0.58),
    "usb_reference": material("USB-C reference envelope", (0.4, 0.44, 0.48), 0.3, 0.85),
    "branding_finish_reference": material("Original Fovea engraving fill", (0.04, 0.065, 0.11), 0.55),
}
objects = []
metrics = {}
for item in manifest["parts"]:
    bpy.ops.wm.stl_import(filepath=str(SOURCE / item["file"]))
    obj = bpy.context.object
    obj.name = item["name"]
    # Bake an orthonormal Y-axis rotation into each vertex; preserve triangle winding.
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        vertex.co = (-x / 1000.0, y / 1000.0, (19.5 - z) / 1000.0)
    obj.data.materials.clear()
    obj.data.materials.append(mats[obj.name])
    obj["source"] = str(Path("hardware/lantern-case/exports") / item["file"])
    obj["description"] = "Existing enclosure CAD" if item["kind"] == "case" else "Simplified component reference envelope"
    obj["partKind"] = item["kind"]
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    before = len(obj.data.polygons)
    # Dissolve coplanar CAD tessellation while preserving borders and curved apertures.
    modifier = obj.modifiers.new("Web coplanar simplification", "DECIMATE")
    modifier.decimate_type = "DISSOLVE"
    modifier.angle_limit = math.radians(0.15)
    modifier.use_dissolve_boundaries = False
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    if len(obj.data.polygons) > 16000 and obj.name == "front_shell":
        modifier = obj.modifiers.new("Web bounded detail reduction", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = 0.75
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Preserve silhouette with split sharp edges; smooth curved CAD tessellation.
    if obj.name == "branding_finish_reference":
        modifier = obj.modifiers.new("Web engraving fill reduction", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = 0.4
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(28))
    metrics[obj.name] = {"polygons_before": before, "polygons_after": len(obj.data.polygons)}
    objects.append(obj)

# Illustrative screen in the exact CAD display location, with embedded web texture.
screen_material = material("Illustrative Quipus prototype display", (0.03, 0.045, 0.08), 0.3)
nodes = screen_material.node_tree.nodes
links = screen_material.node_tree.links
texture = nodes.new("ShaderNodeTexImage")
texture.image = bpy.data.images.load(str(OUT / "prototype-screen.png"))
bsdf = nodes.get("Principled BSDF")
links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
links.new(texture.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 0.45
x0, x1, y0, y1, z = -0.0311, 0.0121, -0.02572, 0.03188, 0.0169
mesh = bpy.data.meshes.new("Display surface")
mesh.from_pydata([(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)], [], [(0,1,2,3)])
mesh.materials.append(screen_material)
screen = bpy.data.objects.new("display_surface", mesh)
scene.collection.objects.link(screen)
uv = mesh.uv_layers.new(name="Screen UV")
for loop, coord in zip(uv.data, ((0,0),(1,0),(1,1),(0,1))):
    loop.uv = coord
screen["description"] = "Illustrative screen; not a firmware screenshot"
objects.append(screen)

bpy.ops.object.select_all(action="DESELECT")
for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
# Blender glTF exporter converts Z-up to glTF Y-up. Counter this explicitly:
# rotate every mesh BEFORE export so exported coordinates remain X-right/Y-top/Z-front.
# Bake the inverse glTF axis conversion so the browser receives this orientation.
for obj in objects:
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        vertex.co = (x, -z, y)
bpy.ops.export_scene.gltf(
    filepath=str(OUT / "quipus-prototype.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_extras=True,
    export_yup=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)

# Restore front-facing geometry for the poster scene.
for obj in objects:
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        vertex.co = (x, z, -y)

def area_light(name, location, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()
    data.energy = energy
    data.shape = "DISK"
    data.size = size

area_light("Large key softbox", (0.0, 0.18, 0.22), 6, 0.2)
area_light("Side fill", (0.18, -0.04, 0.13), 3, 0.17)
area_light("Rear edge light", (-0.15, 0.1, -0.08), 4, 0.18)
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (0.65, 0.69, 0.76, 1)
background.inputs["Strength"].default_value = 0.5
data = bpy.data.cameras.new("Landing poster camera")
camera = bpy.data.objects.new("Landing poster camera", data)
scene.collection.objects.link(camera)
camera.location = (0.17, 0.12, 0.26)
forward = (-camera.location).normalized()
right = forward.cross(Vector((0, 1, 0))).normalized()
up = right.cross(forward).normalized()
camera.rotation_euler = Matrix((right, up, -forward)).transposed().to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 0.21
camera.data.clip_start = 0.001
camera.data.clip_end = 10
scene.camera = camera
scene.render.engine = "CYCLES"
scene.render.threads_mode = "FIXED"
scene.render.threads = 4
scene.cycles.samples = 20
scene.cycles.use_denoising = True
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = -0.3
scene.render.filepath = str(OUT / "quipus-prototype.png")
bpy.ops.render.render(write_still=True)
metrics["bounds_metres"] = {"width": 0.092, "height": 0.112, "depth": 0.039}
metrics["orientation"] = "GLB: front +Z, microphone/top +Y, speaker on +X, SD access on -X"
metrics["asset_bytes"] = (OUT / "quipus-prototype.glb").stat().st_size
metrics["source_revision"] = manifest["parameters"]["revision"]
metrics["description"] = "Working-prototype enclosure CAD with simplified component references and illustrative display. Not a production hardware design."
(OUT / "prototype-model-metadata.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
print("QUIPUS_MODEL_RESULT " + json.dumps(metrics))
