# Quipus Rev B — retained power/control footprint audit

Review date: 2 October 2026. Scope: the retained power and controller circuitry in `rev-a/easyeda/footprints-power.json`, `footprints-controller.json`, their referenced source footprints, and `output/pcb/Quipus-A1-EasyEDA/Quipus-A1.kicad_pcb`. This is a source/file audit, not native EasyEDA ERC/DRC, routing review, fabrication approval or measured hardware validation. No cloud CAD document was edited during this audit.

## Independent file checks

An independent S-expression read compared each power/control circuit pin to each numbered PCB pad, including repeated exposed-pad, ground and socket-shell instances. Result: **120 components and 417 mapped physical pad instances, with no missing pad or normalized pin-to-net mismatch**. Every referenced source-footprint SHA-256 matched its manifest.

Two explicit exporter aliases are necessary: `3V3` becomes `3V3_SYS`; `SYS_SW` becomes `MAIN_RAW`. They are naming conversions, not extra physical rails. Keep `3V3_AON` separate. A literal name-only comparison without these aliases produces misleading errors.

The board inspected has **zero track segments and zero routed vias**. Embedded through-hole footprint pads are not routed vias. Its SHA-256 at inspection was `5f48361c2ff1a57b59c6621943f8e72196b9cb33372bc079969b886fc56f1d6c`. The older stored `import-validation.json` records a different PCB hash, so it is not current-file validation evidence. Rerun the complete validator after rebuilding or editing.

The upstream footprint geometry is carried in a KiCad-5-compatible import file; modern library UUID/property/arc syntax was normalized for the carrier. Back-side pads use the exporter's documented local reflection and placement rotation. Import conversion must preserve numbering, drill/slot plating, repeated pad numbers, keepouts and paste-only apertures. Source checksums identify exactly which footprint was used; they do not prove the CAD application's imported result.

## Parts that can be made exact in the new BOM

### SW1 — power controller button

Use **Omron B3U-1000P**, the normally-open, top-actuated, two-terminal SMT version with no grounding lug or locating boss. It is suitable as the **logic input** to the LTC2951 button controller. It must not carry battery, charger or speaker current. Do not substitute B3U-1100P, a boss variant, a side-actuated variant or a generic four-pin tactile switch without changing the footprint.

The retained power footprint has lands 0.9 × 1.7 mm at x = ±1.7 mm, with left pad numbered 1. The controller's separately named `Quipus_Omron_B3U-1000P` uses the manufacturer's nominal 0.8 × 1.7 mm lands, with right pad numbered 1. The switch is nonpolar and electrically symmetric; this naming difference is not a functional reversal. **Use the controller custom footprint for SW1 too**, after updating its footprint manifest/hash, so all seven buttons use one traceable pattern.

The manufacturer shows a 3 × 2.5 mm body, 1.2 mm case height and approximately 1.6 mm height at the actuator. The case needs a supported actuator and tolerance/travel review; a two-terminal SMT switch is not a structural push rod. Omron gives 0.15 mm nominal pretravel and 1.50 N nominal operating force. The published minimum-applicable-load reference is 10 microamps at 1 V; verify the LTC2951 PB pull-up current against that reference rather than describing the button as qualified at any arbitrarily low current. [Omron B3U datasheet](https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3u.pdf).

### J3 — battery thermistor connection

Use **JST SM03B-SRSS-TB(LF)(SN)**, side-entry SH-series, three positions, 1.00 mm pitch. Mating housing is **SHR-03V-S**; contact is **SSH-003T-P0.2-H** for the manufacturer's applicable wire range. Keep the board mapping:

| Pad | Net |
|---|---|
| 1 | BAT_NTC |
| 2 | GND |
| 3 | Explicitly unused |
| MP, both mechanical tabs | No electrical net |

The reviewed source pattern has three 0.6 × 1.55 mm lands on 1.00 mm pitch and two 1.2 × 1.8 mm mounting tabs at x = ±2.3 mm. The side-entry body envelope is 5.0 × 4.25 mm in the source drawing. Its courtyard is 6.8 × 6.56 mm. JST identifies its generic PCB pattern dimensions as reference values; retain the reviewed library geometry and get an assembler/JST check before freezing paste and mask. The old footprint's `top entry` tag is misleading metadata; its model code and physical geometry are **side entry**. [JST SH datasheet](https://www.jst-mfg.com/product/pdf/eng/eSH.pdf).

This connector makes the NTC harness distinct from the two-position speaker connector. It does not resolve the battery's charge-temperature-window approval: that is still a circuit/selected-pack issue.

## Retained footprints and pin-mapping hazards

| Reference | Retain this geometry and mapping | Manufacturing concern |
|---|---|---|
| U11 TPS63802DLAR | Custom DLA0010A, ten asymmetric copper lands; 2 × 3 mm package body. Pins 1/10 SYS_SW, 2/3/8 GND, 4 FB, 5 PG, 6 3V3, 7 L2, 9 L1 | Not a generic ten-pin QFN. Pin 8 is the elongated ground land; do not invent an extra center exposed pad. Manufacturer drawing was inspected against the local land-pattern image. Five left lands 0.60 × 0.25 mm; four right lands 0.90 × 0.25 mm; pin 8 1.30 × 0.25 mm. Keep converter/inductor/capacitor placement compact and review paste-only apertures. |
| U2 BQ24074RGTR | RGT0016C, 16 perimeter pins plus EP17 to GND | Exact charger pin map must survive import; pin 15 is intentionally unused. EP copper and stencil windows need an actual thermal-via/reflow plan. Footprint lookup alone does not establish charge temperature. |
| U12 BQ27441DRZR-G1A | DRZ0012A, twelve perimeter pins and three same-number pad-13 pieces forming one H-shaped GND EP | Preserve all pad-13 pieces and their same net. SRP pin 8 senses the pack-side shunt pad; SRN pin 7 senses the charger-side shunt pad. Separate Kelvin traces and exact shunt MPN are still required. |
| J1 GCT USB4105-GF-A | Twelve physical signal solder tails, four separate grounded shell stakes, two NPTH locating holes | Shared A/B contacts are consolidated as A1_B12, A4_B9, B4_A9, B1_A12. Do not add duplicate coincident power lands or lose the four plated oval shell slots in drill output. Both USB data contact pairs join their corresponding nets. |
| U13/U35 TPD2EUSB30DRTR | Same TI DRT three-pad physical package; 0.30 × 0.30 mm lands | U13 protects CC lines; U35 protects USB data. Same package does not mean the same nets. Preserve pin 3 GND and avoid long protection stubs. |
| U34 TS3USB221ARSER | RSE ten-pin 1.5 × 2 mm UQFN, no generic extra EP | Pin 10 switched 3V3, pin 5 GND, pin 6 selection, pin 9 OE; common D−/D+ are pins 7/8. Follow the actual datasheet orientation and power-off behavior. |
| J6 Hirose DM3AT-SF-PEJM5 | Eight card contacts, A/B insertion detector, four SH shell lands; 13.85 × 15.95 mm socket envelope, 1.68 mm height | Source variant renames old library detector 9/10 to manufacturer B/A. Card contact 2 DAT3 is not detector A. Preserve socket no-copper regions and push-push travel. All four SH instances are GND. |
| J2 battery | JST PH S2B-PH-SM4-TB(LF)(SN), right-angle SMT; pin 1 pack positive, pin 2 GND | A keyed connector does not prove a purchased LiPo's wire polarity. Mechanical tabs are unconnected. Harness/pack current rating and case bend space need checking. |
| J7 display | JST B8B-PH-K, vertical **through-hole**, eight pads with 0.75 mm drills at 2.00 mm pitch | This connector differs from the SMT JST parts and can be a manual-solder learning item. Its height and exposed opposite-side joints affect the display/battery spacing. Pin order follows Waveshare module J2, not J1. |
| U1 ESP32 module | All 41 pad numbers, including central GND pad 41 and twelve same-number plated 0.20 mm holes | Source holes are below the carrier's generic 0.25 mm minimum-via drill setting. They are footprint plated holes, but the fabricator must support their drill/annulus and paste strategy. Do not silently convert them to NPTH or enlarge without checking pad geometry. Preserve all-layer antenna keepout. |

Primary verification material: [TI TPS63802 drawing](https://www.ti.com/lit/ds/symlink/tps63802.pdf), [BQ24074](https://www.ti.com/lit/ds/symlink/bq24074.pdf), [BQ27441](https://www.ti.com/lit/ds/symlink/bq27441-g1.pdf), [TPD2EUSB30](https://www.ti.com/lit/ds/symlink/tpd2eusb30.pdf), [TS3USB221A](https://www.ti.com/lit/ds/symlink/ts3usb221a.pdf), [Hirose DM3AT catalog](https://www.hirose.com/product/download/?distributor=mouser&lang=en&num=DM3AT-SF-PEJM5&type=catalogue), [JST PH](https://www.jst-mfg.com/product/pdf/eng/ePH.pdf), [GCT USB4105 drawing](https://gct.co/files/drawings/usb4105.pdf), [Waveshare display schematic](https://files.waveshare.com/upload/0/0c/1.3inch_LCD_Module_Schematic.pdf). The GCT download returned a transient web-tool error during this pass; its retained source geometry and mapped PCB contacts were audited locally rather than represented as a newly downloaded drawing.

## Required checks when creating the Rev B PCB

1. Lock SW1/J3 exact MPNs and unify SW1's selected footprint. Recompute the footprint file hash after any update. Preserve any intentional package-specific paste-only pads.
2. Rebuild from the Rev B netlist rather than editing old ratsnest names by hand. New ADC and clock buffer require their own footprint review; this retained-circuit audit does not cover them.
3. Use one canonical switched-rail naming scheme across schematic, PCB, BOM/test points and generated files. Never let alias replacement join the always-on and switched rails.
4. Extract footprint keepouts into all appropriate board layers when the legacy carrier cannot retain nested keepout syntax. Enforce U1 antenna and J6 card socket restrictions in native CAD.
5. Place mounting-hole head/post keepouts, connector shell/plug envelopes, screen harness bend and card ejection travel before routing. A pad-clearance check cannot establish mechanical access or battery-pouch clearance.
6. Route the power stage according to TI's layout, keep SRP/SRN Kelvin paths independent, and route the USB pair against the factory stackup. Native ERC/DRC must be run on the resulting **routed** board. A clean pad mapping gives no thermal, USB signal-integrity or microphone-noise guarantee.
7. Export plotted copper/mask/paste/drill and inspect them independently. Confirm plated versus nonplated holes, slots, the gauge EP and microphone acoustic holes in the actual manufacturing files.

The retained baseline is reusable as a reviewed starting point, subject to these corrections and checks. It is not a completed fabrication-ready board.

## Current B1 carrier appendix — 2 October 2026

The A1 checksum and stale-validation discussion above are preserved as historical evidence. They do not describe the current rebuilt B1 carrier. `output/pcb/Quipus-B1-EasyEDA/Quipus-B1.kicad_pcb` now has SHA-256 **d19ff1b295be70aafc89c9cb795fcefa9964c902f8e7c659dd3cc42945544315**, matching its current `import-validation.json` PASS result. It contains 180 electronic footprints, four mounting holes, 113 nonempty nets and a 65 x 125 mm outline. R342 is at (30,116), 90 degrees, bottom side. The carrier remains unrouted, with zero track segments and zero standalone routed vias.

SW1 now uses the exact reviewed Omron B3U-1000P pattern in the current assignments. For clarity, U34's retained table prose reverses the two tied-low control names: **pin6 is OE_N, pin9 is S**, as correctly defined in the circuit and PCB; both are GND in this design, so the wording error does not change its current function. Keep the physical mapping when modifying it later.

The new independent final review is `easyeda/final-engineering-review.md`. Main power-off removes the recorder/amp/regulator load while charging, gauge, RTC backup and always-on controls remain powered. It is not complete physical battery isolation. Exact battery/NTC approval, copper routing, post-repair native capture/ERC/DRC, stencil review and bench thermal/current tests remain release requirements.
