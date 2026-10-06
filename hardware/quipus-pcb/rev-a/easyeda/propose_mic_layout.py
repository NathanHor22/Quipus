"""Validate a four-part lower microphone placement proposal without PCB edits."""
from pathlib import Path
import hashlib
import json
import math
from kicad_format import parse, children, child, child_values
from validate_placement import outline_polygons, world, overlaps, pad_polygon, bounds, rectangle

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BOARD = ROOT / "output/pcb/Quipus-A1-EasyEDA/Quipus-A1.kicad_pcb"
PATCH = {"U21": [59.25, 93.0, 0, "B"], "R202": [56.0, 94.3, 0, "B"],
         "C202": [62.8, 91.2, 180, "B"], "C203": [62.8, 93.7, 180, "B"]}


def main():
    board_data = BOARD.read_bytes()
    tree = parse(board_data.decode("utf-8"))
    assignments = {}
    for domain in ("power", "controller", "audio"):
        data = json.loads((HERE/f"footprints-{domain}.json").read_text(encoding="utf-8"))
        assignments.update({c["ref"]: c for c in data["components"]})
    from kicad_format import load_footprint
    rows = []
    for mod in children(tree,"module"):
        ref = next(str(n[2]) for n in children(mod,"fp_text") if n[1] == "reference")
        if ref in PATCH:
            # Rebuild only the in-memory proposal module so pad angles and the
            # reflected footprint geometry correctly match a changed rotation.
            x,y,angle,side=PATCH[ref]
            mod = parse(load_footprint(ROOT/assignments[ref]["footprint_file"],ref,assignments[ref]["value"],x,y,angle,side))
        origin=(list(map(float,child_values(mod,"at")))+[0])[:3]
        side="B" if child_values(mod,"layer")[0]=="B.Cu" else "F"
        polys=[[world(p,origin) for p in poly] for poly in outline_polygons(mod)]
        rows.append({"ref":ref,"side":side,"origin":origin,"module":mod,"courtyards":polys,
                     "pads":[(p,pad_polygon(p,origin)) for p in children(mod,"pad")]})
    by_ref={r["ref"]:r for r in rows}
    conflicts=[]; mounts=[];pth=[];edge=[]
    for ref in PATCH:
        row=by_ref[ref]
        for other in rows:
            if other["ref"]==ref:continue
            if other["ref"].startswith("H"):
                if any(overlaps(a,b) for a in row["courtyards"] for b in other["courtyards"]):
                    mounts.append([ref,other["ref"]])
                continue
            if row["side"]==other["side"] and any(overlaps(a,b) for a in row["courtyards"] for b in other["courtyards"]):
                pair=sorted((ref,other["ref"]))
                if pair not in conflicts:conflicts.append(pair)
            if row["side"]!=other["side"]:
                for pad,poly in other["pads"]:
                    if pad[2]=="thru_hole" and any(overlaps(poly,p) for p in row["courtyards"]):
                        pth.append([ref,other["ref"],str(pad[1])])
        for pad,poly in row["pads"]:
            if pad[2]=="np_thru_hole" or not any(str(n).endswith(".Cu") for n in child_values(pad,"layers",[])):continue
            x0,y0,x1,y1=bounds(poly)
            if min(x0,y0,65-x1,105-y1)<0.25:
                edge.append({"ref":ref,"pad":str(pad[1]),"bounds_mm":bounds(poly)})
    # Actual reflected pad centres; useful to choose the bypass capacitor's VDD
    # end toward the nearby mic pin1 instead of adding a needless long detour.
    def pin(ref,num):
        row=by_ref[ref]
        p=next(p for p in children(row["module"],"pad") if str(p[1])==str(num))
        return world(tuple(map(float,child_values(p,"at")[:2])),row["origin"])
    hole=next(p for p in children(by_ref["U21"]["module"],"pad") if p[2]=="np_thru_hole")
    port=world(tuple(map(float,child_values(hole,"at")[:2])),by_ref["U21"]["origin"])
    result={"status":"proposal only; parent must apply/rebuild and rerun actual-board checks",
            "units":"mm","base_board_file":str(BOARD.relative_to(ROOT)).replace("\\","/"),
            "base_board_sha256":hashlib.sha256(board_data).hexdigest(),"placements":PATCH,
            "unchanged":"U20 and its R201/C200/C201 remain at the top; all electrical pins/nets unchanged",
            "proposal_fit":{"same_face_courtyard_conflicts":conflicts,"mounting_head_conflicts":mounts,
                            "opposite_face_pth_conflicts":pth,"copper_edge_issues":edge,
                            "courtyard_bounds_mm":{ref:[bounds(p) for p in by_ref[ref]["courtyards"]] for ref in PATCH}},
            "acoustic_port_mm":port,"mic_pin1_vdd_mm":pin("U21",1),"mic_pin3_data_mm":pin("U21",3),
            "vdd_to_100nf_pad1_straight_mm":math.dist(pin("U21",1),pin("C203",1)),
            "vdd_to_1uf_pad1_straight_mm":math.dist(pin("U21",1),pin("C202",1)),
            "data_to_series_resistor_pad1_straight_mm":math.dist(pin("U21",3),pin("R202",1)),
            "warnings":["Distances are straight-line pin-centre distances, not routed trace lengths.",
                        "Case requires an unobstructed 0.60 mm PCB sound port at (59.25,92.29); do not cover with pouch, ribs, screw boss or speaker back volume.",
                        "If sound must enter from the lower case edge, provide a short sealed acoustic duct from that opening to this front-facing PCB port and test acoustic response.",
                        "Keep clock/data with continuous ground return, away from amp output/buck switching; the long shared PDM bus needs scope validation."]}
    (HERE/"mic-placement-patch.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))


if __name__=="__main__":main()
