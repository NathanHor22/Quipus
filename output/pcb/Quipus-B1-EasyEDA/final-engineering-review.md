# Quipus B1 — final local engineering review

Review date: 2 October 2026. Scope: the current Rev B circuit definitions, physical assignments, saved placements and `output/pcb/Quipus-B1-EasyEDA` carrier. **Updated schematic/placement draft; not approved for manufacture.** No browser or live native CAD was accessed during this independent review, and no placement or generator was changed.

## Verified from the current files

- PCB SHA-256: `d19ff1b295be70aafc89c9cb795fcefa9964c902f8e7c659dd3cc42945544315`. It matches the current `import-validation.json` PASS report. Schematic hash: `187ce46543abe38d3028afd28935462efd5831e96646837cc77779733437a5f4`.
- Carrier: **65 x 125 x 1.6 mm, four copper layers, 180 electronic footprints plus four mounting holes, 113 nonempty nets**. The parsed board still has **zero track segments and zero standalone routed vias**. Plated ground holes embedded inside the ESP footprint are separate features.
- The independent carrier audit reports 663 physical pad instances, 569 schematic pins and nine extracted keepouts with no recorded source-to-carrier mapping errors. This validates the generated files, not the native application's complete imported state.
- U1 pads 4/5/6 now carry AUD_BCLK/AUD_FSYNC/AUD_SDOUT; pad35 carries ADC_SHDN_N. U23 AVDD is filtered ADC_AVDD, IOVDD is 3V3_SYS, and AREG/DREG/reference/bias remain separate nets. These internal regulator outputs are not connected to the 3.3 V rail.
- R342 is actually at **(30,116), 90 degrees, bottom side** in the current PCB. The USB NPTH/body repair and the NPTH-aware saved-placement audit agree; all other placements were retained.
- The circuit retains **five user buttons plus BOOT/RESET**. SW1 uses the reviewed Omron two-terminal logic-switch footprint, not a switch carrying battery current. J8/J9 use opposite-side exits with actual pad origins and documented tip/sleeve/ring assignment.

## Voltage/current review and manufacturing holds

| Area | Current design assessment | Required before release |
| --- | --- | --- |
| Battery | Protected 1S LiPo, 4.2 V charge chemistry, 2,000 mAh starting profile; J2 pin1 positive/pin2 ground | Exact pack MPN, dimensions, polarity, >=2 A discharge capability and NTC approval remain unresolved. No week-long recording claim. |
| Charger U2 | 2.00 kohm ISET gives 445 mA nominal, about 492 mA calculated setting maximum. At 5 V input/3.2 V battery, charge-path dissipation alone is about 0.80 W | Verify pack charging-current limit and tolerance, thermal copper/vias, closed-case temperature and power-path sharing. Input current is shared with active system load. |
| Temperature | Suggested 103AT-2 with BQ24074 gives a nominal 0-50 C window | A 0-45 C-rated pack is not automatically compatible. Resolve actual threshold/NTC tolerances or add suitable hardware temperature control; attach NTC to the cell. |
| USB input | CC current-detection logic selects conservative USB100, configured USB500, advertised-current resistor mode or suspend. Calculated resistor-mode maximum is about 1.401 A | Prove attach/detach, both connector orientations, depleted/missing battery, valid enumeration and suspend handling. A cable alone does not authorize 500 mA; legacy sources can charge slowly. |
| Main 3.3 V | Divider gives 3.3077 V nominal; static tolerance calculation approximately 3.220-3.398 V is within the selected 3.6 V maximum input ratings | Scope startup and low-battery Wi-Fi/SD/speaker peaks. Static compatibility does not prove transient limits. Recalculate the old peak envelope for new ADC/buffer/bias loads and actual converter losses. |
| Audio bias | 3.014 V MICBIAS through 2.2 kohm gives about 1.914 V at a 500 uA capsule; both shorted branches draw about 2.74 mA versus 20 mA published MICBIAS capacity | Confirm actual capsule current, insertion transients, gain/clipping and effective AC-coupling/reference capacitance. This is arithmetic, not a measurement. |
| Input protection | Socket TVS and series/coupling network are specified | TVS pulse clamp exceeds the ADC's absolute input maximum. Review the complete clamp/current path and qualify ESD/hot-plug; the TVS alone does not prove ADC protection. |

**The power button switches off the main recorder load, not every battery-powered circuit.** U9 controls U10, removing SYS_SW/MAIN_RAW and the main regulator/speaker load. Charger, gauge, RTC backup and always-on control circuitry remain alive so charging/timekeeping work while off. Full physical battery isolation requires disconnecting the battery or an additional appropriately rated mechanical arrangement. Off-state leakage remains a measurement, not zero by definition.

Normal shutdown must finish the WAV/manifest and SD writes before firmware pulls POWER_HOLD low. The hardware timeout can force a cutoff, so recovery after interrupted writes is still necessary. PGOOD and CHG alone cannot establish actual charging: CHG may remain low during a temperature pause. Use valid input plus measured battery-current direction and hide ETA when unplugged, suspended, faulted or discharging.

## Routing and native-import work still outstanding

1. **Route copper.** No functioning assembled recorder follows from an unrouted board. Complete charger/regulator high-current loops and thermal structures; shunt Kelvin traces; continuous ground reference; source damping; USB impedance from the chosen stackup; SD routes; microphone input isolation; and independent speaker-current returns.
2. Refine U23 pin-side decoupling and reference/bias loops. Some packed ADC passives are 5-7 mm from the IC centre. A collision-free courtyard arrangement is not an analog-layout signoff.
3. Close PDM timing. At 3.072 MHz, the nominal half-cycle budget is about 33 ns after stated data/setup times, falling to about 16.5 ns for the shorter 45%-duty half-cycle before buffer/RC/skew. Verify rise/fall, delay and both microphone channels at their pins; slower supported bring-up clock is an option.
4. Finish mechanical fit: actual battery, side-jack 12.5 mm height/bushing openings, solder tails, display cable/standoff, front 41 x 29 x 10 mm speaker, SD ejection travel and antenna clearance. The earlier enclosure is not approved for this 125 mm board.
5. Preserve microphone acoustic NPTHs, repeated GND quarter pads, mask and custom stencil apertures; ADC and power exposed-pad paste geometry; plated slots; and all-layer RF/socket keepouts in native CAD and actual Gerbers.
6. The initial independent review inspected an earlier pre-fix native capture. The subsequent final saved-project export (SHA-256 `299981378ff657e3aebd834a51e26d2fa41804a9d9e8c0c5d34b2b89d3b9411d`) now passes electrical mapping, device-to-footprint metadata, placement, geometry and stencil checks. It preserves all 180 electronic components and 113 nets; the four mounting holes are restored as standalone native NPTH pads. Native schematic checking reports zero errors/warnings; PCB DRC reports 543 unrouted connections and no other findings. Complete routing and inspect actual copper/mask/paste/drill Gerbers before manufacture; this saved placement does not close those release holds.

The first build should use factory reflow for MEMS, hidden-pad ADC/power devices and the ESP underside pad. User soldering of accessible connectors, external microphone cables and approved harnesses is a practical learning step; an ordinary iron cannot properly assemble the entire current design.

## Review boundary

This pass confirms current file revision, structural pin/net correspondence, placement repair and design arithmetic. It does **not** validate routed electrical performance, native post-repair CAD state, LiPo safety/thermals, USB compliance, mic-room accuracy, endurance or fabrication readiness. Those require completed routing, selected battery/harness parts and assembled-board measurements.

Primary manufacturer documents are linked in `power-design.md`, `controller-design.md` and `audio-design.md`; historical A1 reviews remain separate evidence. Do not substitute their older checksum for this current B1 carrier.
