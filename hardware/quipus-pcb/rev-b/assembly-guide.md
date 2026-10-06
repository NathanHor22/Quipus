# Quipus Rev B — ordering, assembly and first-board learning guide

Prepared 2 October 2026. **Engineering draft; not permission to fabricate or a claim of tested hardware.** Rev B adds two wired analog microphone inputs to the two built-in digital microphones. The new board needs its own firmware profile. The existing recorder firmware cannot be assumed to capture these four channels.

The diagrams and pin-to-net files explain the intended circuit. They do not replace a finished routed PCB, footprint verification, electrical-rule checks, manufacturing checks or first-article measurements. Do not send the older Rev A PCB to a factory expecting Rev B audio features.

## What a PCB order actually supplies

**Bare PCB fabrication** supplies the patterned board, solder mask, plated electrical holes and printed reference labels. It does not include the processor, microphone chips, charging circuit or firmware. A microphone's acoustic hole is deliberately unplated and is different from an electrical via.

**PCB assembly / PCBA** adds the specified components. A turnkey service purchases the agreed parts; a consigned service uses parts you provide. A hybrid order can assemble the small chips while leaving agreed parts for you to install. Ask for the exact component list, placement file, assembly scope and inspection/test scope in the quote. [PCBWay assembly service](https://www.pcbway.com/pcb-assembly.html).

Use three separate purchase lists:

1. The final electronic BOM for everything soldered onto the main PCB. Purchase exact manufacturer part numbers and package variants, not parts selected only by value or a seller's generic description.
2. Off-board items: screen module, compatible battery and NTC harness, speaker, SD card, microphone capsules, cables and case hardware.
3. The tools and consumables in `learning-tools.csv`. These are workshop items, not components to add to the PCB BOM.

All draft BOM rows with a pending manufacturer part number, footprint, battery approval or DNP decision remain purchase holds. DNP means **do not populate**. A reserved footprint is not automatically a part to buy or solder.

## The assembly split I recommend

The first custom board combines 0.5 mm-pitch packages, exposed thermal pads and delicate MEMS microphones. Learning on this entire board with a basic iron would make faults difficult to identify. You can learn useful soldering skills while the factory handles the difficult core.

| Assembly owner | Parts and work |
|---|---|
| Factory or experienced reflow technician | Charger, USB-C controller and protection, buck-boost regulator, gauge, four-channel audio ADC, PDM clock buffer, built-in MEMS mics and speaker amplifier; fine-pitch USB-C and microSD sockets; preferably ESP32 module and every main-board SMD component |
| You, with a practice board first | External microphone capsule leads, solder-cup 3.5 mm plugs, cable strain relief and heat shrink; selected accessible 0805 parts only when the exact assembly drawing marks them for manual fitting |
| You, without soldering when suitable harnesses are bought | Screen, battery/NTC and speaker harness connection; continuity checks; microphone/case mounting; SD installation; firmware and recording tests |

The current JST board connectors and Omron B3U-1000P controls are **surface-mount**. Do not buy a generic through-hole replacement and expect it to fit. If we deliberately choose through-hole JST headers or larger switches for a learning version, their footprints and enclosure geometry must change before PCB ordering. A breadboard is suitable for capsule experiments or an evaluation board, not for directly inserting bare WQFN ADC and MEMS parts.

Do not apply hot air to an attached LiPo, screen or plastic harness. Main-board soldering happens with USB and battery disconnected. Keep solder, flux and cleaning liquids out of microphone acoustic openings.

## 1. Finish and review the design before purchasing the board

The final release must resolve these items:

- Replace the old short-wire PDM accessory interface with **two separately wired 3.5 mm analog microphone inputs**, each with defined bias, input protection and coupling/filter parts.
- Route the two built-in PDM microphones into the audio ADC and its clock-buffer circuit. Send four synchronized slots to ESP32 I2S0. Keep the speaker on I2S1.
- Update the controller pin table, shared I2C address list, test points and capture firmware contract. Do not leave the old direct-PDM GPIO assignments in a Rev B schematic.
- Verify exact jack pad/contact mapping, including tip, sleeve, unused ring and any insertion-detection contacts. Generic 3.5 mm library symbols are insufficient.
- Preserve the chosen power path, current-limited USB charging, safe shutdown, SD retention and RTC backup. Lock the battery and NTC against the pack manufacturer's charge-temperature limits.
- Place built-in mics at the upper and lower front acoustic openings. Reserve gasket paths, screen clearance, mic cable routes, speaker chamber, SD ejection travel and antenna keepout. Connector forces need mechanical support.
- Verify every pin and footprint against the exact datasheet/package drawing, then complete ERC, routing and DRC using the manufacturer's stackup. A neat placement diagram is not a routed PCB.
- Check USB pair impedance, power-loop geometry, uninterrupted ground returns, ADC/microphone isolation from regulator switch nodes and speaker current, acoustic-hole no-copper areas, and regulator thermal copper.
- Update the enclosure from the actual PCB and connector models. The earlier Lantern enclosure should not be used as a dimension guarantee for this board.

For the audio converter, the proposed **TLV320ADC5140** supports combined analog and digital microphone capture and has integrated input gain. The production schematic still needs clock timing, power/reference filtering and exact input topology checked. [TI ADC datasheet](https://www.ti.com/lit/ds/symlink/tlv320adc5140.pdf).

## 2. Request a quote and order only the reviewed revision

Provide the factory with:

- Gerbers for every copper, mask, paste and silkscreen layer, the board outline and NC drill files, with plated and unplated holes identified.
- PCB specification: reviewed four-layer stackup, thickness, copper weight, finish, tolerances and any impedance requirement. These must match the routing design.
- BOM: references, quantities, values, exact manufacturer part numbers, packages and DNP markings. Component substitutions require review.
- Pick-and-place/CPL file: reference, X/Y position, rotation and top/bottom side. Rotations must be checked against the factory's interpretation.
- Assembly drawings and special notes for microphone bottom ports, exposed pads, connector orientation and which parts are deliberately left unassembled.
- Requested inspections: preferably AOI, plus appropriate inspection of exposed-pad joints and electrical continuity. Ask which tests cost extra; assembly alone does not include our functional audio tests.

Ask for two assembled boards and one spare bare board if affordable. For consigned assembly, ask the factory how many extra pieces of each part it needs for setup and attrition. Buy small spares for hand-assembled capsules and connectors after the final BOM is locked. Do not add spare battery packs to an unapproved charging design.

## 3. Prepare the off-board parts

| Item | Starting requirement | Status and check |
|---|---|---|
| Screen | Waveshare SKU 15867, 1.3 inch 240 × 240 ST7789 LCD **module**, non-touch | Confirm physical revision and connector orientation; LVGL is the UI software, not a screen part |
| Battery | Protected 1S 2,000 mAh LiPo, ordinary 4.2 V charge chemistry; adequate discharge rating | Exact pack, dimensions, charge limits and thermistor approval remain open; no 2S, LiFePO4 or 4.35 V substitute |
| Battery harness | JST PH 2.00 mm two-position mating harness | Verify board pin 1 PACK+ and pin 2 GND with a meter; wire colours and keyed plugs do not prove polarity |
| Temperature sensor | Cell-mounted NTC and matching keyed harness | Exact NTC/window must be approved for the chosen cell; no fixed-resistor bypass |
| Speaker | 8 ohm, 2 W nominal dynamic driver, with matching two-wire harness | Exact driver remains open; confirm impedance and case fit before reuse of an existing speaker |
| Storage | Genuine microSD card from an authorized seller | Start with a known-good 32 GB FAT32 test card; format and filesystem support follow the final firmware |
| External mics | Two PUI AOM-5024L-HD-R electret capsules | Approved test candidate, not proof of pickup distance |
| Mic leads | Two one-metre flexible shielded mono microphone cables and two solderable 3.5 mm TRS plugs | Cable/plug dimensions must fit strain relief; pin mapping must match the final sockets |
| Mic housings | Two printed pucks, acoustic mesh, soft supports and strain relief | Housing dimensions follow capsule drawing; open acoustic path and clamp the cable mechanically |
| Case hardware | Screws, spacers, gasket/mesh and button actuators from final case drawing | Do not guess lengths that could touch or puncture the battery |

The proposed display is a finished module with its own PCB and backlight circuitry. Use a matching cable; the Quipus connector follows the module's **J2** signal order, which is reversed relative to its J1 header numbering. Continuity-check named signals at both ends before power. [Waveshare official schematic](https://files.waveshare.com/upload/0/0c/1.3inch_LCD_Module_Schematic.pdf).

## 4. Learn soldering on expendable parts first

Use a through-hole practice kit or perfboard, followed by an inexpensive 0805 practice board. Learn to make a clean joint, remove a bridge, tin a stranded lead and use heat shrink. Use flux, a stand, eye protection and local fume extraction. A ventilation fan should move fumes away from your face rather than blow across the joint.

After practice, assemble one external puck lead before touching the main PCB. The PUI handling limits are a tip temperature of **360 ±10 °C** and **no more than two seconds per terminal**; its instructions also specify an iron below 90 W. Pre-tin leads so the capsule is exposed to heat only briefly, allow cooling between attempts and do not obstruct its diaphragm. These limits apply to this capsule, not every part on the board. [PUI datasheet and handling instructions](https://puiaudio.com/file/specs-AOM-5024L-HD-R.pdf).

For JST SH and PH harnesses, buy precrimped leads or complete mating cables rather than learning tiny crimps on the final device. Still inspect contact seating and verify continuity; premade harnesses can reverse pin order.

## 5. Inspect the unpowered assembly

Disconnect USB, battery, display, speaker, external microphones and SD card. Check the factory's reference markings against the final BOM. Under magnification, look for solder bridges, shifted parts, missing parts, damaged sockets and blocked acoustic holes.

With a multimeter, check for hard shorts between GND and VBUS, BAT_PACK_P, SYS_RAW, SYS_SW and 3V3. Capacitors can briefly make a continuity tester beep while charging; record stabilized resistance rather than declaring every beep a short. Verify battery and display cable polarity separately. Do not perform resistance or continuity measurements on a powered board.

Where the assembly process permits staged population, validate the power circuitry before adding the processor/audio core. With a fully populated factory board, hold the ESP32 in reset and disable downstream loads during the initial rail check; this is less isolation than a power-only first article. Final test pads and configuration links must be provided in the release drawing.

## 6. Bring up power using a bench supply before a real battery

Use a current-limited regulated bench supply as a temporary battery substitute, **with no LiPo and no USB attached**. Connect only to the reviewed BAT_PACK_P/GND test interface or verified J2 harness. Start at 3.7 V with a low diagnostic current limit, such as 50 mA, with the processor held in reset and speaker/display/SD absent. That limit is not enough for normal operation. If it limits continuously, disconnect and investigate the expected load and joints rather than immediately raising it.

Check these rails in order, pressing Power where required:

| Test net | Expected behaviour |
|---|---|
| BAT_PACK_P / BAT_P | Bench voltage, with a small shunt/path difference according to current |
| SYS_RAW | Near battery voltage, reduced by the power path |
| 3V3_AON | Approximately 3.3 V when SYS_RAW allows LDO headroom |
| SYS_SW | Near SYS_RAW when Power enables the main load; off when shutdown completes |
| 3V3 | Approximately 3.31 V nominal; design calculation spans about 3.22–3.40 V before transients |

Measure with respect to GND. A scope is needed to check startup overshoot and ripple; a meter reading alone cannot prove those are acceptable. Digital mic supply must remain below its 3.6 V recommended upper limit. Keep raw battery and USB 5 V off every 3.3 V GPIO/display/SD/audio supply. [Infineon microphone datasheet](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf).

Once rails and expected idle current pass, a technician can increase the supply current limit for processor boot, then separately for Wi-Fi and playback, within the reviewed harness/power-path limits. Record the actual current rather than treating the regulator's advertised rating as the entire board's allowance.

## 7. Add functionality one block at a time

1. **Processor and USB:** load a minimal Rev B diagnostic firmware with Wi-Fi, audio and display initially disabled. Verify boot/reset and native USB in both connector orientations. The native USB charging policy starts conservatively at the default-current entitlement; a default USB source is not enough to assume full Wi-Fi operation without battery support. Do not raise the charger limit merely to hide brownouts. Validate enumeration, detach and suspend before enabling higher USB allocation. [Power design](power-design.md), [TI USB-C controller](https://www.ti.com/lit/ds/symlink/tusb320lai.pdf).
2. **I2C:** read identities/status from gauge, RTC, button expander and new ADC. Confirm the final address table has no collision. Configure the RTC backup behaviour and disable its trickle charger before attaching the approved LiPo.
3. **Controls:** test Power, Start/Enter, Stop/Back, Up, Down, BOOT and RESET separately. Service BOOT/RESET are not volume or everyday power buttons.
4. **Screen:** power down, attach the verified screen harness, then run a colour/text test at conservative SPI speed. Check brightness control and current.
5. **SD:** power down, fit the test card, mount it, write/read a test file and compare its contents. Confirm insertion detection and clean unmounting.
6. **Built-in audio:** configure the ADC and buffered PDM clock, record separate upper/lower channels and verify levels and ordering. The new capture path is TDM/standard digital audio from the ADC, not the old direct-PDM driver.
7. **Speaker:** attach the verified driver and begin at low digital level. Check the amplifier's supply, shutdown and temperature. Both speaker terminals are driven outputs; **neither is ground**. Do not put a grounded oscilloscope clip on either terminal. [MAX98357A datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/max98357a-max98357b.pdf).
8. **External mic A, then B:** perform the puck tests below, then verify four distinct synchronized channels. Handle insertion/removal with recording stopped during initial tests.
9. **Wi-Fi:** enable it while recording to SD; measure rail dips and listen for interference. Verify complete upload and local-file retention until acknowledgement.
10. **Battery charging:** only after pack/NTC approval and bench checks, connect the real protected pack. Test charging current, polarity, temperature, unplug behaviour and status indications under supervision.

## 8. Assemble and test the wired microphone pucks

The initial Quipus accessory is **mono analog with plug-in power**. The proposed mapping is tip = audio plus bias, sleeve = return, ring = unused. That proposal must be confirmed against the selected jack's actual pad mapping and final schematic before soldering. Do not assume compatibility with a phone's TRRS headset socket or a different recorder.

The current PUI mechanical drawing does not label physical positive/negative pads: obtain manufacturer-confirmed pad identity first; do not guess from a rotated photo or case continuity. After that confirmation, attach the signal conductor to positive and the return/shield to negative, and keep the acoustic opening clear. Use the finalized shield termination scheme; check for continuity and shorts with the cable detached. Fit heat shrink and strain relief before closing the plug. The capsule, cable and plug should be mechanically supported so neither terminal carries pulling force.

The Quipus main board supplies microphone bias through its input circuit and receives AC audio through the ADC's coupling/filter network. The capsule does not connect directly to an ESP32 GPIO, PDM header, raw battery or speaker output. Start with the documented 3 V / 2.2 kOhm test condition as the validation reference; the finalized audio sheet controls the actual circuit.

First record one puck outside its housing, then inside it. Repeat for the second. Use identical speech at 0.5, 1, 2 and 3 metres, the intended far seat, and realistic air-conditioning/background noise. Test with Wi-Fi and SD activity present. Listen to raw channels, inspect clipping/noise and compare transcription errors against a known script. Do not summarize these tests as guaranteed room range.

One-metre analog leads are the first prototype. Retractable mechanisms, moving-contact reels, USB microphones, universal headset support and 5–10 metre cable claims are outside this release. They require their own noise, wear and compatibility testing.

## 9. Prove the device before closing the case

Record all four channels continuously, exercise screen/buttons during capture and upload the resulting files. Verify expected WAV duration and size, no dropped samples, correct microphone labels and complete dashboard replay. Test stop/finalization, ordinary power-off, forced shutdown and recovery without losing previously completed recordings.

Then repeat Wi-Fi/SD/playback rail measurements at low battery, assess speaker and charge temperature in the closed case, and run a full six-hour recording/sync cycle. Measure battery-terminal energy and off-state current before stating a runtime. A 2,000 mAh rating does not establish a week of daily recording.

Keep a first-article log with board serial/revision, firmware build, card model, battery model, supply limits, measured rails/current, audio samples and failures. Only after these measurements and engineering review should this become an approved fabrication package or a larger production order.
