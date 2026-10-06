# Quipus A1 independent footprint crosscheck

Reviewed 1 October 2026 against the three source circuit JSON files, three footprint manifests, actual footprint S-expressions and selected primary manufacturer pin tables. The structural check passes: **144 circuit references, 144 assigned references, 92 canonical nets, with every schematic pin represented by an actual copper pad**. No electrical pin-function mismatch was found in the independently checked U11, U13, U35, U34, U20, U21 and U22 mappings. This result does not establish native ERC, DRC, assembly suitability or fabrication readiness.

Run `python hardware/quipus-pcb/rev-a/easyeda/validate_footprints.py` to repeat the reference, physical copper-pad, checksum and selected pin-map checks. The script reads files without editing the circuit or footprint source.

## Concrete findings

1. **The same TPD2EUSB30DRTR part initially has two different physical lands.** U13's power manifest uses an engineering-derived 0.30 × 0.40 mm pattern at Y = ±0.450 mm. U35's controller manifest uses the source-reviewed TI DRT pattern with 0.30 × 0.30 mm lands at Y = ±0.425 mm. Both have physical pad 1 at X = −0.350 mm, pad 2 at X = +0.350 mm and pad 3 at X = 0. Their electrical pin functions are correct: ports 1/2 and GND 3, according to [TI's TPDxEUSB30 datasheet](https://www.ti.com/lit/ds/symlink/tpd2eusb30.pdf), Table 5-1. Use the controller's verified `Texas_DRT-3` land for **both** instances; separate USB-data and CC roles do not require different package lands. This also removes the unnecessary unresolved-land-pattern status on U13.

2. **U11's source package prose is stale, although its selected physical footprint is correct.** `power-circuit.json` describes the TPS63802DLA package as 1.4 × 2.3 mm. The same older wording appears in the datasheet's description, but the device table and mechanical drawing specify a **3.0 × 2.0 mm** ten-pin VSON-HR DLA package. The custom footprint uses X = 2.0 mm and Y = 3.0 mm with the asymmetric manufacturer lands. The [TPS63802 datasheet](https://www.ti.com/lit/ds/symlink/tps63802.pdf), Table 7-1, confirms pins 1 EN, 2 MODE, 3 AGND, 4 FB, 5 PG, 6 VOUT, 7 L2, 8 GND, 9 L1 and 10 VIN. The circuit and selected pad numbering match. Correct the written body dimensions in future PDFs/BOMs rather than resizing the footprint to the obsolete prose.

3. **U35's source package dimensions need a document correction.** `controller-circuit.json` says 1.0 × 0.6 mm. The supplied footprint and TI DRT package drawing have a **1.0 × 0.8 mm** body, with 0.50 mm maximum height. This is a package description error, not a current net/pad mapping error.

4. **The ESP32 footprint's drilled features are plated GND vias, not nine NPTH holes.** `footprint-review-controller.md` originally says to preserve nine unnumbered NPTH holes. The actual supplied `ESP32-S3-WROOM-1.kicad_mod` contains **twelve plated through-hole instances of pad 41**, each with 0.20 mm drill, plus one central SMD pad 41. No `np_thru_hole` feature occurs in that footprint. Preserve them as plated, grounded pad-41 vias. The [Espressif module datasheet](https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf), Table 3-1, assigns pad 41 to GND. The source circuit also correctly leaves N16R8's GPIO35–37 disconnected and maps native USB D−/D+ to module pads 13/14.

5. **The microphone paste-overlap issue is corrected in the audio generator.** The initial mic stencil used thick stroked arcs, whose rounded caps could overlap across a small angular gap. The current custom mic file uses explicit **filled annular-sector polygons** with inner/outer radii 0.54/0.83 mm, top sector 110°, lower sectors 100° each, and minimum 15° gap. The gap is at least 0.141 mm at the inner radius. The copper annulus remains 1.725/0.985 mm outer/inner diameter and the acoustic NPTH remains 0.60 mm. The pad-5 anchor is on the annulus at (0.6775, −0.710) mm, so it does not fill the central opening. Check that EasyEDA retains the custom pad, mask ring, paste polygons and NPTH after conversion. The lower-sector angular spans are an explicit stencil implementation choice requiring assembler approval; the [Infineon datasheet](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf), Figures 12–13, remains the geometric source.

6. **The amplifier's selected custom lands match the actual manufacturer recommendation.** U22 uses exposed pad 17 sized 1.23 × 1.23 mm and perimeter contacts 0.80 × 0.30 mm at 0.50 mm pitch, with opposite-row centres 2.85 mm apart, matching [Analog Devices/Maxim drawing 90-0031 revision C](https://mds.analog.com/api/public/content/90-0031.pdf). The generic downloaded 1.60 mm exposed-pad footprint is intentionally **unassigned**. Do not include it as U22's package merely because it has sixteen contacts and a 3 mm body. The [MAX98357A datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/max98357a-max98357b.pdf), page 15, confirms the circuit's I2S, gain, shutdown, supply and differential output pins; NC pins 5/6/12/13 remain unconnected.

## Net aliases and routing consequences

The combined CAD carrier must apply these aliases consistently to schematic labels, pad nets, routing and power planes:

| Source label | Canonical PCB label | Intended domain |
|---|---|---|
| `3V3`, `3V3_MAIN` | `3V3_SYS` | Regulated, switched 3.3 V for ESP32, SD, display, mic link and I2C pull-ups |
| `SYS_SW` | `MAIN_RAW` | Main load-switch output feeding both buck/boost input and amplifier |

`3V3_AON`, `SYS_RAW`, `BAT_PACK_P`, `BAT_P`, `GAUGE_1V8` and `MIC_3V3` must remain **separate** nets. In particular, merging `BAT_PACK_P` with `BAT_P` would bypass the current shunt; merging `SYS_RAW` with `MAIN_RAW` would bypass the main power cut; and merging `MIC_3V3` directly with the main rail in the CAD exporter would defeat measurement link R204. The two microphone DATA output nets must stay separate until R201/R202 join them to `PDM_DIN0`; their LR settings are opposite as required for shared PDM slots.

The validator found no unexplained one-contact net after applying the aliases. Its output is a structural/pin audit, not proof that trace widths, clearances, thermal paths, radio keepout or analogue noise performance have been resolved.

