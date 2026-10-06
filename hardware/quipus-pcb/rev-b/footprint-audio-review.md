# Quipus Rev B audio PCB footprints

Prepared 2 October 2026. These are physical CAD footprints for an engineering review board. They are not an approved fabrication package. No cloud PCB, routed tracks or production order is changed by this generator.

`pcb-audio-footprints.py` exposes `build_audio_footprints()`, which returns a reference-to-assignment dictionary compatible with the Rev A PCB import builder. It writes four new footprints and a 60-reference assignment manifest into `audio-footprints/`. Every schematic pin, including intentionally unconnected chip pins, has a corresponding physical copper pad. Old J4/R205/R206 are absent. The retained two MEMS mics, speaker amplifier and speaker connector keep their reviewed physical lands.

## U23: TLV320ADC5140IRTWR, RTW24

File: `audio-footprints/Quipus_TI_RTW0024A_TLV320ADC5140.kicad_mod`.

Source: [TI TLV320ADC5140 datasheet](https://www.ti.com/lit/ds/symlink/tlv320adc5140.pdf), package drawings at PDF pages 123–125; RTW outline 4206244/C, thermal-pad drawing 4206249-5/P and example land/stencil drawing 4211120-3/D. The name is the project's CAD identifier; these drawing numbers are the geometry authority.

- Body: 4.00 × 4.00 mm nominal, 0.80 mm maximum height, perimeter pitch 0.50 mm.
- Perimeter copper: 0.85 mm long × 0.28 mm wide, flat outer end and semicircular inner end with R0.14. Opposing row centres are at ±1.975 mm, giving 4.80 mm overall copper span and 3.10 mm inner land-to-land gap. **3.10 mm is not the exposed-pad dimension.**
- Exposed copper pad: **2.70 × 2.70 mm**, electrical pad **25**, bound to GND. TI identifies it as thermal VSS rather than a numbered signal; 25 is the schematic/CAD convention used consistently by this project.
- Component-side pad numbering: 1–6 run down the left row; 7–12 along the bottom; 13–18 up the right; 19–24 across the top from right to left. Pin 1 is the upper-left contact. This agrees with the datasheet's top-view pin-function diagram.
- Perimeter paste: 0.80 × 0.23 mm, R0.115 inner end. Four 1.10 × 1.10 mm thermal paste windows have 0.30 mm webs; coverage is 4.84/7.29 = 66.4%, matching TI's example. A 0.125 mm stencil is the manufacturer's example, subject to assembler approval.
- Copper/mask expansion: 0.07 mm, matching the example mask detail. Courtyard clearance is a project layout choice, not a package dimension.

The asymmetric semicircular-end shape is a filled custom polygon. Its 32-segment half-circle approximation has less than 0.00017 mm chord error. The pad anchor stays inside copper. Inspect actual imported copper, mask, paste and EP25 net binding in native CAD; do not replace this with a generic QFN thermal land. Thermal vias, fill/tent treatment and stencil registration are layout/assembly decisions still to close. No via-in-pad process is silently assumed.

## U24: SN74LVC1G17DBVR

File: `audio-footprints/Quipus_TI_DBV0005A_SN74LVC1G17.kicad_mod`.

Source: [TI SN74LVC1G17 datasheet](https://www.ti.com/lit/gpn/sn74lvc1g17), DBV0005A 4214839/K outline, board land and stencil pages 23–25 in the retrieved revision. The existing generic SOT-23-5 uses different IPC lands, so it was not represented as an exact manufacturer match.

The selected manufacturer land pattern uses 1.10 × 0.60 mm copper/paste, R0.05 corners, opposing row centres ±1.30 mm and 0.95 mm contact pitch. Pad centres are 1 = (−1.3,−0.95), 2 = (−1.3,0), 3 = (−1.3,+0.95), 4 = (+1.3,+0.95), 5 = (+1.3,−0.95). Pad functions are 1 NC, 2 A, 3 GND, 4 Y, 5 VCC. A 0.05 mm mask expansion is within TI's 0.07 mm maximum preferred NSMD example. Courtyard ±2.10 mm in X/±1.80 mm in Y is a layout choice.

This closes physical geometry, not the loaded PDM timing requirement. Scope-test rise/fall time, duty cycle and setup margin with both microphones, series resistor and PCB capacitance before approving the intended clock frequency.

## J8/J9: Same Sky SJ1-3533NG

File: `audio-footprints/Quipus_SameSky_SJ1-3533NG.kicad_mod`.

Primary geometry authority: [Same Sky SJ1-353XNG drawing](https://www.sameskydevices.com/product/resource/sj1-353xng.pdf), dated 10 March 2025, page 2. Cross-check: [official KiCad SJ1-3533NG footprint](https://raw.githubusercontent.com/KiCad/kicad-footprints/master/Connector_Audio.pretty/Jack_3.5mm_CUI_SJ1-3533NG_Horizontal.kicad_mod), derived from the earlier manufacturer drawing. The current manufacturer's CAD download is gated by a CAPTCHA; no bypass or unofficial guessed geometry was used.

The body is **14 mm along plug insertion × 8.2 mm across the board edge × 12.5 mm above PCB**. Its bushing extends 4 mm beyond the body. The jack's axis is 7.0 ±0.15 mm above the board. This is a tall connector; do not exchange width and height based on a generic right-angle jack photo.

In this footprint the plug approaches local **−Y**. Origin is the sleeve contact:

| Physical pad | Contact | X mm | Y mm | Copper / plated slot |
|---|---|---:|---:|---|
| 1 | Sleeve, GND | 0 | 0 | 2.8 × 1.8 mm oval / 2.0 × 1.0 mm oval slot |
| 2 | Tip, microphone audio plus bias | 2 | 2.4 | Same |
| 3 | Ring, intentionally NC | 2 | 7.9 | Same |

This numeric pin map replaces KiCad's S/T/R labels and matches the circuit's 1/2/3 physical numbering. There are no switch contacts 4/5 on this model. Body envelope is X −4..4.2, Y −1.2..12.8; bushing X −2.1..3.9, Y −5.2..−1.2. The bushing centre at local (0.9,−5.2) helps position its mouth at the enclosure wall. Rotating/flipping the footprint must transform this envelope and the contacts together.

**Hold:** the 2025 drawing confirms position/contact mapping but omits the explicit slot-size callout found in the earlier manufacturer-derived KiCad implementation. The 2 × 1 mm slots and 2.8 × 1.8 mm copper are retained from that implementation rather than invented. Confirm actual supplied terminals fit, plated-slot manufacturing capability and drawing revision before fabrication. A 3D/case sample must confirm bushing alignment, insertion clearance and connector height. Current case/PCB-edge cutouts are not finalized by defining this footprint.

## FB220: Murata BLM21PG221SN1D

File: `audio-footprints/Quipus_Murata_BLM21PG221SN1D.kicad_mod`.

Source: [Murata official BLM21 reference specification](https://pim.murata.com/asset/pim4/ferriteBeadInductortypefilter/QNFA9131_PDF_FERRITEBEADINDUCTORTYPEFILTER?lastModifiedDatetime=20250707191344), retrieved as JENF243A_9131H-01, section 11.1 on page 8. Its BLM21PG reflow family dimensions are inner gap a = 1.20 mm, outer span b = 2.40 mm and width c = 1.25 mm. Consequently each copper land is 0.60 × 1.25 mm at X = ±0.90 mm. Pads 1/2 are interchangeable on this nonpolar bead. The family specifies pattern width d = 1.25 mm for up-to-2 A variants; actual low-current audio power routing remains reviewed for impedance and thermal behavior.

This document is a manufacturer **family reference**, not the selected SN1 part's signed approval sheet. Obtain/check the specific part approval before release. Body is 2.00 × 1.25 × 0.85 mm nominal per the selected part product data. Mask expansion and courtyard are explicit project choices.

## Retained parts and 0805 passives

U20/U21 retain the Infineon IM69D128SV01 5-pad annular-ground footprint with 0.60 mm acoustic NPTH. The existing native cloud quarter-pad annulus/net correction must be preserved; the local source carrier still contains the reviewed custom-circle annulus and requires fresh import inspection. Do not allow copper or case material to cover the inlet. The sound passes through the PCB, so front-facing acoustic routing must be planned with the actual mounting face.

U22 retains manufacturer-derived MAX98357A 3 × 3 mm TQFN with EP17 = 1.23 × 1.23 mm; J5 retains the two-contact JST SH footprint and its mechanical MP lands. D220/D221 reuse the previously reviewed TI DYA0002A TPD1E10B06 footprint. The new input TVS's geometry does not resolve its excessive stand-alone clamp voltage; system transient protection remains a release hold.

All ordinary audio resistors now use retained KiCad `R_0805_2012Metric` and ordinary audio capacitors use `C_0805_2012Metric`; optional DNP C207 keeps `C_1210_3225Metric`. Their physical 1/2 pad mapping is unchanged. These are generic IPC lands. Exact passive MPNs, tolerances, body size, voltage rating and effective capacitance still require BOM qualification; a generic 0805 footprint is not evidence that any 0805 capacitor meets the electrical requirement.

## Validation boundary

The generator ran successfully with all 60 audio references covered. New and retained footprint S-expressions parse, each schematic physical pin has a numbered copper land, and files have hashes in `audio-footprints/assignments.json`. The parent PCB builder must connect all matching net names and preserve mechanical/unconnected pads. Native CAD opening/ERC/DRC, imported custom geometry, mechanical fit, routing, power/audio tests and manufacturing approval are not established by these checks. Do not send this footprint-only package for production.
