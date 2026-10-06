# Quipus Rev B - four-microphone schematic and assembly package

Prepared 2 October 2026. **Engineering review draft. No fabrication release, routed PCB or Gerbers.**

This revision specifies two built-in digital microphones plus two separately wired analog microphone pucks. It preserves the ESP32-S3, USB-C charging/service, protected 1S battery, SD storage, small display and one speaker. It is separate from Rev A; the saved EasyEDA project and existing development-board firmware have not been updated by generating this package.

## Files to use

- `schematics/Quipus-B1.kicad_sch`: editable hierarchical KiCad schematic with embedded review symbols, physical package pin numbers and named global nets. Open the root schematic with all child sheets in the same directory. Matching global labels connect across sheets.
- `legacy-kicad/Quipus-B1.sch`: legacy KiCad conversion source, with its cache library and child sheets. Provided for a CAD engineer to try an import; successful EasyEDA import is not claimed.
- `bill-of-materials.csv`: every main-board designator, value, package, assembly responsibility, selection status and source.
- `shopping-list.csv`: grouped main-board quantities for one unit and two assembled prototypes. DNP rows are excluded from fitted quantities. Factory attrition/spares must be agreed before purchasing.
- `pin-connections.csv` and `connections.json`: complete physical-pin-to-net definitions; these are also the source of the schematic export.
- `assembly-guide.md`: full beginner ordering, soldering and first-board workflow.
- `learning-tools.csv`: workshop tools and off-board items. Its audio accessories overlap `accessories.csv`; do not add their quantities twice.
- `accessories.csv`: only the external microphone puck parts, separate from the main-board BOM.
- `pcb-change-list.md`: electrical, mechanical, firmware and layout changes required to implement Rev B.
- `power-design.md`, `audio-design.md`, `controller-design.md`: assumptions, calculations, exact selected pins and primary references.
- `validation.json`: checks actually performed, plus checks still outstanding.
- `power-budget.json`: battery sensitivity and four-channel storage calculations. These are planning assumptions, not measured runtime.

The PDF explains the architecture, purchase lists, power domains, connectors, microphone puck circuit, assembly stages and all schematic pin/net pages. The review ZIP includes it and the editable sources.

## Main architecture

Two IM69D128S PDM microphones feed U23 TLV320ADC5140. Two biased analog microphone jacks feed its separate analog channels. ESP32 I2S0 supplies BCLK/FSYNC and receives four TDM slots; its I2S1 drives the MAX98357A speaker. Do not mix microphone channels electrically or connect an analog mic to an ESP32 GPIO. The new firmware must preserve four-channel source recordings.

At 16 kHz with four 32-bit TDM slots, BCLK is 2.048 MHz and the raw DMA rate is 256 kB/s. Converting to four aligned PCM16 channels produces 128 kB/s, or 7.68 MB/minute. Long recordings need segmented WAV files and a meeting manifest because classic RIFF/FAT32 files have a roughly 4 GiB limit.

## Assembly choice

For the first board, request factory assembly of the fine-pitch and hidden-pad core, preferably all SMD parts. Learn by soldering the two external microphone pucks, their plugs and cable leads, plus the through-hole display header if the assembly quote deliberately leaves it for you. The current JST connectors and Omron B3U controls are SMD; they are not plug-in breadboard parts. Never substitute a generic package without changing its footprint.

## Open release items

1. Exact protected battery and cell-mounted NTC, approved charging temperature window and harness polarity.
2. Exact SW1 power-button and J3 NTC connector MPN/footprints; exact speaker, cable, plug and case mechanics.
3. Qualification of all passive MPNs, capacitor effective values, PUI capsule physical pad polarity, ESD/filter behavior and loaded PDM clock timing. The candidate mic-input TVS alone clamps above the ADC maximum; transient protection must be closed before release.
4. Native CAD opening/ERC, footprint comparison, routed four-layer PCB, DRC, USB/current/thermal and acoustic review.
5. First-article measurements and Rev B firmware/backend support for four-channel WAV.

The power button switches off the main electronics; charging, the gauge, RTC backup and control circuitry remain powered. It is not complete battery isolation. A 2,000 mAh pack is not a promise of a week at 5-6 recording hours/day.

## Rebuild

Run `build_package.py` with Python plus ReportLab and pypdf. The builder writes only the new `output/pcb/Quipus-B1/` folder, `output/pdf/Quipus-B1-schematic-and-assembly-guide.pdf` and the B1 review ZIP. It does not manufacture a PCB, assign verified production footprints, operate EasyEDA or change the current firmware.
