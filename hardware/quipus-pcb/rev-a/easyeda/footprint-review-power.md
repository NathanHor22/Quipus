# Quipus A1 power footprint review

Prepared 1 October 2026. This is an engineering import draft, not a fabrication release. `footprints-power.json` assigns all 66 power-circuit references to 19 physical land patterns and includes every pad number, net mapping, geometry and source checksum. The original one-off preparation script is `.tools/quipus-footprints/power/build_power_footprints.py`; the current manifest is authoritative and includes the later shared DRT footprint correction.

## Exact patterns and corrections

| References | Selected pattern and source | Review result |
|---|---|---|
| J1 | GCT USB4105-GF-A, official KiCad geometry based on [GCT drawing](https://gct.co/files/drawings/usb4105.pdf) | Twelve physical solder tails. Official KiCad duplicate coincident A/B power and ground pads were consolidated into `A1_B12`, `A4_B9`, `B4_A9`, `B1_A12`. Four physical shell stakes were individually renamed SH1-SH4. Dimensions, locating holes and plated slots were preserved. |
| U2 | [BQ24074 datasheet](https://www.ti.com/lit/ds/symlink/bq24074.pdf), RGT0016C drawing 4222419/E, page 53 | Custom manufacturer copper geometry: 16 lands 0.60 x 0.24 mm, pitch 0.50 mm, opposing land centers 2.80 mm, exposed pad 17 = 1.68 x 1.68 mm. Paste split into four engineering 0.71 mm square windows; confirm stencil and thermal via plan with assembler. |
| U3 | [TUSB320LAI datasheet](https://www.ti.com/lit/ds/symlink/tusb320lai.pdf), RWB0012A drawing 4221631/B, page 36 | Exact manufacturer copper lands, twelve pins. Four side lands 0.70 x 0.20 mm, eight top/bottom lands 0.20 x 0.50 mm. No exposed pad. |
| U4-U8 | KiCad SOT-23-5 | DBV five-pin package, direct numerical pin mapping. |
| U9 | KiCad TSOT-23-8 | ADI TS8 eight-pin package, 0.65 mm pitch, direct numerical pin mapping. |
| U10 | KiCad SOT-23-6 | DBV six-pin package, direct numerical pin mapping. |
| U11 | [TPS63802 datasheet](https://www.ti.com/lit/ds/symlink/tps63802.pdf), DLA0010A drawing 4223750/D, pages 36-37 | Custom asymmetric ten-land HotRod geometry. Five left lands 0.60 x 0.25 mm; four right lands 0.90 x 0.25 mm; GND pin 8 = 1.30 x 0.25 mm. Body is **2 x 3 mm**, as the mechanical drawing specifies. The older 1.4 x 2.3 mm descriptive prose must not determine PCB geometry. |
| U12 | [BQ27441 datasheet](https://www.ti.com/lit/ds/symlink/bq27441-g1.pdf), DRZ0012A drawing 4218895/B, pages 26-27 | Custom twelve 0.60 x 0.20 mm lands, 0.40 mm pitch, opposing center span 3.80 mm. EP13 is H-shaped: 2.45 x 1.95 mm center plus two 0.20 x 2.90 mm bars. Three coincident pad-13 copper pieces produce the connected H shape. Separate paste windows follow the manufacturer stencil example. |
| U13 | Official KiCad [Texas_DRT-3](https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Package_TO_SOT_SMD.pretty/Texas_DRT-3.kicad_mod), [TI DRT package drawing MPDS340](https://www.ti.com/lit/pdf/MPDS340) | Unified with the identical U35 controller device. Pad 1 = (-0.35,+0.425), 2 = (+0.35,+0.425), 3 = (0,-0.425) mm; each copper land is 0.30 x 0.30 mm. This official-library geometry supersedes the earlier engineering-derived power-only candidate. Confirm purchased package revision and assembler stencil rules before manufacture. |
| D1 | [TPD1E10B06 datasheet](https://www.ti.com/lit/ds/symlink/tpd1e10b06.pdf), DYA0002A drawing 4224978/B, page 17 | Exact two 0.67 x 0.40 mm lands, center span 1.48 mm. This is the DYA/SOD-523 orderable part, not the smaller DPY option. |
| L1 | [Coilcraft XFL4015 datasheet](https://www.coilcraft.com/getmedia/84927b8b-f089-421b-a7f4-a0fa23afe908/xfl4015.pdf), document 769-2, page 2 | Two 0.98 x 2.37 mm recommended lands, overall span 3.40 mm, centers +/-1.21 mm. 4.0 +/-0.3 mm body; 1.60 mm maximum height. Full reel code XFL4015-471MEC should replace abbreviated family code before purchase. |
| J2 | KiCad JST_PH_S2B-PH-SM4-TB_1x02-1MP_P2.00mm_Horizontal, [JST PH](https://www.jst-mfg.com/product/pdf/eng/ePH.pdf) | Exact selected side-entry PH2 body. Two electrical pins plus unconnected mechanical MP pads. Pack positive is pad 1, negative is pad 2. **Independently check the actual battery cable polarity.** |
| J3 | KiCad JST_SH_SM03B-SRSS-TB_1x03-1MP_P1.00mm_Horizontal, [JST SH](https://www.jst-mfg.com/product/pdf/eng/eSH.pdf) | Proposed exact SM03B-SRSS-TB(LF)(SN), side-entry keyed three-pin connector: NTC, GND, NC. Two unconnected mechanical MP pads. The three-pin housing cannot mate to the two-pin speaker plug. |
| SW1 | KiCad SW_SPST_B3U-1000P | Proposed exact Omron B3U-1000P, momentary normally-open input to LTC2951. Carries logic current, not battery or speaker current. Case actuator design remains separate. |
| F1 | KiCad Fuse_0603_1608Metric | Standard 0603 lands for Littelfuse 0467002.NRHF. Confirm assembler paste aperture/current derating. |
| R1-R18, R20-R26 | KiCad R_0603_1608Metric | Standard 0603 resistor lands; select actual tolerance and resistance in BOM. |
| R19 | KiCad R_0805_2012Metric | Proposed two-terminal 0805 shunt, 10 mOhm, 1%, low TCR, 0.25 W minimum. Exact shunt MPN remains open. Route gauge SRP/SRN as independent Kelvin traces from inner pad edges, separate from pack/charger current copper. |
| Capacitors | KiCad C_0603_1608Metric / C_0805_2012Metric | Package selection follows the circuit JSON. Preserve stated voltage/X7R requirements and check effective capacitance at DC bias for 10/22 uF converter capacitors. |

Official KiCad footprint geometry was retrieved from `https://github.com/KiCad/kicad-footprints` and stored locally. The custom patterns preserve explicit per-device manufacturer copper geometry rather than substituting visually similar generic QFN packages.

## Layout requirements

- Keep J1 at the bottom edge with its native PCB-edge guide at local y = +3.675 mm. Include the two 0.65 mm nonplated locating holes and four plated oval shell slots in drill export. USB contact row is local y = -3.68 mm; rotating the footprint must rotate these features together.
- Place CC protection U13 close to J1 with a short direct ground via; protect both CC lines and keep their routing separate from USB data.
- Place charger input/output capacitors against their corresponding power pins. EP17 must connect to ground copper/thermal vias. The thermal calculation and charging temperature window remain release checks.
- Put R19 between the protected pack J2 and charger/gauge system battery node. SRP/SRN sense routing must not share a high-current via or long charger trace.
- Cluster U11, L1, C16-C18 tightly. Keep switching nodes short; route FB away from inductor/switch copper. Use the exact ground/signal arrangement in TI's layout guidance. No generic exposed pad may be invented for this ten-pin HotRod device.
- Current components require wide pours according to copper thickness and temperature rise, not nominal schematic wire size. MAIN_RAW peak and voltage drop need board-level verification; this footprint report does not constitute that check.
- JST mechanical MP tabs have no electrical net by default. Do not accidentally tie an MP tab to a signal due to numbered-pad import conversion.
- Board trace/clearance/solder-mask/stencil checks and native ERC/DRC remain outstanding after import. Land-pattern lookup and pad-number checks do not substitute for those checks.

## Remaining release blockers

1. Select the exact protected LiPo pack, polarity, physical dimensions and charge-temperature limits; resolve BQ24074/NTC hardware temperature thresholds against that pack. Do not bypass the NTC input.
2. Confirm all imported package revisions, copper lands and stencil with the assembler or TI's approved CAD model, including the shared DRT footprint used by both U13 and U35.
3. Select the exact 0805 shunt part and confirm its land pattern, rating and Kelvin routing.
4. Validate PCB-level routing, thermal vias and stencil with native CAD checks before fabricating. No claim of a manufactured, assembled or electrically tested board is made.

## Independent 65 x 105 mm placement and power audit

The following checks refer to the parent design's revised placement, not the older STEP envelope study. The older study remains illustrative until regenerated. Coordinates use PCB top-left (0,0), x right, y down; they must be transformed correctly when placing a bottom-side footprint.

### Revised antenna and microphone arrangement

ESP32 footprint origin is (32.5,13) mm. Body spans x23.5..41.5 and y0.25..25.75. Its actual antenna region ends at y6.25. The manufacturer-based footprint keepout spans x8.5..56.5 and y-14.75..6.25, across every copper layer. The current upstream footprint already encodes an all-layer keepout, so import must preserve that restriction rather than downgrading it to F.Cu only.

The selected board has a **top-edge antenna notch x22.5..42.5, y0..6.7 mm**. This places the antenna over air and retains the 65 x 105 mm overall PCB envelope. First left/right solder-pad center y = 13 - 5.26 = 7.74 mm; for the actual 0.90 mm pad height, the near copper edge is y7.29, giving **0.59 mm clearance to notch bottom y6.7**. A conservative 0.55 mm half-height still leaves 0.49 mm. Do not extend the notch below y6.7 without recalculating that clearance. Specify the factory's internal corner radius and confirm the final routed profile still removes FR4 below the antenna.

Updated rear microphone centers are (5.75,10.2) and (59.25,10.2) mm, not the older (8,7)/(57,7) positions. With 2.65 mm horizontal and 3.50 mm vertical body orientation, body x envelopes are 4.425..7.075 and 57.925..60.575. These clear the RF keepout's lateral limits by 1.425 mm each. Even if rotated to the wider 3.50 mm horizontal dimension, nearest body edges 7.50/57.50 clear by 1.0 mm. Their two 0.60 mm sound holes remain well inside the PCB edges. Keep mic clock/data traces below the antenna keepout, and prevent copper/connector metal from intruding into it. Case metal, battery pouch and speaker magnet require the corresponding RF clearance in three dimensions.

This follows [Espressif module positioning guidance](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/pcb-layout-design.html#general-principles-of-pcb-layout-for-modules-positioning-a-module-on-a-base-board): place the antenna beyond baseboard material or cut the baseboard around it, preserve clearance and perform RF range/throughput tests in the final case.

### Connector, display and fastening constraints

- Front display envelope is x10..55, y34.5..65.5. Rear parts underneath may fit electrically, but front display-harness and mounting heights are not captured by a 2D overlap check. J7 is a real 6 mm-high PH8 connector; a generic 2 mm display envelope does not establish case clearance.
- MicroSD must face the right edge with the full Hirose socket/card-ejection geometry transformed together. The envelope study's 16 x 15 mm placeholder is superseded by its actual 13.85 x 15.95 mm footprint. Reserve finger access and push-push travel in the case.
- Mic expansion at right-edge y26 is separated from the mounting hole (60,19) by 7 mm in the study. Its full 4-pin SH courtyard and outward wire-bend space must pass final placed-footprint checks; connector origins are not necessarily body centers.
- J1 USB-C's actual footprint PCB-edge guide is local y +3.675. For an exact bottom board edge at y 105 and unrotated geometry, origin y 101.325 aligns the guide. A center y 102 overhangs that guide by 0.675 mm. Select one intentional mounting relationship and carry it into the case opening.
- J2 at the old study's (12,96) position has its nearest left mechanical tab copper at x7.90. A bottom-left fastener at (5,99) with a 2.5 mm head radius reaches x7.50, leaving only 0.40 mm horizontal clearance. Its courtyard overlaps a 3 mm fastener keepout by 0.60 mm. Move J2 at least 2 mm inward, or prove actual screw/post envelopes before freezing this placement. Connector wire bends and battery clearance remain unresolved.
- The four 2.8 mm mounting holes at (5,19),(60,19),(5,99),(60,99) require case-post/head keepouts wider than drill holes. New mic positions are well separated vertically from the top screws; do not use drill-only clearance as the case fit criterion.
- POWER B3U switch carries only the latch-control signal. A left-edge actuator must use mechanical travel/retention suitable for that switch; its small solder pads are not structural mounting points.

### Power and routing priorities

1. Treat charger, power switch, converter and gauge as four compact clusters below the RF/audio area; do not scatter their decoupling into a visually regular component grid. Keep power copper away from mic openings and sensitive PDM clocks/data.
2. Route protected pack J2 pin1 to R19 upstream pad, then R19 downstream node to charger BAT/RTC backup. Bring SRP/SRN as separate sense traces from the respective shunt terminal's inner edge. Do not take either sense from a shared power via or connector fanout. Keep gauge current filter/bypass against its pins.
3. Give charger EP17 continuous ground copper and a manufacturer-reviewed thermal-via plan. At 5 V USB, 3 V battery and nominal 0.445 A charging, the charge path alone dissipates approximately(5-3)*0.445 = **0.89 W**. If total USB input is capped at 1.4 A, an illustrative simultaneous 0.955 A system load adds (5-4.4)*0.955 = 0.573 W, making **1.463 W** total. TI's 44.5 C/W JEDEC thermal metric implies roughly 65 C temperature rise in that reference condition; this is a warning bound, not the custom PCB's measured thermal resistance. Charge current may thermally reduce, and charger die protection does not replace cell-temperature sensing. Battery NTC limits remain a release blocker.
4. Place U11/L1/C16/C17/C18 as TI's compact power loop, with input/output capacitors directly tied to their associated pins and short wide switch-node copper. Use a common low-impedance ground structure while returning FB/AGND to the quiet node. The DLA GND pin8 is an asymmetric land, not an added center thermal pad.
5. Route MAIN_RAW and high-current battery/VBUS connections with short wide copper pours and avoid long fine escape traces. As a reference, 1 mm-wide, 35 um-thick copper has about 0.49 mOhm/mm at room temperature; 10 mm carrying 1.45 A loses roughly7 mV. A 0.2 mm-wide, 50 mm-long route would lose roughly178 mV at the same current. These arithmetic estimates illustrate voltage-drop sensitivity; choose widths/vias using the actual stack-up, temperature rise and routing lengths.
6. Keep U10 switch decoupling and converter input near the load-switch output. The system budget's 1.45 A peak is close to the chosen under 1.5 A design target; charging, speaker playback and Wi-Fi simultaneous peaks need real transient testing. Do not equate the switch's headline 2 A capability with qualified board thermal performance.
7. Route USB D+/D- through U35 and U34 with a continuous ground reference and controlled 90 ohm differential impedance for the actual four-layer stack-up. Avoid return-plane breaks and long ESD stubs. U13 is CC protection; it is not a replacement for the USB-data ESD device.
8. Put CC controller/current-limit logic near the charger, keep always-on and switched 3.3 V domains visibly distinct, and retain pulled-down USB enumeration/suspend control states through power-off. No alternate pad mapping should bridge 3V3_AON to3V3_SYS during import.

These are placement constraints and routing recommendations. No copper routing, native CAD DRC, thermal simulation or assembled-board measurement was performed in this audit.
