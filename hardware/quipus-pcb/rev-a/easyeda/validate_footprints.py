"""Independent structural/pin crosscheck; no CAD ERC/DRC or manufacturing claim.

Reads source circuits and footprint manifests without editing them.
Run: python hardware/quipus-pcb/rev-a/easyeda/validate_footprints.py
"""
import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
REV = ROOT / "hardware/quipus-pcb/rev-a"
ALIASES = {"3V3": "3V3_SYS", "3V3_MAIN": "3V3_SYS", "SYS_SW": "MAIN_RAW"}


def sexp(text):
    tokens = re.findall(r'"(?:\\.|[^"\\])*"|[()]|[^\s()]+', text)
    stack, result = [], None
    for token in tokens:
        if token == "(":
            node = []
            if stack:
                stack[-1].append(node)
            else:
                result = node
            stack.append(node)
        elif token == ")":
            if not stack:
                raise ValueError("Unexpected closing parenthesis")
            stack.pop()
        else:
            stack[-1].append(token[1:-1] if token.startswith('"') else token)
    if stack:
        raise ValueError("Unclosed S-expression")
    return result


def child(node, key):
    return next((item[1:] for item in node if isinstance(item, list) and item and item[0] == key), [])


def pad_nodes(ast):
    return [x for x in ast if isinstance(x, list) and x and x[0] == "pad"]


def canonical_net(net):
    return ALIASES.get(net, net)


def main():
    failures, warnings = [], []
    sources, footprints, provenance = {}, {}, {}
    for domain in ("power", "controller", "audio"):
        circuit = json.loads((REV / f"{domain}-circuit.json").read_text(encoding="utf-8"))
        for comp in circuit.get("parts", circuit.get("components", [])):
            if comp["ref"] in sources:
                failures.append(f"Duplicate source ref {comp['ref']}")
            sources[comp["ref"]] = comp
        manifest = json.loads((REV / f"easyeda/footprints-{domain}.json").read_text(encoding="utf-8"))
        for comp in manifest["components"]:
            if comp["ref"] in footprints:
                failures.append(f"Duplicate footprint ref {comp['ref']}")
            footprints[comp["ref"]] = comp
            provenance[comp["ref"]] = domain
    if set(sources) != set(footprints):
        failures.append(f"Reference mismatch: missing {sorted(set(sources)-set(footprints))}, extra {sorted(set(footprints)-set(sources))}")
    parsed = {}
    nets = defaultdict(list)
    for ref, source in sources.items():
        assignment = footprints.get(ref)
        if not assignment:
            continue
        path = ROOT / assignment["footprint_file"]
        if not path.is_file():
            failures.append(f"{ref}: missing file {path}")
            continue
        if assignment.get("sha256") and hashlib.sha256(path.read_bytes()).hexdigest() != assignment["sha256"]:
            failures.append(f"{ref}: stale footprint checksum")
        try:
            ast = parsed.setdefault(str(path), sexp(path.read_text(encoding="utf-8")))
        except (ValueError, IndexError) as exc:
            failures.append(f"{ref}: malformed footprint {exc}")
            continue
        pads = pad_nodes(ast)
        copper = {p[1] for p in pads if p[2] != "np_thru_hole" and any(x.endswith(".Cu") for x in child(p, "layers"))}
        mapping = assignment.get("pad_mapping", assignment.get("padmap", {}))
        net_mapping = assignment.get("expected_pad_mapping", {})
        for pin in source["pins"]:
            num = str(pin["number"])
            physical = str(mapping.get(num, num))
            if physical not in copper:
                failures.append(f"{ref}.{num}: missing actual copper pad {physical}")
            if net_mapping and num in net_mapping and canonical_net(net_mapping[num]) != canonical_net(pin.get("net")):
                failures.append(f"{ref}.{num}: manifest net contradicts source circuit")
            if pin.get("net"):
                nets[canonical_net(pin["net"])].append(f"{ref}.{num}")
    # These pin maps were independently checked against the manufacturer's
    # current datasheet tables, not derived from the footprint inventories.
    expected = {
        "U11": {"1": "SYS_SW", "2": "GND", "3": "GND", "4": "3V3_FB", "5": "3V3_PG", "6": "3V3", "7": "BUCK_L2", "8": "GND", "9": "BUCK_L1", "10": "SYS_SW"},
        "U13": {"1": "USB_CC1", "2": "USB_CC2", "3": "GND"},
        "U35": {"1": "USB_DP", "2": "USB_DM", "3": "GND"},
        "U34": {"1": "USB_DP_ISO", "2": "USB_DM_ISO", "3": "USB_UNUSED_DP", "4": "USB_UNUSED_DM", "5": "GND", "6": "GND", "7": "USB_DM", "8": "USB_DP", "9": "GND", "10": "3V3"},
        "U20": {"1": "MIC_3V3", "2": "PDM_CLK_LOCAL", "3": "U20_D", "4": "GND", "5": "GND"},
        "U21": {"1": "MIC_3V3", "2": "PDM_CLK_LOCAL", "3": "U21_D", "4": "MIC_3V3", "5": "GND"},
        "U22": {"1": "I2S1_DOUT_IC", "2": "AMP_GAIN", "3": "GND", "4": "AMP_ENABLE", "5": None, "6": None, "7": "SYS_SW", "8": "SYS_SW", "9": "SPK_P", "10": "SPK_N", "11": "GND", "12": None, "13": None, "14": "I2S1_WS_IC", "15": "GND", "16": "I2S1_BCLK_IC", "17": "GND"},
    }
    for ref, pins in expected.items():
        actual = {str(p["number"]): canonical_net(p.get("net")) for p in sources[ref]["pins"]}
        if actual != {n: canonical_net(v) for n, v in pins.items()}:
            failures.append(f"{ref}: independently reviewed electrical pin map disagrees with circuit")
    for net, entries in nets.items():
        if len(entries) == 1:
            warnings.append(f"Single-contact net {net}: {entries[0]}")
    # Same exact ESD MPN appears twice. Geometry should be identical in both roles.
    def geometry(ref):
        a = footprints[ref]
        ast = parsed[str(ROOT / a["footprint_file"])]
        return [(p[1], child(p, "at"), child(p, "size"), child(p, "layers")) for p in pad_nodes(ast) if p[1]]
    if geometry("U13") != geometry("U35"):
        warnings.append("U13/U35 same TPD2EUSB30DRTR MPN has different copper lands; unify to source-reviewed DRT footprint")
    # Check the microphone's custom circle is not filled by an anchor at centre.
    mic_ast = parsed[str(ROOT / footprints["U20"]["footprint_file"])]
    p5 = next(p for p in pad_nodes(mic_ast) if p[1] == "5")
    anchor = [float(v) for v in child(p5, "at")[:2]]
    primitive = child(p5, "primitives")[0]
    centre = [float(v) for v in child(primitive, "center")]
    centre = [anchor[i] + centre[i] for i in range(2)]
    size = [float(v) for v in child(p5, "size")]
    distance = math.dist(anchor, centre)
    if distance - max(size)/2 <= 0.3:
        failures.append("Mic pad5 anchor covers acoustic hole")
    if any(isinstance(x, list) and x and x[0] == "fp_arc" and child(x, "layer") == ["F.Paste"] for x in mic_ast):
        warnings.append("Mic thick paste arcs need overlap check; prefer explicit separated annular sectors")
    result = {"status": "pass" if not failures else "fail", "circuit_refs": len(sources), "assigned_refs": len(footprints), "unique_footprint_files": len(parsed),
              "canonical_net_count": len(nets), "net_aliases": ALIASES, "failures": failures, "warnings": warnings,
              "scope": "Source pin, actual copper pad, file/checksum and selected manufacturer pin checks; not native ERC/DRC"}
    print(json.dumps(result, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

