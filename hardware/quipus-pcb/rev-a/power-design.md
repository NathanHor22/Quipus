# Quipus Rev A — power design and electrical review

**Status: engineering design draft, 29 September 2026. Not a fabrication release.**

This design starts with a removable, protected single-cell 2,000 mAh LiPo. Changing capacity later is possible only with the same approved voltage/chemistry, connector polarity and adequate current capability. The fuel-gauge configuration and charging assumptions must also be updated. A week of 5–6 hours/day recording is not a runtime claim for this battery.

`power-circuit.json` is the machine-readable pin-to-net definition. Its physical pin numbers belong to the named packages, not to arbitrary EasyEDA community symbols. The final combined schematic must preserve those assignments.

## 1. Power domains

```
USB-C VBUS -- F1 -- USB_PROTECTED --> BQ24074 IN
Protected LiPo PACK+ -- 10 mOhm shunt --> BQ24074 BAT
                                               |
                                          SYS_RAW
                              +----------------+----------------+
                              |                |                |
                        Control 3.3V LDO    LTC2951          TPS22918
                              |              button             |
                        CC detector/logic                    SYS_SW
                                                       +--------+--------+
                                                       |                 |
                                                  TPS63802        Speaker amplifier
                                                       |
                                                  3V3 main rail
                                              ESP32, SD, display, mics
```

- `BAT_PACK_P`: protected pack positive at J2, upstream of the current shunt.
- `BAT_P`: downstream of the shunt; charger BAT and RTC backup connect here.
- `SYS_RAW`: charger power-path output. Approximately battery voltage minus path loss on battery; 4.4 V nominal, 4.3–4.5 V specified, on adequate USB input.
- `SYS_SW`: main load switch output. All high-consumption electronics are downstream.
- `3V3`: main regulated output, calculated 3.3077 V nominal.
- `3V3_AON`: always-on control rail. Nominal 3.3 V; follows SYS_RAW minus LDO dropout at low battery.

The power button disconnects the main electronics. Charger, gauge, RTC backup and button controller remain powered. This is deliberate so the device can charge and keep time while off; it is not complete physical battery isolation.

J3 uses three positions so it cannot be mistaken for the two-position speaker connector. The battery connector is the larger PH family.

## 2. Battery and connector requirements

| Item | Rev A requirement |
|---|---|
| Cell arrangement | One cell only, 1S |
| Chemistry | Standard Li-ion/LiPo suitable for 4.2 V charging; not LiFePO4 or a 4.35 V pack |
| Capacity | 2,000 mAh starting profile |
| Pack protection | Integrated overcharge, overdischarge and overcurrent protection |
| Discharge rating | At least 2 A continuous, with verified pulse capability |
| Connector | JST PH, 2.00 mm, 2 positions; candidate S2B-PH-SM4-TB(LF)(SN) |
| Board polarity | J2 pin 1 = PACK+, pin 2 = GND |
| Temperature sensing | Separate 3-position JST SH J3: pin 1 NTC, pin 2 GND, pin 3 unused; cell-mounted 10 kOhm NTC |
| Replacement procedure | Shut down; unplug USB; disconnect battery and NTC; fit compatible pack; update capacity profile if changed |

JST housings are keyed, but vendors do not share a universal battery-wire polarity. Check voltage and polarity before plugging a pack into the PCB. The PH-series nominal current rating depends on specified contacts and wire; the assembled harness must meet the intended load. [JST PH specification](https://www.jst-mfg.com/product/pdf/eng/ePH.pdf)

**Open battery-selection item:** BQ24074 with the suggested 103AT-2 thermistor has a nominal 0–50 °C charge window. A pack permitting only 0–45 °C cannot automatically be approved. Comparator and NTC tolerances must fit the selected cell's permitted range. The direct TS circuit does not provide an arbitrary tighter window merely by changing one resistor. If the chosen battery needs tighter limits, add a hardware temperature-window circuit before manufacture. The NTC must touch the cell, not merely measure PCB temperature. No fixed resistor bypass is fitted.

## 3. USB-C source detection and current limit

U3 is **TUSB320LAIRWBR**, configured as a sink in GPIO mode:
- pins 1/2 to CC1/CC2;
- PORT pin 3 to ground;
- VBUS_DET pin 4 through R6 = 887 kOhm, 1%, to VBUS;
- ADDR pin 5 intentionally floating;
- OUT1 pin 7 pulled up to 3V3_AON with R7 = 10 kOhm;
- GND pin 10 and EN_N pin 11 to ground;
- VDD pin 12 to 3V3_AON with 100 nF local decoupling.

Internal CC termination supports attachment even with a depleted battery. Do not add external 5.1 kOhm CC pull-downs in parallel. OUT1 is high for default current and low for a source advertising 1.5 A or 3 A. [TI TUSB320LAI data sheet, pin functions and Table 3](https://www.ti.com/lit/ds/symlink/tusb320lai.pdf)

The CC detector, logic and latch remain powered while the main system is off. Therefore charging from an appropriate Type-C source does not require the ESP32 to boot.

U5–U8 implement:
```
HIGH_CURRENT_OK = NOT OUT1
DEFAULT_500     = USB_ENUM_500 AND OUT1
CHG_EN1         = USB_SUSPEND OR DEFAULT_500
CHG_EN2         = USB_SUSPEND OR HIGH_CURRENT_OK
```

| Source/request | EN2 | EN1 | Input-current selection |
|---|---:|---:|---|
| Default source, no configured USB entitlement | 0 | 0 | USB100 |
| Default source, USB host has configured 500 mA | 0 | 1 | USB500 |
| Type-C source advertises 1.5 A or 3 A | 1 | 0 | Resistor-limited, nominal 1.298 A |
| Firmware requests suspend | 1 | 1 | Charger input standby |

Firmware must clear USB_ENUM_500 at reset, detach, bus reset and loss of configuration. It must only assert it after valid USB configuration; never assume that a cable implies a 500 mA allocation. Firmware must apply the applicable suspend policy. A legacy USB-A wall adapter with no Type-C current advertisement and no implemented BC1.2 detection remains at the conservative default rate; this is slower charging, not a fault.

The AON regulator is powered from SYS_RAW so its consumption is included in the charger's managed input path. USB suspend, detach transients, leakage and descriptor behaviour still need host testing; this draft is not a claim of USB-IF certification.

J1 is GCT USB4105-GF-A. Its sixteen mating contacts use twelve signal solder tails, including shared A1/B12, A4/B9, B4/A9 and B1/A12 pads, plus four grounded shield stakes. Verify the imported footprint against the manufacturer's drawing. [GCT USB4105 drawing](https://gct.co/files/drawings/usb4105.pdf)

Native USB signal ESD/isolation and MCU series resistors are on the controller sheet. U13 TPD2EUSB30DRTR uses the three-pin DRT/SOT-9X3 package with a 1.0 x 0.8 mm body and protects CC1/CC2; D1 provides a VBUS ESD clamp. U13 and controller U35 use the same physical DRT footprint. A TVS is not sustained overvoltage protection. F1 is a candidate Littelfuse 0467002.NRHF, 2 A, 0603 fuse; confirm thermal derating, inrush and fault coordination. Validate the routed clamp path and connector shield grounding. [TI TPD2EUSB30](https://www.ti.com/lit/ds/symlink/tpd2eusb30.pdf), [TI TPD1E10B06](https://www.ti.com/lit/ds/symlink/tpd1e10b06.pdf), [Littelfuse 467 series](https://www.littelfuse.com/assetdocs/fuse-467-datasheet?assetguid=4a59f034-1cca-460e-a5ba-e1e66247c76d)

## 4. Charging circuit: U2 BQ24074RGTR

| Pin | Signal | Connection |
|---:|---|---|
| 1 | TS | J3 NTC; thermistor returns to GND |
| 2, 3 | BAT | BAT_P, with C2 10 uF |
| 4 | CE active low | GND, autonomous charging enabled |
| 5 | EN2 | Hardware current-selection logic |
| 6 | EN1 | Hardware current-selection logic |
| 7 | PGOOD active low | USB_PGOOD_N, 100 kOhm pull-up to switched 3V3 |
| 8, exposed pad 17 | VSS | GND with thermal copper/vias |
| 9 | CHG active low | CHARGING_N, 100 kOhm pull-up to switched 3V3 |
| 10, 11 | OUT | SYS_RAW, with C3 22 uF |
| 12 | ILIM | R1 1.24 kOhm, 1%, to GND |
| 13 | IN | USB_PROTECTED, with C1 4.7 uF |
| 14 | TMR | R3 68.0 kOhm, 1%, to GND |
| 15 | ITERM | Intentionally unconnected |
| 16 | ISET | R2 2.00 kOhm, 1%, to GND |

Calculated values:
- Nominal charge current: 890 / 2000 = **445 mA**, approximately 0.223C for 2,000 mAh.
- Maximum charge setting including listed IC factor and -1% resistor: 975 / 1980 = **492.4 mA**.
- Minimum charge setting: 797 / 2020 = **394.6 mA**.
- Nominal advertised-source input limit: 1610 / 1240 = **1.298 A**.
- Maximum resistor-mode input limit: 1720 / 1227.6 = **1.401 A**, below a 1.5 A advertisement.
- Default termination is approximately 10% of the charge setting in USB500/resistor mode and lower in USB100 mode; do not treat termination as an exact percentage sensor.
- Nominal fast-charge safety timer: 10 × 68 × 48 / 3600 = **9.07 h**. With resistor and timer-factor limits: approximately **6.73–11.45 h**, before DPPM/thermal timer-extension behaviour.

The input limit is shared between the system and charging. Recording, Wi-Fi or playback can reduce charging current or cause battery supplementation. The displayed charging state must use measured battery-current direction plus valid input, not PGOOD alone.

CHG can remain low during a battery-temperature pause. Consequently CHG low alone does not prove that current is flowing into the pack. Hide charge ETA when unplugged, suspended, faulted, or discharging. [TI BQ24074 data sheet, Tables 7-1/7-2 and charging sections](https://www.ti.com/lit/ds/symlink/bq24074.pdf)

Thermal estimate, not validation: at 5 V USB, 3.2 V battery and 445 mA, the battery-charging path alone dissipates roughly (5 - 3.2) × 0.445 = **0.80 W**. System-path loss adds heat. Use a proper exposed-pad land pattern, ground copper and thermal vias; test temperature in the closed case. Thermal regulation can reduce charge speed.

## 5. Safe shutdown and main load isolation

U9 is **LTC2951ITS8-1**, TSOT-23 pin numbering:
1 VIN = SYS_RAW; 2 PB = power button to GND; 3 KILLT = 1 uF to GND;
4 GND; 5 INT = PWR_INT_N; 6 EN = SYS_ENABLE; 7 OFFT = 100 nF to GND;
8 KILL = POWER_HOLD.

- EN has a 100 kOhm pull-up to SYS_RAW.
- INT has a 10 kOhm pull-up to 3V3.
- KILL has a 100 kOhm pull-up to 3V3 and connects to an MCU **open-drain** output. Default state is released.
- The pull-up brings KILL high as the main rail starts, avoiding a requirement for firmware to boot within the controller's 512 ms blanking interval.
- Firmware must leave this pin released until an intentional shutdown; initializing GPIO21 as a low push-pull output would cut power as soon as the blanking interval expires.
- Normal power-off handling: stop capture, finalize the current WAV, flush its manifest and SD writes, then pull POWER_HOLD low.
- If firmware fails to respond, the hardware timeout releases system power. Power-loss recovery is still required; a forced cutoff cannot guarantee the most recent SD write.

Using the data-sheet timer equation, 100 nF OFFT gives about **674 ms** of button hold before shutdown interrupt. 1 uF KILLT gives about **6.54 s** after that interrupt before forced cutoff. These are nominal values; validate actual capacitor tolerance and timing. [Analog Devices LTC2951 data sheet](https://www.analog.com/media/en/technical-documentation/data-sheets/295112fb.pdf)

U10 **TPS22918DBVR** has pin 1 VIN = SYS_RAW, 2 GND, 3 ON = SYS_ENABLE,
4 CT = 10 nF/25 V to GND, 5 QOD through 100 Ohm to SYS_SW, 6 VOUT = SYS_SW.
The switch disconnects the amplifier as well as the buck-boost input. Its nominal ramp is approximately 24 ms at 4.4 V, safely below the latch startup blanking interval; measure under real load.

Target a peak below 1.5 A through this switch in Rev A, leaving room below its 2 A rating. It is not a battery-protection current limiter. No external connector may back-power SYS_SW when off. [TI TPS22918 data sheet](https://www.ti.com/lit/ds/symlink/tps22918.pdf)

## 6. Main 3.3 V regulator

U11 is **TPS63802DLAR**, using the DLA0010A ten-pin VSON-HR/HotRod package with a **2 x 3 mm body**. The package drawing determines its asymmetric copper lands; the older 1.4 x 2.3 mm descriptive text is not the selected mechanical geometry:
pin 1 EN = SYS_SW; 2 MODE = GND; 3 AGND = GND; 4 FB = divider midpoint;
5 PG = local test net with 100 kOhm pull-up to 3V3; 6 VOUT = 3V3;
7 L2 and 9 L1 across 0.47 uH; 8 GND; 10 VIN = SYS_SW.

- Candidate inductor: Coilcraft XFL4015-471ME, identified by TI's reference list.
- Input: 10 uF nominal ceramic, effective capacitance at least the specified 4 uF minimum.
- Output: two 22 uF nominal ceramics, maintaining at least 7 uF effective capacitance at bias.
- Feedback: 511 kOhm upper, 91 kOhm lower, both 1%.
- Nominal output: 0.5 × (1 + 511/91) = **3.3077 V**.
- With resistor tolerance and ±1% feedback reference: approximately **3.220–3.398 V**, before load transients and mode-dependent regulation.
- MODE tied low allows power-saving operation. If acoustic/EMI testing finds switching interference, revise mode control after measurement.

The IC's 2 A capability does not mean the entire board may draw 2 A at 3.3 V plus speaker current through a 2 A battery connector. For example, 3.3 V × 0.85 A / (3.0 V × 0.85 assumed efficiency) is **1.10 A from the battery**, before the amplifier and other losses. This draft reserves roughly 0.85 A for short main-rail peaks and 0.35 A for amplifier supply bursts: about 1.45 A at a loaded converter input of 3.0 V and assumed 85% efficiency. Start audio with a -6 dBFS digital ceiling. Charger/switch/shunt/harness voltage drops and lower input voltage reduce margin; measure and derate before release. This allocation does not imply battery runtime.

Use short power loops, the manufacturer's copper layout and local ground connections. Keep switch nodes and the inductor away from microphone acoustic ports and clocks. Scope 3V3 during SD writes, Wi-Fi bursts and speaker playback at low battery. [TI TPS63802 data sheet](https://www.ti.com/lit/ds/symlink/tps63802.pdf)

## 7. Battery measurement and charge estimates

U12 **BQ27441DRZR-G1A**, 4.2 V chemistry variant, measures battery voltage and signed current through a high-side **10 mOhm, 1%, low-TCR shunt**. At 2 A the shunt drops 20 mV and dissipates 40 mW; a 0.25 W part provides electrical headroom.

| Pins | Connection |
|---|---|
| 1 SDA, 2 SCL | Shared I2C, 0x55; pull-ups to switched 3V3 only |
| 3 VSS, pad 13 | GND |
| 4, 9, 11 NC | Explicitly unconnected |
| 5 VDD | 0.47 uF to GND; internal 1.8 V output, no external load |
| 6 BAT | Kelvin sense from BAT_PACK_P, 1 uF local capacitor |
| 7 SRN | Kelvin sense from BAT_P side of shunt |
| 8 SRP | Kelvin sense from BAT_PACK_P side |
| 10 BIN | 10 kOhm to GND for this cold-swap design |
| 12 GPOUT | Local GAUGE_INT_N test net, defined pull resistors |

Use separate sense traces from each resistor pad, not general power tracks. Route the charger, RTC backup and all external battery loads after the shunt. The gauge's own upstream supply current is small but not included in its shunt measurement.

The bus has one pair of 10 kOhm pull-ups and 1 MOhm pull-downs so gauge inputs remain defined when main power is off. Start at 100 kHz and verify rise time for the actual bus capacitance; do not duplicate pull-ups on every sheet.

Configure capacity = 2,000 mAh, nominal energy = 7,400 mWh for a 3.7 V pack, and a termination voltage/current profile appropriate to the selected cell. Validate the G1A chemistry fit and calibration/learning behaviour. Capacity replacement is a maintenance operation; changing only the connector does not update the gauge's model.

The gauge permits a defensible charging indicator and current trend. A minutes-until-full estimate is still a software estimate: the final constant-voltage taper is nonlinear. Do not display precise-looking countdowns before stable measurements exist. [TI BQ27441-G1 data sheet](https://www.ti.com/lit/ds/symlink/bq27441-g1.pdf)

## 8. Power budget and prototype checks

The 2,000 mAh pack contains approximately 7.4 Wh nominal. Reserving 20% leaves a planning allowance of 5.92 Wh; this is not measured delivered energy. At 0.5 W average battery load that is 11.8 hours; at 0.8 W it is 7.4 hours. Recording duration must be measured with the chosen card, screen brightness, microphones and firmware.

A target for off-state battery draw is below 0.3 mA, including the always-on control rail, charger leakage, fuel gauge, RTC and latch. This would consume about 50 mAh/week before battery self-discharge. It is a design budget to verify, not a measured result. Press-to-wake allows the main processor, microphones and display to be physically disconnected.

Before a first assembly is approved:

1. Verify symbols against each chosen package pin table, including exposed pads.
2. Lock exact battery, NTC, connector, switch and fuse drawings; verify polarity.
3. Resolve the battery temperature-window requirement.
4. Check USB CC attach in both orientations, with a depleted or missing battery.
5. Prove current-selection truth table, enumeration, reset, detach and suspend behaviour.
6. Measure off-state leakage with USB attached and detached; check native USB and I2C back-power paths.
7. Bring up 3V3 with a current-limited supply before connecting the ESP32 module and battery.
8. Test power-button cutoff timing, SD flush, brownout recovery and battery removal recovery.
9. Measure charge temperature, taper, termination and input sharing in the actual enclosure.
10. Verify low-battery behaviour, 3V3 transient limits and total pack/harness current with Wi-Fi, SD and speaker operating.
11. Run a full 6-hour recording and sync cycle before making runtime claims.

PCB routing, manufacturing verification and these measurements are still required. No pin list alone proves electrical safety or production readiness.
