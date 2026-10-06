# Quipus A1 compact power placement proposal

Prepared 1 October 2026. Coordinates are in the separate `power-placement-proposal.json`; canonical `placement.json` is owned by the parent task. This changes positions/orientations only. Parts, physical pin maps, nets, values, buttons and mounting holes are unchanged.

## Physical and electrical grouping

- USB/charger: keep J1 on its established bottom mating line. U2 sits at (49.5,96) on the front, below/right of DOWN. C1 connects immediately toward IN13; C2 faces BAT2/3; C3 faces OUT10/11. F1/D1 stay below the button courtyard. U13 at (28.3,95.2) protects CC close to USB entry. U35 and native-USB isolation remain as already selected.
- Always-on control: U3 stays close to the connector at (24,96) front. U4 and its two bypasses are rear at y94. Four gates U5–U8 form a compact rear block at x14/23, y82.5/88. Bypasses face each gate's VCC; R10 faces U7 output. This removes the original mid-board charge-current logic separation. The GPIO-controlled enumeration and suspend tracks can be longer; the default pull states and distinct 3V3_AON/3V3 domains must remain intact.
- Main power: U10 at (30.5,85) rear feeds U11 at (39,85) rear. Its input bypass faces VIN, CT capacitor faces the slew pin, and QOD resistor remains nearby. U11/L1/C16/C17 form a compact same-face group. The inductor is turned so its two terminals face L1/L2 pins. C16 is rotated 90 degrees and C17 270 degrees to put their live pads toward VIN10 and VOUT6. R16/R17 stay left of the converter, clear of inductor/switch copper. C18 is the nearby parallel bulk capacitor.
- Battery measurement: J2 and J3 face the left edge at x7. Gauge U12 and shunt R19 sit directly beside the battery entry. Sense connections must branch separately from the shunt's two actual terminals. J2 cable/mate and case access changed and need a three-dimensional fit check. The selected protected pack, NTC, polarity and charge temperature window remain unresolved.
- Power button: U9 and SW1 stay in place; its bypass and two timing capacitors are moved to their corresponding pins. No timing or shutdown electrical behavior changes.

The only controller-support changes in this proposal are R332=(21,91.3) and C333=(27,91.3), both rear. Their new row clears U8 and C10 without moving a button or the U31 buffer.

## Pin-to-pad placement measurements

These are straight-line distances between named copper-pad centers, not claimed routed trace lengths. They use exact source pad geometry and the importer’s defined rear reflection/rotation.

| Connection | Distance |
|---|---:|
| U11 VIN10 → C16 live pad | 1.87 mm |
| U11 VOUT6 → C17 live pad | 1.87 mm |
| U11 FB4 → R16 feedback pad | 1.43 mm |
| U10 VIN1 → C14 live pad | 1.89 mm |
| U4 IN1/OUT5 → C5/C6 live pads | 1.79 mm each |
| U7 VCC5 → C9 live pad | 1.79 mm |
| U2 IN13 → C1 live pad | 2.37 mm |
| U2 BAT2 → C2 live pad | 1.81 mm |
| U2 OUT10 → C3 live pad | 2.36 mm |
| U12 SRN7 → R19 downstream pad | 1.80 mm |
| U12 SRP8 → R19 upstream pad | 2.35 mm |
| J2 positive → R19 upstream pad | 4.24 mm |

## Independent dry run and remaining work

The final proposal was instantiated in memory from actual source footprint files for all 144 references. With lower mic U21=(59.25,93) rear and a mock bypass placement C202=(62.5,94.5), the check found zero same-face courtyard overlaps, zero plated-through-hole conflicts across faces, zero mounting-head conflicts, zero front components in the display envelope, and zero moved copper pads outside the board. Audio-agent placements supersede the mock mic supports. No canonical PCB, placement source or generated manufacturing output was changed by this review.

This dry run is not native routing DRC or fabrication clearance qualification. Parent must rebuild and check the final combined coordinates, including actual lower microphone supports. The USB mating guide, SD direction, four-layer RF zones and notch are retained, but enclosure/cable fit, display standoff, SD ejection access and microphone apertures still need mechanical confirmation.

Before routing release: use short/wide same-face switch-node and power connections; immediate local ground vias at bypasses and ESD; uninterrupted ground reference; quiet FB/AGND return separated from switch-node paths; true Kelvin shunt sensing; charger exposed-pad ground/thermal vias. Do not route noisy converter traces or planes under the mic data/clock paths. Verify charger dissipation and cell temperature in the enclosure and scope SYS_SW/3V3 during Wi-Fi, SD writes and speaker bursts. Battery/NTC qualification, thermal/inrush/USB entitlement behavior and hardware tests remain required.

## Layout references

- [TI TPS63802 datasheet and layout guidance](https://www.ti.com/lit/ds/symlink/tps63802.pdf)
- [TI BQ24074 datasheet and layout guidance](https://www.ti.com/lit/ds/symlink/bq24074.pdf)
- [TI BQ27441 datasheet: shunt/sense and layout](https://www.ti.com/lit/ds/symlink/bq27441-g1.pdf)
- [TI TPS22918 datasheet](https://www.ti.com/lit/ds/symlink/tps22918.pdf)
- [TI TUSB320LAI datasheet](https://www.ti.com/lit/ds/symlink/tusb320lai.pdf)
