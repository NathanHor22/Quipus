"""Manufacturer-reviewed Rev B audio footprints; no routing or release.

The callable returns Rev A-compatible assignments. It only writes into this
revision's audio-footprints directory, never the cloud project or output PCB.
Dimensions are millimetres; geometry is PCB component-side view.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OUT = HERE / "audio-footprints"
sys.path.insert(0, str(REPO / "hardware/quipus-pcb/rev-a/easyeda"))
from kicad_format import parse, children, child  # noqa: E402

ADC_SOURCE = "https://www.ti.com/lit/ds/symlink/tlv320adc5140.pdf"
BUFFER_SOURCE = "https://www.ti.com/lit/gpn/sn74lvc1g17"
JACK_SOURCE = "https://www.sameskydevices.com/product/resource/sj1-353xng.pdf"
JACK_KICAD = "https://raw.githubusercontent.com/KiCad/kicad-footprints/master/Connector_Audio.pretty/Jack_3.5mm_CUI_SJ1-3533NG_Horizontal.kicad_mod"
FERRITE_SOURCE = "https://pim.murata.com/asset/pim4/ferriteBeadInductortypefilter/QNFA9131_PDF_FERRITEBEADINDUCTORTYPEFILTER?lastModifiedDatetime=20250707191344"


def fmt(value):
    return f"{float(value):.8f}".rstrip("0").rstrip(".") or "0"


def start(name, description, box, kind="smd", courtyard=0.25):
    x0, y0, x1, y1 = box
    return [
        f'(footprint "{name}" (version 20221018) (generator "quipus-manufacturer-land-pattern")',
        '(layer "F.Cu")', f'(attr {kind})', f'(descr "{description}")',
        f'(fp_text reference "REF**" (at 0 {fmt(y0-0.9)}) (layer "F.SilkS") (effects (font (size 0.7 0.7) (thickness 0.12))))',
        f'(fp_text value "{name}" (at 0 {fmt(y1+0.9)}) (layer "F.Fab") (effects (font (size 0.6 0.6) (thickness 0.1))))',
        f'(fp_rect (start {fmt(x0)} {fmt(y0)}) (end {fmt(x1)} {fmt(y1)}) (stroke (width 0.1) (type solid)) (fill none) (layer "F.Fab"))',
        f'(fp_rect (start {fmt(x0-courtyard)} {fmt(y0-courtyard)}) (end {fmt(x1+courtyard)} {fmt(y1+courtyard)}) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))',
    ]


def rectpad(number, x, y, sx, sy, layers='"F.Cu" "F.Paste" "F.Mask"', extra=""):
    return f'(pad "{number}" smd rect (at {fmt(x)} {fmt(y)}) (size {fmt(sx)} {fmt(sy)}) (layers {layers}) {extra})'


def dpad(number, x, y, length, width, inward_angle, layers, mask=0):
    """Flat outer end, semicircular inner end: TI RTW copper/paste outline.

    Use a filled custom polygon with an anchor entirely inside the land. 32
    segments approximate the half-circle; maximum chord error < 0.00017 mm.
    Rotate primitive coordinates, rather than relying on importer pad rotation.
    """
    radius = width/2
    points = [(-length/2, -radius), (length/2-radius, -radius)]
    points += [(length/2-radius+radius*math.cos(a), radius*math.sin(a))
               for a in [-math.pi/2+math.pi*i/32 for i in range(33)]]
    points += [(-length/2, radius)]
    a = math.radians(inward_angle)
    points = [(px*math.cos(a)-py*math.sin(a), px*math.sin(a)+py*math.cos(a))
              for px, py in points]
    xy = " ".join(f'(xy {fmt(px)} {fmt(py)})' for px, py in points)
    return (f'(pad "{number}" smd custom (at {fmt(x)} {fmt(y)}) (size 0.1 0.1) '
            f'(layers {layers}) (solder_mask_margin {fmt(mask)}) '
            f'(options (clearance outline) (anchor rect)) '
            f'(primitives (gr_poly (pts {xy}) (width 0) (fill yes))))')


def write(name, data):
    path = OUT / (name + ".kicad_mod")
    path.write_text("\n".join(data+[ ")" ])+"\n", encoding="utf-8")
    parse(path.read_text(encoding="utf-8"))
    return path


def adc_footprint():
    name = "Quipus_TI_RTW0024A_TLV320ADC5140"
    data = start(name, "TLV320ADC5140 RTW24; TI 4211120-3/D land; EP25 is CAD ground convention", (-2, -2, 2, 2), courtyard=0.65)
    for i in range(6):
        off = -1.25+i*0.5
        # Pin 1 upper left, anti-clockwise numbering in component-side view.
        for n, x, y, inward in [(i+1, -1.975, off, 0), (i+7, off, 1.975, -90),
                               (i+13, 1.975, -off, 180), (i+19, -off, -1.975, 90)]:
            data.append(dpad(n, x, y, 0.85, 0.28, inward, '"F.Cu" "F.Mask"', 0.07))
            data.append(dpad("", x, y, 0.8, 0.23, inward, '"F.Paste"'))
    data.append(rectpad(25, 0, 0, 2.7, 2.7, '"F.Cu" "F.Mask"', '(solder_mask_margin 0.07)'))
    # TI's four 1.1 mm windows, 0.3 mm web; 66.4% printed EP coverage.
    for x in [-0.7, 0.7]:
        for y in [-0.7, 0.7]:
            data.append(rectpad("", x, y, 1.1, 1.1, '"F.Paste"'))
    data.append('(fp_circle (center -2.6 -1.5) (end -2.49 -1.5) (stroke (width 0.12) (type solid)) (fill none) (layer "F.SilkS"))')
    return write(name, data)


def buffer_footprint():
    name = "Quipus_TI_DBV0005A_SN74LVC1G17"
    data = start(name, "SN74LVC1G17DBVR; TI DBV0005A 4214839/K recommended lands; top PCB view", (-0.875, -1.525, 0.875, 1.525))
    data[-1] = '(fp_rect (start -2.1 -1.8) (end 2.1 1.8) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))'
    for n, x, y in [(1, -1.3, -0.95), (2, -1.3, 0), (3, -1.3, 0.95), (4, 1.3, 0.95), (5, 1.3, -0.95)]:
        data.append(f'(pad "{n}" smd roundrect (at {fmt(x)} {fmt(y)}) (size 1.1 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.08333333) (solder_mask_margin 0.05))')
    data.append('(fp_circle (center -2.1 -0.95) (end -1.99 -0.95) (stroke (width 0.12) (type solid)) (fill none) (layer "F.SilkS"))')
    return write(name, data)


def ferrite_footprint():
    name = "Quipus_Murata_BLM21PG221SN1D"
    data = start(name, "BLM21PG family reflow a=1.2 b=2.4 c=1.25; JENF243A_9131H-01 section11.1; exact SN1 approval remains required", (-1, -0.625, 1, 0.625), courtyard=0.45)
    for n, x in [(1, -0.9), (2, 0.9)]:
        data.append(rectpad(n, x, 0, 0.6, 1.25, extra='(solder_mask_margin 0.05)'))
    return write(name, data)


def jack_footprint():
    name = "Quipus_SameSky_SJ1-3533NG"
    # Same Sky 2025 top-view pattern rotated so the plug approaches -Y.
    # Hole dimensions come from earlier manufacturer drawing / KiCad's direct
    # implementation. Current 2025 drawing omits the explicit slot dimension.
    data = start(name, "SameSky SJ1-3533NG; 1 sleeve 2 tip 3 ring; slotted PTH; manufacturer/KiCad source; verify slots with physical sample", (-4, -1.2, 4.2, 12.8), kind="through_hole", courtyard=0.5)
    data.pop()  # One courtyard surrounds both body and projecting bushing.
    data.append('(fp_rect (start -2.1 -5.2) (end 3.9 -1.2) (stroke (width 0.1) (type solid)) (fill none) (layer "F.Fab"))')
    data.append('(fp_rect (start -4.5 -5.7) (end 4.7 13.3) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))')
    for n, x, y in [(1, 0, 0), (2, 2, 2.4), (3, 2, 7.9)]:
        data.append(f'(pad "{n}" thru_hole oval (at {fmt(x)} {fmt(y)}) (size 2.8 1.8) (drill oval 2 1) (layers "*.Cu" "*.Mask"))')
    data.append('(fp_text user "PLUG APPROACH -Y" (at 0.9 -6.1) (layer "Dwgs.User") (effects (font (size 0.6 0.6) (thickness 0.1))))')
    return write(name, data)


def pads(path):
    result = []
    tree = parse(path.read_text(encoding="utf-8"))
    for node in children(tree, "pad"):
        opt = {v[0]: v[1:] for v in node[4:] if isinstance(v, list) and v}
        result.append({"number": str(node[1]), "type": str(node[2]), "shape": str(node[3]),
                       "at_mm": [float(v) for v in opt.get("at", [])],
                       "size_mm": [float(v) for v in opt.get("size", [])],
                       "drill_mm": [float(v) for v in opt.get("drill", []) if str(v) != "oval"],
                       "layers": [str(v) for v in opt.get("layers", [])],
                       **({"custom_primitives": opt["primitives"]} if "primitives" in opt else {})})
    return result


def assignment(part, path, sources, issues):
    lands = pads(path)
    electrical = {v["number"] for v in lands if v["number"] and any(str(s).endswith(".Cu") for s in v["layers"])}
    required = {str(v["number"]) for v in part["pins"]}
    assert required <= electrical, (part["ref"], required-electrical)
    mapping = {v: v for v in sorted(required)}
    return {"ref": part["ref"], "value": part["value"],
            "footprint_file": path.relative_to(REPO).as_posix(),
            "library_name": "Quipus:"+path.stem, "pad_mapping": mapping, "padmap": mapping,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pads": lands,
            "sources": sources, "issues": issues, "populate": not part.get("dnp", False)}


def build_audio_footprints():
    OUT.mkdir(parents=True, exist_ok=True)
    special = {
        "U23": (adc_footprint(), [ADC_SOURCE], ["Exact TI perimeter/thermal copper and stencil example. Inspect custom-pad copper/paste after EasyEDA import; EP25 must bind to GND. Thermal via treatment and stencil need assembly approval."]),
        "U24": (buffer_footprint(), [BUFFER_SOURCE], ["TI DBV recommended land chosen instead of the different generic IPC SOT23-5. Loaded clock edge timing still requires scope qualification."]),
        "FB220": (ferrite_footprint(), [FERRITE_SOURCE], ["Manufacturer BLM21PG family recommended reflow pattern. Confirm against selected SN1 approval sheet before fabrication; family reference document is not a part-specific approval sheet."]),
        "J8": (jack_footprint(), [JACK_SOURCE, JACK_KICAD], ["Physical pins mapped 1=sleeve,2=tip,3=ring. Plated slots use older manufacturer/KiCad dimensions; current 2025 drawing omits explicit slot size. Verify with sample and fabricator. Bushing overhang/case opening needs mechanical review."]),
    }
    special["J9"] = special["J8"]
    original = {v["ref"]: v for v in json.loads((REPO/"hardware/quipus-pcb/rev-a/easyeda/footprints-audio.json").read_text(encoding="utf-8"))["components"]}
    source = json.loads((HERE/"audio-circuit.json").read_text(encoding="utf-8"))
    result = {}
    for p in source["components"]:
        ref = p["ref"]
        if ref in special:
            result[ref] = assignment(p, *special[ref])
        elif ref in ["U20", "U21", "U22", "J5"]:
            path = REPO/original[ref]["footprint_file"]
            result[ref] = assignment(p, path, original[ref]["sources"], original[ref]["issues"])
        elif ref.startswith("R"):
            path = REPO/".tools/quipus-footprints/power/R_0805_2012Metric.kicad_mod"
            result[ref] = assignment(p, path, ["https://github.com/KiCad/kicad-footprints/blob/master/Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod"], ["Generic IPC 0805 land reused. Exact resistor MPN/body/tolerance/rating must be qualified."])
        elif ref.startswith("C"):
            size = "1210_3225" if "1210" in p["package"] else "0805_2012"
            path = REPO/(".tools/quipus-footprints/audio/C_"+size+"Metric.kicad_mod")
            result[ref] = assignment(p, path, ["https://github.com/KiCad/kicad-footprints/blob/master/Capacitor_SMD.pretty/C_"+size+"Metric.kicad_mod"], ["Generic IPC package land reused. Exact capacitor MPN and effective capacitance under bias still require qualification."])
        elif ref in ["D220", "D221"]:
            path = REPO/".tools/quipus-footprints/power/Quipus_TI_DYA0002A_TPD1E10B06.kicad_mod"
            result[ref] = assignment(p, path, [source["sources"]["esd"]], ["Retained manufacturer DYA geometry. This TVS alone clamps above ADC maximum; transient-protection design remains HOLD."])
        else:
            raise ValueError("Unmapped audio component: "+ref)
    assert len(result) == len(source["components"])
    manifest = {"status": "Engineering PCB footprint review; not fabrication release", "units": "mm",
                "component_count": len(result), "components": list(result.values()),
                "new_footprints": sorted({v["footprint_file"] for v in result.values() if "rev-b/audio-footprints" in v["footprint_file"]}),
                "checks": ["S-expression parsing", "Every schematic physical pin has a copper land", "Complete audio reference coverage"],
                "native_cad_drc": "not run", "existing_native_mic": "Preserve cloud quarter-pad annulus correction; this carrier uses the reviewed source custom-circle annulus and requires fresh import inspection."}
    (OUT/"assignments.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    entries = build_audio_footprints()
    print(json.dumps({"audio_references": len(entries), "new_files": sorted(str(v) for v in OUT.glob("*.kicad_mod")), "native_drc": "not run"}, indent=2))
