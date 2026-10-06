# Quipus A1 audio footprint review

Prepared 1 October 2026. This is an engineering review package, not a fabrication release. `footprints-audio.json` assigns actual physical lands to all 24 audio circuit entries and confirms that every schematic pin has a corresponding footprint pad. It does not establish a native CAD DRC/ERC pass.

## Onboard microphones U20 and U21

Selected MPN: **IM69D128SV01XTMA1**, Infineon PG-TLGA-5-2. The custom footprint follows [Infineon's IM69D128S datasheet](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf), revision 1.01, 18 January 2023, Figures 12 and 13 on pages 11–12. The package measures 2.65 mm in footprint X by 3.50 mm in Y and 0.98 mm high. The microphone is bottom ported: its sound enters through the PCB, so the PCB and enclosure need matching unobstructed openings.

The footprint is drawn as viewed from the PCB's component side. The manufacturer's package drawing is a bottom view; the X positions are deliberately mirrored when translating that drawing into PCB lands. Coordinates are relative to the package body centre:

| Pad | Signal | X (mm) | Y (mm) | Copper land |
|---|---|---:|---:|---|
| 1 | VDD | -0.838 | 1.364 | 0.75 × 0.54 mm |
| 2 | CLOCK | -0.838 | 0.542 | 0.75 × 0.54 mm |
| 3 | DATA | 0.838 | 1.364 | 0.75 × 0.54 mm |
| 4 | LR | 0.838 | 0.542 | 0.75 × 0.54 mm |
| 5 | GND | annulus centred 0 | -0.710 | 1.725 mm outer / 0.985 mm inner diameter |
| unnumbered | Acoustic opening | 0 | -0.710 | 0.60 mm **nonplated** drilled hole |

The custom GND pad anchor is located on the annulus at X = 0.6775 mm, not at the sound hole. Placing a filled pad anchor in the centre would obstruct the acoustic opening. The annular copper is a stroked custom circle primitive. The mask opening is separately represented with 1.825 mm outer and 0.885 mm inner diameter, and the four signal pads use 0.05 mm mask expansion. Signal stencil apertures are 0.63 × 0.47 mm. Three **filled annular-sector polygons** use the datasheet's 0.54/0.83 mm radii. The top sector is 110°, and the two lower sectors are 100° each. This gives 15°/20°/15° gaps, at least 0.141 mm at the inner radius. The lower-sector spans are an explicit implementation choice; the assembler must approve final segmentation and registration. Filled sectors are intentional: thick stroked arcs have rounded caps that can overlap and close these gaps.

The copper-to-NPTH edge distance is 0.1925 mm. A fabricator must support this spacing. Keep other traces, vias and plane copper away from the acoustic opening on every layer; keep adhesives, conformal coating, cleaning fluids and enclosure ribs out of the sound path. Mount the mics near the top corners and away from the speaker, buck/boost inductor and ESP32 antenna as established in the placement study. Place the 1 µF and 100 nF bypass capacitors close to each VDD land.

**Importer check required:** EasyEDA must preserve the annular custom pad, separate mask annulus, stencil arcs and NPTH. Inspect the imported copper, mask and paste separately before routing/releasing this package. Do not use the IM69D130 footprint; the package and lands differ.

**Native microphone result, 1 October 2026:** the initial custom-circle import lost its copper stroke. The accepted native correction uses four concave polygon quarters sharing pin5, with a copper-contained routing origin in each. Both U20/U21 instances are refreshed and all six new-quarter instance pads are bound to GND. Native rounded polygon-to-NPTH clearance is0.192479567mm; the final board DRC has0 clearance findings,451 unrouted connection errors and1 schematic metadata mismatch. The native editor retains a0.2mil boundary stroke on explicit paste fills; its possible stencil expansion is documented in `native/microphone-footprint-final-notes.md`. Native geometry and net repair are complete; routing and stencil/manufacturing qualification remain incomplete. The accepted native footprint is a separate artifact from the original KiCad source reviewed above.

## Speaker amplifier U22

Selected MPN: **MAX98357AETE+**, T1633+4, 16-pin TQFN. The amplifier datasheet identifies outline 21-0136 and land pattern 90-0031. The custom copper footprint follows the official [Analog Devices/Maxim 90-0031 revision C land pattern](https://mds.analog.com/api/public/content/90-0031.pdf):

- Body 3 × 3 mm; contact pitch 0.50 mm.
- Opposite pad-row centre span 2.85 mm, placing the centres at ±1.425 mm.
- Perimeter copper lands 0.80 × 0.30 mm.
- Exposed GND land 1.23 × 1.23 mm; the schematic/CAD convention assigns it pad **17**.
- Four 0.49 × 0.49 mm stencil windows give approximately 63.5% exposed-pad paste coverage; final stencil coverage needs assembler approval.

Pad numbering follows the [MAX98357A/MAX98357B datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/max98357a-max98357b.pdf), page 15: 1 DIN; 2 GAIN_SLOT; 3 GND; 4 SD_MODE; 5/6 NC; 7/8 VDD; 9 OUTP; 10 OUTN; 11 GND; 12/13 NC; 14 LRCLK; 15 GND; 16 BCLK. Pad 1 is at the uppermost pad of the left row. Connect pad 17 to the solid GND return and add thermal vias during PCB layout, with via treatment agreed with the assembler.

Do not assign the downloaded generic 1.60 mm exposed-pad footprint to this part. The selected custom file matches the manufacturer's 1.23 mm land and 0.30 mm perimeter width, whereas the generic KiCad footprint uses its own IPC-generated lands. Class-D outputs are differential: neither speaker pin is GND. Keep the pair short and balanced; use twisted wires outside the PCB. Place C205/C206 immediately at VDD/GND with a short return and keep the output pair away from the mic input/clock region.

## Connectors and passives

J4 uses the upstream KiCad `JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal` footprint, and J5 uses its 2-pin variant. The source dimensions are the official [JST SH connector drawing](https://www.jst-mfg.com/product/pdf/eng/eSH.pdf). Each physical connector has unnumbered-by-schematic **MP** hold-down lands; these remain mechanically present without an assigned circuit net. Signal contacts preserve physical numbers 1–4 and 1–2 respectively. Verify pin 1 on the assembled cable; Quipus's digital-mic expansion wiring is not a standard USB or analog-microphone pinout.

R201–R211 use KiCad standard 0603/1608 lands. C200–C205 use 0603/1608, C206 uses 0805/2012, and optional DNP C207 uses 1210/3225. These footprints are real metric package lands, but exact passive MPNs still need BOM completion. Capacitor DC-bias derating matters: confirm C206's effective capacitance at the amplifier's approximately 4.4 V supply and preserve its 10 V rating. C207 remains not populated by default.

## Files and checks

All footprint file paths and source links are in `footprints-audio.json`. Custom footprints use KiCad 20221018 syntax. Current upstream KiCad footprints use 20260206 metadata; the PCB import carrier may need safe syntax normalization for EasyEDA's converter. The footprint S-expressions were parsed, the inventory has exactly 24 source references, and all numbered schematic pins exist as physical copper pads. Board clearance, thermal, solder-mask, acoustic and imported geometry checks remain necessary before production.
