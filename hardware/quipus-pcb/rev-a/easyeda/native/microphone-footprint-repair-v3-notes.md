# Native microphone correction — v3

**Historical candidate notes.** The native canonical successor `microphone-footprint-final.esource` has been accepted, saved and propagated to both U20/U21. All six new-quarter instance pads are bound to GND. Final native DRC has0 clearance findings,451 unrouted connection errors and1 schematic metadata mismatch. Use `microphone-footprint-final-notes.md` and its audit for current status and the native paste-width variance. The candidate-level pending statements below describe the pre-canonical investigation only.

File: `microphone-footprint-repaired-v3.esource`.
SHA256: `cc8672d7942591db2de8381827f7f569f5808560da46e005697545b156f1045d`.

This candidate fixes the actual EasyEDA Pro 3.2.149 microphone footprint. Local geometry and preservation checks pass; native v3 rendering, PCB-instance refresh, DRC and Gerber verification remain pending. It does not route the board or authorize fabrication.

## Copper and routing anchors

Four ordinary concave polygon PAD records form one contiguous GND annulus with shared electrical number **5**. The original native ID `ie18` remains; three new PAD IDs are `e98cf8df8e4f9e762`, `ed9b807e727b4e48d` and `ef5dca8a7d237bfba`. Every quarter is an explicit closed flat L-path with 182 vertices. Adjacent quarters share the same radial boundaries.

Actual native rendering proved that `PAD.defaultPad.path` coordinates are **absolute footprint coordinates**, independent of the pad origin. The v3 paths therefore include the acoustic centre at native (0, −27.9528 mil), approximately (0, −0.71000112 mm). The four pad origins are separately placed inside the copper wall at a 0.6775 mm radius so the router can contact actual GND copper.

| Native pad ID | Anchor X mm | Anchor Y mm | Electrical number |
|---|---:|---:|---|
| ie18 | +0.6775 | −0.71000112 | 5 |
| e98cf8df8e4f9e762 | 0 | −0.03250112 | 5 |
| ed9b807e727b4e48d | −0.6775 | −0.71000112 | 5 |
| ef5dca8a7d237bfba | 0 | −1.38750112 | 5 |

The nominal copper outer/inner diameters are **1.725 / 0.985 mm**. One-degree arc chords produce at most 0.000032842 mm outer radial error and 0.000018753 mm inner radial error. The native rounded **0.60000134 mm unplated hole** is preserved, giving minimum actual polygon-to-hole clearance **0.192480577 mm**. The acoustic centre is outside every copper quarter; every origin is inside its corresponding quarter, at least 0.184992956 mm from the copper boundary.

The native editor did not render nested `CIRCLE` compound PAD paths in v1. It rendered v2 flat polygons around footprint (0,0), revealing the absolute-coordinate convention. V3 uses the captured flat path syntax and native-observed absolute coordinates. The older Pro persisted-format relative-origin description is not applied to this 3.2.149 object source.

## All other acoustic lands

Pins 1–4 have independently checked centres and identities matching the assigned Infineon land pattern after the bottom-side X reflection. Their copper positions and shapes remain unchanged, within native rounding of 0.000002 mm.

| Pin | Function | Native ID | X mm | Y mm |
|---|---|---|---:|---:|
| 1 | VDD | ie10 | +0.838 | +1.364 |
| 2 | CLK | ie12 | +0.838 | +0.542 |
| 3 | DATA | ie14 | −0.838 | +1.364 |
| 4 | LR | ie16 | −0.838 | +0.542 |

Signal copper remains **0.75 × 0.54 mm**, with 0.05 mm solder-mask expansion. Four independent signal stencil rectangles remain **0.63 × 0.47 mm**. The copper-only electrical pads suppress automatic full-pad paste through custom top/bottom paste expansion **−1000**, following the official Pro FAQ. Their explicit stencil shapes remain present.

The three imported ground-paste sectors were centred approximately 1.42 mm away from the acoustic hole. Their centre and orientation now match the land pattern, with **exact native arc radii 0.54 / 0.83 mm**, 110° / 100° / 100° sector spans and 15° / 20° / 15° gaps. The smallest inner-radius gap is approximately 0.141 mm. All seven explicit paste fills have zero boundary stroke, removing the importer-added 0.2 mil stroke.

The explicit mask annulus is concentric with the acoustic NPTH and has exact **1.825 / 0.885 mm outer/inner diameters**. The entire NPTH record `ie23` is unchanged: same centre, round hole, layer12, empty pin number, unplated. Fab outline, courtyard, pin1 marker and attributes remain unchanged. All pre-existing IDs, tickets, pad numbers, nets and layer assignments remain intact; three additional num5 PAD records are intentional.

## Reproduction and acceptance

Run these scripts from the repository root in order:

```text
python hardware/quipus-pcb/rev-a/easyeda/native/repair_microphone.py
python hardware/quipus-pcb/rev-a/easyeda/native/repair_microphone_v2.py
python hardware/quipus-pcb/rev-a/easyeda/native/repair_microphone_v3.py
python hardware/quipus-pcb/rev-a/easyeda/native/render_microphone_repair.py hardware/quipus-pcb/rev-a/easyeda/native/microphone-footprint-repaired-v3.esource
```

The exact before/after audit is `microphone-footprint-repaired-v3.audit.json`. `microphone-footprint-repaired-v3.png` is a locally rendered copper/paste/mask closeup derived directly from this candidate; it has been visually checked. Crosses on its copper view mark the four copper-contained routing anchors. The drawing is not a native editor or Gerber verification.

The native acceptance check must refresh both **U20 and U21**, preserve their placements, bind all four num5 copper quarters to **GND**, and verify concentric copper/NPTH/mask/paste. Both microphone copper-to-hole DRC errors should disappear. Native copper, mask, stencil and NPTH-drill exports require inspection before fabrication, particularly confirmation of no paste over the acoustic hole. The PCB still needs routing and complete native DRC/ERC qualification.

## Primary geometry and format references

- [Infineon IM69D128S datasheet, Figures12–13](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf): PG-TLGA-5-2 package, pin identity, copper/mask/stencil dimensions. No IM69D130 substitution.
- [EasyEDA Pro current pad object fields](https://raw.githubusercontent.com/easyeda/easyeda-pro-format-skill/main/primitives/PCB/pad.md): pad identity, origin, shape and numeric mask/paste expansion fields.
- [EasyEDA Pro polygon source API](https://prodocs.easyeda.com/en/api/reference/pro-api.tpcb_polygonsourcearray.html): flat L-paths, signed ARC syntax and automatic closure.
- [EasyEDA Pro PCB FAQ](https://prodocs.easyeda.com/en/faq/pcb/): zero paste expansion matches copper; custom −1000 suppresses automatic paste.
