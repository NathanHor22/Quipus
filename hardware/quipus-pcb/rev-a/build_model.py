"""Generate a mechanical placement study, never a fabrication PCB.

Run with .tools/lantern-cad-env/Scripts/python.exe.
All dimensions are millimetres. Origin is board top-left; +y is downward,
+z is the screen/front side. The PCB spans z=0..1.6.
"""
from pathlib import Path
import json
import math
import cadquery as cq
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "output" / "pcb" / "Quipus-A1" / "model"
OUT.mkdir(parents=True, exist_ok=True)

parts = []
assembly = cq.Assembly(name="Quipus_A1_PLACEMENT_STUDY_NOT_FOR_FABRICATION")


def add(name, shape, rgb, description):
    assembly.add(shape, name=name, color=cq.Color(*[c / 255 for c in rgb]))
    parts.append({"name": name, "shape": shape, "color": rgb, "description": description})


def box(name, x, y, z, w, d, h, color, description):
    shape = cq.Workplane("XY").box(w, d, h, centered=(True, True, False)).translate((x, y, z))
    add(name, shape, color, description)


board = cq.Workplane("XY").box(65, 105, 1.6, centered=(False, False, False))
for x in (8, 57):
    hole = cq.Workplane("XY").center(x, 7).circle(0.3).extrude(1.6)
    board = board.cut(hole)
for x, y in ((5, 19), (60, 19), (5, 99), (60, 99)):
    board = board.cut(cq.Workplane("XY").center(x, y).circle(1.4).extrude(1.6))
add("PCB_65x105x1p6", board, (28, 108, 86), "Unrouted 65 x 105 x 1.6 board study; no fabricated copper or pad geometry.")

for n, x in enumerate((8, 57), 1):
    box(f"MIC_{n}_ENVELOPE", x, 7, -1.0, 3.5, 2.65, 1.0, (201, 170, 77),
        "Rear mounted microphone envelope; bottom port faces through the 0.6 mm board hole toward the front. No footprint implied.")

box("ESP32_MODULE_ENVELOPE", 32.5, 12.75, -3.2, 18, 25.5, 3.2, (156, 166, 178),
    "WROOM-1 18 x 25.5 mm outline; body height envelope 3.2 mm; final drawing and tolerance need audit.")
box("ANTENNA_REGION_INDICATOR", 32.5, 3.2, -3.3, 18, 6.4, 0.1, (46, 54, 68),
    "Antenna end at top board edge. Illustration only: enforce full manufacturer keepout during layout.")

box("LCD_MODULE_ENVELOPE", 32.5, 50, 1.6, 45, 31, 2.0, (36, 46, 64),
    "Waveshare 1.3-inch module 45 x 31 mm board envelope. The 2 mm thickness is provisional; actual connectors and glass stack require measurement.")
box("DISPLAY_GLASS_INDICATOR", 32.5, 50, 3.6, 27, 27, 0.8, (89, 185, 167),
    "Illustrative screen surface, not an asserted display mechanical drawing.")

for name, x, y in [("START", 22, 80), ("STOP", 43, 80), ("UP", 22, 93), ("DOWN", 43, 93)]:
    box("BUTTON_" + name + "_BODY", x, y, 1.6, 3, 2.5, 1.2, (58, 69, 81), "Omron B3U-1000P approximate body envelope; no vendor-qualified land pattern or actuator travel implied.")
    cap = cq.Workplane("XY").center(x, y).circle(3).extrude(2.5).translate((0, 0, 2.8))
    add("BUTTON_" + name + "_CAP", cap, (194, 202, 214), "Provisional 6 mm case-actuator envelope over the B3U switch; final case travel and retention not designed.")

box("POWER_BUTTON_ENVELOPE", 2.5, 82, 1.6, 7, 6, 4, (225, 154, 71),
    "Provisional left-edge case power-actuator envelope over B3U switch; final mechanical lever and travel pending.")
box("USB_C_ENVELOPE", 32.5, 102, -3.3, 9, 7, 3.3, (190, 198, 208),
    "Simplified envelope for selected GCT USB4105-GF-A; not a vendor-qualified model. Shown extending through bottom edge; exact mechanical drawing takes priority.")
box("MICRO_SD_ENVELOPE", 57, 40, -2.0, 16, 15, 2, (163, 178, 191),
    "Approximate socket envelope, right-edge ejection; exact Hirose land/slot/ejection travel not modelled.")
box("MIC_EXPANSION_CONNECTOR_ENVELOPE", 62, 26, -3.0, 6, 4.25, 3.0, (229, 227, 213),
    "Approximate four-pin JST SH connector envelope; shifted to y26 to clear the mounting hole at (60,19). Cable clearance and pin orientation pending.")
box("SPEAKER_CONNECTOR_ENVELOPE", 63, 76, -3.0, 4, 4.25, 3.0, (229, 227, 213),
    "Approximate two-pin JST SH connector envelope; speaker is off-board.")
box("BATTERY_CONNECTOR_ENVELOPE", 12, 96, -5, 8, 6, 5, (229, 227, 213),
    "Proposed JST PH battery connector zone; no battery dimensions assumed.")
box("NTC_3PIN_CONNECTOR_ENVELOPE", 12, 85, -3, 5, 4.25, 3, (229, 227, 213),
    "Three-pin JST SH thermistor connector envelope; does not accept the two-pin speaker plug. Exact cable bend clearance pending.")

assembly.save(str(OUT / "Quipus-A1-placement-study.step"))
cq.exporters.export(board, str(OUT / "board-outline-study.step"))
manifest = {
    "status": "PLACEMENT STUDY — NOT FOR FABRICATION",
    "units": "mm",
    "origin": "top-left of PCB; +y down the face; +z toward front/screen",
    "board_mm": [65, 105, 1.6],
    "mounting_holes": {"diameter_mm": 2.8, "centres_mm": [[5,19],[60,19],[5,99],[60,99]]},
    "no_battery_envelope": "Battery dimensions are not known. No battery or case fit is implied.",
    "parts": [{k: v for k, v in p.items() if k != "shape"} for p in parts],
}
(OUT / "model-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

# Lightweight projected triangle preview, rendered from the generated CAD solids.
# This avoids pretending a PCB routing visualization exists.
img = Image.new("RGB", (1800, 1320), (244, 247, 249))
draw = ImageDraw.Draw(img)
fontpath = Path("C:/Windows/Fonts/segoeui.ttf")
boldpath = Path("C:/Windows/Fonts/segoeuib.ttf")
def font(size, bold=False):
    p = boldpath if bold else fontpath
    return ImageFont.truetype(str(p), size) if p.exists() else ImageFont.load_default()

draw.text((65, 42), "QUIPUS A1 / PLACEMENT STUDY", font=font(38, True), fill=(19, 46, 57))
draw.text((65, 98), "65 × 105 × 1.6 mm PCB  ·  2,000 mAh pack connects separately", font=font(25), fill=(67, 89, 103))
draw.rounded_rectangle((1195, 46, 1735, 110), radius=12, fill=(252, 224, 174))
draw.text((1222, 61), "NOT FOR MANUFACTURE", font=font(26, True), fill=(109, 60, 19))

def project(p, ox, oy, scale, rear=False):
    x, y, z = p.x-32.5, p.y-52.5, p.z
    if rear:
        x, z = -x, -z
    return (ox + scale*(0.98*x - 0.22*y), oy + scale*(0.22*x+0.75*y-1.6*z))

def panel(ox, rear=False):
    pixels = np.array(img)
    depthbuf = np.full((img.height, img.width), -np.inf, dtype=np.float64)
    for part in parts:
        verts, faces = part["shape"].val().tessellate(0.12)
        for face in faces:
            ps = [verts[i] for i in face]
            cross = (ps[1]-ps[0]).cross(ps[2]-ps[0])
            norm = math.sqrt(cross.x**2+cross.y**2+cross.z**2) or 1
            nz = cross.z/norm * (-1 if rear else 1)
            # Depth direction is the kernel of the projection matrix.
            depths = [(p.x if not rear else -p.x)*0.352 + p.y*1.568 + (p.z if not rear else -p.z)*0.7834 for p in ps]
            shade = 0.75 + 0.22*max(0,nz)
            col = tuple(int(c*shade) for c in part["color"])
            xy = [project(p, ox, 620, 7.7, rear) for p in ps]
            (x0,y0),(x1,y1),(x2,y2) = xy
            den = (y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
            if abs(den)<1e-9:
                continue
            xmin=max(0,int(math.floor(min(p[0] for p in xy))))
            xmax=min(img.width-1,int(math.ceil(max(p[0] for p in xy))))
            ymin=max(0,int(math.floor(min(p[1] for p in xy))))
            ymax=min(img.height-1,int(math.ceil(max(p[1] for p in xy))))
            yy,xx=np.mgrid[ymin:ymax+1,xmin:xmax+1]
            a=((y1-y2)*(xx+.5-x2)+(x2-x1)*(yy+.5-y2))/den
            b=((y2-y0)*(xx+.5-x2)+(x0-x2)*(yy+.5-y2))/den
            c=1-a-b
            depth=a*depths[0]+b*depths[1]+c*depths[2]
            region=depthbuf[ymin:ymax+1,xmin:xmax+1]
            mask=(a>=-1e-7)&(b>=-1e-7)&(c>=-1e-7)&(depth>region)
            region[mask]=depth[mask]
            pixels[ymin:ymax+1,xmin:xmax+1][mask]=col
    img.paste(Image.fromarray(pixels))

panel(490)
panel(1340, True)
draw.text((230, 192), "FRONT / SCREEN + SOUND OPENINGS", font=font(23, True), fill=(35, 77, 87))
draw.text((1085, 192), "REAR / COMPONENT ENVELOPES", font=font(23, True), fill=(35, 77, 87))

labels = [
    (65, 1030, "Front", "1.3-inch display, four menu buttons; power on the left."),
    (65, 1110, "Rear", "ESP32 antenna at top; SD exits right; USB-C exits bottom."),
    (940, 1030, "Microphones", "Rear-mounted; sound passes through two front PCB holes."),
    (940, 1110, "Not modelled", "Battery, speaker, wiring, routed copper or final component pads."),
]
for x, y, title, body in labels:
    draw.text((x,y), title.upper(), font=font(21, True), fill=(28,108,86))
    draw.text((x,y+32), body, font=font(19), fill=(68,83,94))
draw.text((65, 1235), "Component shapes are placement envelopes. Several heights and connector outlines are provisional; final mechanical drawings take priority.", font=font(19), fill=(84,95,106))
img.save(OUT / "Quipus-A1-placement-preview.png")

(OUT / "README.md").write_text('''# Quipus A1 placement study

**NOT FOR FABRICATION OR CASE TOOLING. Units: millimetres.**

The STEP assembly contains a proposed 65 × 105 × 1.6 mm board and component
envelopes. The PNG is projected from those CAD solids. Neither contains a
routed PCB, copper, real pads, manufacturing clearances or a validated case fit.

Origin is the board top-left, +y down the front face and +z toward the screen.
The board occupies z=0..1.6. Microphones mount on the rear and listen through
0.6 mm board openings at (8,7) and (57,7). The ESP32 antenna end sits at the top;
its complete copper/component/case keepout must be checked during real layout.

The Waveshare display board envelope is 45 × 31 mm. Its modeled thickness and
glass are illustrative pending actual stack measurements. B3U switch bodies
are approximately 3 × 2.5 × 1.2 mm; larger caps are provisional case actuators.
The USB-C part is GCT USB4105-GF-A, with only a simplified envelope here.
All button/connector clearances need exact mechanical review before case design.
The USB port exits the bottom; SD card ejects from the right. Cable bends and
card ejection travel are not yet reserved in an approved enclosure.

Proposed 2.8 mm mounting holes are centered at (5,19), (60,19), (5,99), (60,99).
The microphone connector is at right-edge y=26 to clear the upper-right hole;
the earlier y=18 position collided. The separate NTC connector has three pins
to prevent interchange with the two-pin speaker connection.

The battery has deliberately not been modelled because its dimensions are
unknown. Capacity does not determine its dimensions. The speaker and cable
harness are also omitted.

Open Quipus-A1-placement-study.step in mechanical CAD. Refer to
model-manifest.json for each envelope's assumptions. Do not send these files
to a PCB factory as manufacturing data.
''', encoding="utf-8")
print(str(OUT / "Quipus-A1-placement-study.step"))
print(str(OUT / "Quipus-A1-placement-preview.png"))
