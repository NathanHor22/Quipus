"""Bundle the independently checked B1 placement and native EasyEDA evidence.

This is a review package. It deliberately does not emit fabrication Gerbers or
claim that the unrouted board is ready to order.
"""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "output/pcb/Quipus-B1-EasyEDA"
NATIVE = HERE / "native"
PROJECT_ID = "0960404b6cb74e4c9e220d0e9c82a5cd"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    local = json.loads((OUT / "import-validation.json").read_text(encoding="utf-8"))
    native = json.loads((NATIVE / "native-audit.json").read_text(encoding="utf-8"))
    if any(v != "PASS" for v in native["category_results"].values()):
        raise ValueError("Native capture checks must pass before bundling final evidence")
    if "pcb-final" not in native["capture"]:
        raise ValueError("Expected an independently checked final native capture")
    native_out = OUT / "native"
    native_out.mkdir(exist_ok=True)
    for name in ("pcb-final.epro2", "pcb-final.esource", "native-audit.json",
                 "pcb-drc-snapshot.txt", "schematic-erc-snapshot.txt"):
        shutil.copyfile(NATIVE / name, native_out / name)
    shutil.copyfile(HERE / "final-engineering-review.md", OUT / "final-engineering-review.md")
    shutil.copyfile(HERE / "README.md", OUT / "README.md")
    pdf = ROOT / "output/pdf/Quipus-B1-PCB-placement-update.pdf"
    if pdf.exists():
        shutil.copyfile(pdf, OUT / pdf.name)
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    manifest.update(
        status="Saved schematic and PCB placement revision; copper routing remains",
        manufacturing_release=False,
        easyeda_project_id=PROJECT_ID,
        easyeda_project_url=f"https://pro.easyeda.com/editor#id={PROJECT_ID}",
        native_capture_sha256=native["capture_sha256"],
        native_capture_checks=native["category_results"],
        native_erc={"fatal": 0, "errors": 0, "warnings": 0, "information": 8,
                    "notes": "Start/end entries and unmatched mechanical/acoustic pads; see saved native snapshot"},
        native_drc={"connection_errors": 543, "other_errors": 0,
                    "notes": "Unrouted connections remain; this is not a routed DRC pass"},
        carrier_sha256=sha(OUT / "Quipus-B1.kicad_pcb"),
        schematic_sha256=sha(OUT / "Quipus-B1.kicad_sch"),
        release_holds="See final-engineering-review.md and README.md",
    )
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    archive = OUT.parent / "Quipus-B1-EasyEDA-import.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(OUT.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(OUT).as_posix())
    print(json.dumps({"archive": str(archive), "sha256": sha(archive),
                      "manufacturing_release": False, "native": native["category_results"]}))


if __name__ == "__main__":
    main()
