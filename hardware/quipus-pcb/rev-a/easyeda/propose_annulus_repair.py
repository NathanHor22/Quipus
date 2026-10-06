"""Build unassigned microphone-ring repair candidates; never change PCB/source.

The polygon candidate avoids a stroked gr_circle that a native importer can
flatten into a disc. Native complex-polygon payloads retain exact circles.
"""
from pathlib import Path
import hashlib
import json
import math
from kicad_format import parse, dumps, quote, children, child, child_values

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BASE = ROOT / ".tools/quipus-footprints/audio/Infineon_IM69D128SV01_PG-TLGA-5-2_2.65x3.50mm_NPTH0.60.kicad_mod"
OUT = BASE.parent / "candidates"


def sector(cx, cy, outer, inner, begin, span=90, steps=90):
    angles = [math.radians(begin + span*i/steps) for i in range(steps+1)]
    return [(cx+outer*math.cos(a), cy+outer*math.sin(a)) for a in angles] + [
        (cx+inner*math.cos(a), cy+inner*math.sin(a)) for a in reversed(angles)]


def pts(points):
    return ["pts", *[["xy", f"{x:.10f}", f"{y:.10f}"] for x,y in points]]


def polygon_shape(factor=1):
    # Relative to unchanged custom-pad anchor at (+0.6775,-0.710).
    return ["POLY", [["CIRCLE", -0.6775*factor, 0, 0.8625*factor, 0],
                     ["CIRCLE", -0.6775*factor, 0, 0.4925*factor, 1]]]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base = BASE.read_bytes()
    tree = parse(base.decode())
    tree[1] = quote(str(tree[1]) + "_PolygonAnnulusCandidate")
    child(tree, "descr")[1] = quote("Unassigned EasyEDA import repair candidate: four filled concave quarter-ring copper/mask polygons; IM69D128S Fig12/13 dimensions retained")
    pad = next(p for p in children(tree,"pad") if str(p[1]) == "5")
    copper = [sector(-0.6775,0,.8625,.4925,a) for a in (-45,45,135,225)]
    child(pad,"primitives")[:] = ["primitives", *[["gr_poly",pts(p),["width","0"],["fill","yes"]] for p in copper]]
    # Independent mask aperture, not a mask automatically expanded from the
    # custom pad. Preserve both manufacturer mask diameters without circles.
    tree[:] = [n for n in tree if not (isinstance(n,list) and n and n[0]=="fp_circle" and child_values(n,"layer",[]) == ["F.Mask"])]
    for start in (-45,45,135,225):
        tree.append(["fp_poly", pts(sector(0,-.710,.9125,.4425,start)),
                     ["stroke",["width","0"],["type","solid"]], ["fill","solid"],["layer",quote("F.Mask")]])
    candidate = OUT / (str(tree[1]) + ".kicad_mod")
    candidate.write_text(dumps(tree)+"\n",encoding="utf-8")
    result = {
        "status": "Unassigned proposal; native geometry and DRC must be tested before adoption",
        "base_footprint": BASE.relative_to(ROOT).as_posix(),
        "base_sha256": hashlib.sha256(base).hexdigest(),
        "candidate_footprint": candidate.relative_to(ROOT).as_posix(),
        "candidate_sha256": hashlib.sha256(candidate.read_bytes()).hexdigest(),
        "preserved": {"pad_number":"5", "anchor_mm":[.6775,-.710], "anchor_diameter_mm":.1,
                      "copper_outer_mm":1.725,"copper_inner_mm":.985,"npth_mm":.6,
                      "mask_outer_mm":1.825,"mask_inner_mm":.885,"paste_sectors":3},
        "candidate_copper_quarters": 4, "candidate_mask_quarters":4,
        "tessellation": {"segments_per_quarter":90,"angle_step_degrees":1,
                         "maximum_inner_chord_radial_error_mm":.4925*(1-math.cos(math.radians(.5))),
                         "minimum_copper_to_npth_mm":.4925*math.cos(math.radians(.5))-.3},
        "preferred_native_file_default_pad_shape_mm":polygon_shape(),
        "preferred_native_file_default_pad_shape_mil":polygon_shape(1/.0254),
        "native_shape_coordinate_note":"Shapes are relative to the unchanged current pad anchor (+0.6775,-0.710) in source footprint coordinates. Confirm imported anchor/rotation/mirror and actual File Source units before replacing its default shape; use that sample to adapt signs. Keep all other pad fields and net/pin number intact.",
        "native_verification": "Native complex polygons have nonzero fill; use opposite contour winding for an inner hole. The supplied file shape is the official legacy-v2 POLY array form. Current 3.x File Source can use an object defaultPad with padType POLYGON; do not substitute the legacy payload before checking a real native sample. The API enum is POLYGON and is also distinct from the legacy file token.",
        "sources":["https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/primitives/pad.md",
                   "https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/complex-polygon.md",
                   "https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/single-polygon.md",
                   "https://prodocs.easyeda.com/en/api/reference/pro-api.tpcb_primitivepadshape.html",
                   "https://raw.githubusercontent.com/easyeda/easyeda-pro-format-skill/main/primitives/PCB/pad.md",
                   "https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf"]}
    (HERE / "mic-annulus-repair-proposal.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))


if __name__ == "__main__": main()
