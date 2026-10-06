# Native IM69D128S footprint repair candidate

**Superseded investigation notes. Use `microphone-footprint-final.esource` and `microphone-footprint-final-notes.md`.** The native canonical footprint is accepted and saved, both instances are refreshed and all six new-quarter instance pads are bound to GND. Final native DRC has0 clearance findings,451 unrouted connection errors and1 schematic metadata mismatch. Actual native rendering rejected both earlier candidates: nested `CIRCLE` paths did not draw, and flat polygon paths proved to be absolute footprint coordinates rather than legacy relative coordinates. These historical notes retain earlier hypotheses for audit only.

**Current candidate: `microphone-footprint-repaired-v2.esource`**, SHA256 `34f09d09b4cc6e47da671be6dfe8399aad4007e8a0627d554d79e90f01735d4a`. The native editor did not render the v1 nested `CIRCLE` compound PAD path, so v1 is rejected. V2 encodes four ordinary flat concave quarter POLYGON pads sharing electrical number **5**, using the exact L-path syntax already present in the captured native source. `ie18` remains; three new PAD records have IDs `e98cf8df8e4f9e762`, `ed9b807e727b4e48d` and `ef5dca8a7d237bfba`. Existing pin numbers, nets, layers and identities remain unchanged. All signal, NPTH, mask and paste corrections described below are retained. Native rendering and DRC acceptance for v2 are pending.

Each quarter has 182 vertices; adjacent quarters share identical radial edges. The nominal OD/ID are 1.725/0.985 mm. One-degree chords produce at most 0.000032842 mm outer radial error and 0.000018753 mm inner radial error. The locally checked minimum copper-to-NPTH gap is **0.192480577 mm**. The acoustic centre lies outside all four copper polygons. Each quarter retains the NPTH-centre origin for this correction; when routing, contact actual GND copper, rather than the origin inside the acoustic hole. Once native coordinate behaviour is confirmed, each origin can be rebased onto its copper wall without moving the visible land.

Run `repair_microphone.py` followed by `repair_microphone_v2.py` to reproduce v2. Its precise audit is `microphone-footprint-repaired-v2.audit.json`. `render_microphone_repair.py microphone-footprint-repaired-v2.esource` produces the inspected three-layer closeup `microphone-footprint-repaired-v2.png` from actual candidate geometry. These are local checks, not native DRC or manufacturing approval.

## V1 investigation and retained corrections

Prepared 1 October 2026 from the actual EasyEDA Pro 3.2.149 footprint File Source. The repair is `microphone-footprint-repaired.esource`; its SHA256 is `a458118bb599912f6e257bc47d5282daffa7ec63361ea0199151303998baa8e4`. The complete before/after record diff and local checks are in `microphone-footprint-repaired.audit.json`. `repair_microphone.py` reproduces the repair without editing the PCB or assigned KiCad source.

This is a **candidate pending native rendering, library refresh, DRC and Gerber inspection**. The captured object format stores `defaultPad.path`; the official persisted PAD format describes the polygon coordinates as relative to the pad/hole origin. The current API accepts a compound polygon, but does not separately restate its origin convention. Native visual alignment must confirm this assumption before accepting the repair.

## Independently checked electrical lands

Coordinates below are the native editor's mil values converted to millimetres. They match the assigned manufacturer footprint after its defined bottom-side X reflection to within 0.000002 mm. Signal copper dimensions remain 0.75 × 0.54 mm. Their numbers, native IDs, centres and copper shapes are unchanged.

| Pin | Function | Native ID | X mm | Y mm |
|---|---|---|---:|---:|
| 1 | VDD | ie10 | +0.838 | +1.364 |
| 2 | CLK | ie12 | +0.838 | +0.542 |
| 3 | DATA | ie14 | −0.838 | +1.364 |
| 4 | LR | ie16 | −0.838 | +0.542 |
| 5 | GND annulus centre | ie18 | 0 | −0.710 |
| — | Unplated acoustic hole | ie23 | 0 | −0.710 |

The pin-5 origin moves from the imported anchor at approximately (−0.6775, −0.710) mm to the acoustic centre. Its **electrical identity stays pin 5**. A native POLYGON shape has no separate mandatory filled KiCad anchor primitive. Two relative `CIRCLE` contours with opposite winding therefore define an empty-centred annulus at that origin. This changes the incorrect imported polygon into the intended copper land; it does not relocate the acoustic land or any of pins 1–4.

## Defects corrected

- The imported custom circle stroke was lost: the native pad path approximated a filled disk of centreline radius 0.6775 mm, plus the small anchor, rather than a copper annulus. Its path also retained footprint-level coordinates despite the displaced origin. The replacement uses **exact copper OD 1.725 / ID 0.985 mm** with one shared origin.
- The native three ground-paste FILL sectors were centred at Y ≈ +0.710 mm while the NPTH and mask were centred at −0.710 mm. Their geometry was Y-reflected during graphic import. The replacement restores their centre and orientation from the assigned bottom-footprint geometry, with **exact 0.54 / 0.83 mm radii**, original 110° / 100° / 100° spans and 15° / 20° / 15° gaps. Two native circular arcs per sector replace the polygon approximation.
- The importer set all five copper pads' automatic paste expansion to zero, creating full copper-size paste in addition to explicit manufacturer apertures. Automatic top and bottom paste is suppressed with **−1000**, following EasyEDA Pro's documented method. Four explicit **0.63 × 0.47 mm** signal apertures and three ground sectors remain.
- All seven explicit paste FILLs lose the importer's 0.2 mil boundary stroke so aperture outlines stay nominal. The four signal aperture contours and positions are otherwise unchanged.
- The correctly positioned mask ring is normalized to exact **OD 1.825 / ID 0.885 mm**, still concentric with the NPTH. Signal mask expansion remains 0.05 mm. Its former rounding errors were below 0.000002 mm.

The entire unnumbered NPTH record is unchanged: layer 12, round hole approximately 0.60000134 mm from native rounding, unplated, same origin. Fab outline, courtyard, pin-1 marker, attributes, all record IDs/tickets, pad numbers, layer IDs and blank library nets are preserved. No records are added or removed. There are 13 changed records.

## Local geometric results and native acceptance

The intended copper-to-NPTH spacing is **0.1925 mm** (actual native rounded-hole calculation 0.19249933 mm). The smallest stencil-sector gap at the 0.54 mm radius is approximately **0.141 mm**. Both circles in the copper compound path have the same local centre and opposite winding; the central disk is empty.

`render_microphone_repair.py` draws `microphone-footprint-repaired.png` directly from repaired native geometry. It shows copper, explicit stencil apertures and mask separately with the same NPTH centre. The native positive-Y coordinate direction is plotted upward. This local drawing does not prove the editor interprets the stored relative origin identically.

The parent must inspect the edited native footprint, refresh **both U20 and U21** without moving their component origins, and rerun native DRC. Accept only if the copper annulus, mask and three sectors are concentric with the acoustic hole, pin numbers still map correctly, and the two native microphone copper/hole errors disappear. Exported paste/mask/copper and the NPTH drill must be checked separately, including confirmation that no automatic paste is generated over the hole. The remaining unrouted connections are a separate layout task; this correction does not route the board.

## Primary references

- [Infineon IM69D128S datasheet, Figures 12–13](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf): the selected PG-TLGA-5-2 package and manufacturer lands. The IM69D130 footprint is not substituted.
- [EasyEDA Pro persisted PAD format](https://prodocs.easyeda.com/en/format/pcb/pad_via/): polygon defined relative to the hole origin.
- [Current Pro pad-shape API](https://prodocs.easyeda.com/en/api/reference/pro-api.tpcb_primitivepadshape.html): compound polygons supported as arrays of source contours.
- [Official Pro complex-polygon definition](https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/complex-polygon.md) and [circle/arc syntax](https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/single-polygon.md): nonzero winding subtraction, opposite circular contours, exact arcs.
- [EasyEDA Pro PCB FAQ, unwanted paste-mask removal](https://prodocs.easyeda.com/en/faq/pcb/): zero expansion matches copper; custom −1000 suppresses automatic paste.
