# Quipus B1 PCB revision

The local PCB and schematic are generated in `output/pcb/Quipus-B1-EasyEDA`. Rev A is retained separately. This is a four-layer **placement revision**, not a routed manufacturing release.

## Implemented board changes

- 65 × 125 × 1.6 mm board, antenna notch and all-layer radio copper keepout.
- 180 electrical references and 113 nets; 39 references added and J4/R205/R206 removed relative to A1.
- TLV320ADC5140 four-channel mixed analog/PDM capture frontend and SN74LVC1G17 clock buffer.
- Two IM69D128S microphones with top/bottom front acoustic openings; four-quarter pad-5 copper keeps the acoustic centre clear.
- Two independently wired SJ1-3533NG side sockets for analog microphone pucks. Socket bodies are recessed 0.3 mm; their bushings project 3.7 mm beyond each PCB side.
- Power/Start/Stop above the 45 × 31 mm display module; Volume−/Volume+ below. BOOT/RESET service controls are on the rear.
- Front 41 × 29 mm speaker reservation, JST speaker/battery/NTC connectors, bottom USB-C and right-facing microSD access.
- SW1 uses the same selected B3U-1000P footprint as the other buttons. J3 uses the exact SM03B-SRSS-TB(LF)(SN) side-entry connector footprint.

## Rebuild and check

Run `build_import.py`, then `validate_import.py` and `render_placement.py` with Python. The retained formatter is imported from `rev-a/easyeda/kicad_format.py`. `pack_placement.py` produces the 180 physical placements and a placement audit. The import carrier uses one flat electrical schematic containing thirteen source panels; the review package retains the thirteen separate schematic sheets.

`import-validation.json` independently checks every schematic pin and corresponding physical pad net, footprint geometry conversion, repeated microphone ground pads, keepouts, source-library collisions and legacy CAD syntax. `placement-packing-audit.json` checks courtyards, through-hole conflicts, mounting heads, screen/speaker reservations, RF exclusions and nominal 0.5 mm copper-edge clearance. These local checks do not replace native CAD ERC/DRC.

## Saved native EasyEDA revision

Project: **Quipus B1 – Four Microphone Hardware Rev B**, private project ID `0960404b6cb74e4c9e220d0e9c82a5cd`. Rev A remains separate.

The final saved project export passes the independent native pad/net, device-to-footprint, placement, geometry and stencil checks: 180 electronic components, 113 nonempty nets and 606 physical pad instances including four standalone 2.8 mm mounting holes. Mounting holes are board geometry, so schematic synchronization cannot remove them as unmatched components. Native import fixes preserve the microphone acoustic openings, its seven explicit paste apertures, and the converter/power exposed-pad stencil shapes.

Native schematic checking reports zero fatal errors, errors or warnings and eight informational entries. Native PCB DRC reports 543 unconnected-pad findings and no other findings. **The remaining connections need copper routing.** The native audit is not a routed DRC pass or approval to fabricate. Native source, check snapshots, hashes and a screenshot are included in the review bundle.

Run `finalize_export.py` after checking the final native export to bundle the CAD files, current BOM, native backup/evidence and placement PDF. Rebuilding the import carrier resets its manifest to pending; rerun validation and verify any reimport before bundling again.

## Remaining engineering work

The PCB has **zero copper tracks and zero standalone vias**. Bypass capacitors and switching-current loops need pin-side routing refinement before routing the board. Complete power/ground distribution, USB differential routing against a chosen fabricator stackup, TDM/PDM traces and analog inputs, then rerun native ERC/DRC and inspect actual manufacturing outputs.

Before manufacturing, verify the jack plated-slot fit with a sample, the selected ferrite's exact approval drawing, battery/NTC and charging thermal behaviour, microphone stencil/acoustic holes, and connector/case heights. The proposed socket TVS alone does not qualify the ADC inputs against transients; its protection network requires electrical refinement and testing. Loaded PDM edge/data timing also requires oscilloscope qualification.

This board does not implement USB microphone host support. Four-channel capture also needs corresponding firmware work. A PCB placement or good-looking preview does not prove working audio or battery endurance.
