# Quipus A1 — physical EasyEDA import carrier

This directory defines the physical footprints and placement used to build the custom Quipus recorder PCB. The import package is in `output/pcb/Quipus-A1-EasyEDA/`; its principal files are `Quipus-A1.kicad_sch` and `Quipus-A1.kicad_pcb`. The native EasyEDA design must be checked after importing those files.

The carrier has a 65 × 105 mm, 1.6 mm thick, four-layer board, 144 electrical components, 92 canonical nets and four additional mounting-hole footprints. Its 31 distinct physical packages are included in `Quipus.pretty/`. The front includes a non-electrical screen-envelope guide and the user buttons. Rear connectors include the battery, speaker, digital-microphone expansion and microSD socket. USB-C is at the bottom; the card socket opens toward the right side when viewed from the front. Both embedded microphone packages are mounted on the rear and receive sound through actual 0.60 mm non-plated board holes.

## Files and authority

| File | Purpose |
| --- | --- |
| `footprints-power.json`, `footprints-controller.json`, `footprints-audio.json` | Per-reference physical package, physical pad mapping, source and footprint SHA-256 |
| `placement.json` | Applied component position, rotation, face and mechanical envelopes; parent-owned |
| `kicad_format.py` | Conversion of physical footprint geometry into the legacy PCB import format |
| `build_import.py` | Builds the PCB, flat self-contained schematic, footprint library, CSVs and ZIP from the canonical source netlist |
| `validate_footprints.py` | Independent source-net/pin coverage, footprint pad numbering and checksum checks |
| `validate_import.py` | Independent final-carrier electrical associations and geometry-conversion audit |
| `validate_placement.py` | Independent actual-board physical placement audit |
| `render_placement.py` | Renders actual PCB pads, drilled holes, fabrication outlines, board edge and keepouts into a labelled front/rear PNG |
| `mic-placement-patch.json` | A four-part lower-microphone proposal against a recorded board hash; generating it does not change the PCB itself |

The circuit JSONs and `output/pcb/Quipus-A1/connections.json` establish electrical connections. A placement change does not alter their pin numbers or nets. The generated board is the authority for the preview; its SHA-256 appears in the preview and validation reports. Rear preview geometry is mirrored so it is a component-side view. The screen rectangle is a mounting guide for an off-board display, not an invented populated PCB component.

## Local checks

Run from the repository root with Python. Pillow is needed only for the PNG renderer.

```powershell
python hardware/quipus-pcb/rev-a/easyeda/validate_footprints.py
python hardware/quipus-pcb/rev-a/easyeda/build_import.py
python hardware/quipus-pcb/rev-a/easyeda/validate_import.py
python hardware/quipus-pcb/rev-a/easyeda/validate_placement.py
python hardware/quipus-pcb/rev-a/easyeda/render_placement.py
```

`build_import.py` rewrites generated import outputs using the current applied `placement.json`. It does not apply a proposal file. The independent audits and preview must be rerun after rebuilding, and the import ZIP must be refreshed after any file included in it changes.

The footprint audit checks the exact pad numbers against each circuit reference, including shared/repeated copper pads and unnumbered mechanical pads. The carrier audit compares the final schematic and PCB with canonical source pins/nets, checks every imported copper pad and graphic primitive, and tests the microphone annuli/paste, exposed pads, SD detector contacts and RF keepouts. The placement audit uses actual stitched courtyard polygons; it also checks front/back plated-through-hole interference, copper-to-edge clearance, mounting-head space, screen interference, connector direction and RF component exclusion on all four copper layers. Pad outlines in the geometric placement test use conservative rotated rectangles; circular mounting keepouts use 48-segment polygons.

Read `output/pcb/Quipus-A1-EasyEDA/import-validation.json` and `placement-validation.json` in this directory for the latest board hash and check results. Local checks do not exercise the native EasyEDA importer or native CAD rule engines.

## Verification status

| Stage | Status |
| --- | --- |
| Physical package/pad mapping and source comparison | Locally audited; details in the three footprint-review documents and `footprint-crosscheck.md` |
| Final carrier pin/net association and converted geometry | Local audit available in `import-validation.json` |
| Applied PCB physical placement | Local audit available in `placement-validation.json` |
| Native EasyEDA import and comparison of rendered package geometry | Imported; corrected microphone ground annuli accepted and saved in the native library, refreshed on U20/U21, with all eight quarter pads connected to GND |
| Native EasyEDA electrical-rule check (ERC) | Nine organized A3 schematic pages: 0 fatal findings, 0 errors, 0 warnings, 9 informational findings |
| Copper routing and ground pours | **Not complete** |
| Native PCB design-rule check (DRC) | Final native run: 451 unrouted connection findings, one schematic import metadata mismatch, **0 clearance findings**; routing remains incomplete |
| Fabrication release | **Not approved; this is an unrouted engineering carrier** |

Native cloud project: **Quipus A1 – Hardware Rev A**, ID `522f339b1e454ea3a6b4b8e11788511f`, PCB document `52caa9452ee66dee`; review date 1 October 2026. The nine schematic pages are ordered by function: USB-C/charger, USB current/suspend, power switch/always-on supply, main regulator, fuel gauge, processor/display/SD, controller support, buttons/service, and microphones/speaker. Native page sources retain all 144 references, 92 nets and 471 symbol pins. The final schematic-to-PCB import preview filtered for net changes contains no rows; the preview was cancelled because device metadata and the four PCB-only mounting holes still need deliberate synchronization. Evidence is in `native/`. A successful local audit or a visually plausible placement is not a routing or manufacturing sign-off.

The generated KiCad carrier and its ZIP do **not** incorporate the separate native microphone correction. Future reimports must preserve or reapply `native/microphone-footprint-final.esource` and verify all four pad-5 ground quarters on each microphone. The accepted native source checksum and native DRC evidence are separate from the generated-carrier checksum.

The current CAD-derived PNG and local placement report refer to PCB SHA-256 `5f48361c2ff1a57b59c6621943f8e72196b9cb33372bc079969b886fc56f1d6c`. Its top and bottom microphone ports are at (5.75,9.49) and (59.25,92.29) mm respectively. The lower bypass/series group has been applied; proposal files remain a record of the earlier geometry check, not the authority for the generated board. All 65 revised component positions/rotations/faces were also checked in native PCB Properties. The layout places charger/current-limit parts together on the lower front, the battery connectors toward the rear left, and the compact converter/distribution group on the lower rear. These groupings aid subsequent routing; zero placement collisions do not prove signal integrity or thermal performance.

## Specific native and assembly checks

After import, inspect the two Infineon microphone land patterns at high zoom: pin 5 is a copper annulus with an empty centre, the sound aperture is 0.60 mm NPTH, and its three paste sectors must remain separate. The native annulus uses four touching polygon pads, all numbered 5 and all assigned GND. Confirm the ESP32-S3 antenna notch and RF exclusion remain on all four copper layers; compare all USB-C shared contacts, the BQ27441 exposed-pad geometry, the MAX98357A exposed pad and the Hirose card detector pads against the source footprint files. Then use the actual native rules and the PCB fabricator's published tolerances for routing and final checks.

The microphone copper-to-sound-hole edge separation is 0.1925 mm and needs confirmation with the intended fabricator. Microphone stencil apertures and acoustic hole cleanliness need assembler review. The case must preserve both acoustic paths and microSD insertion/ejection clearance, and it must leave USB-C accessible. An external LiPo pouch, case rib or speaker chamber must not cover a microphone sound port. Do not fabricate from the preview image; fabrication output must come from the completed, checked native board.
