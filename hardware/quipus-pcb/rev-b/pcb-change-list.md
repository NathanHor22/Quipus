# Quipus Rev B — changes required before ordering boards

Revision B1, 2 October 2026. This is a change specification and review checklist, **not a routed board or fabrication release**. Existing Rev A files and the saved EasyEDA project are not silently updated by this package.

## What changes electrically

| Area | Rev A baseline | Rev B proposal | Reason |
| --- | --- | --- | --- |
| Meeting capture | Two onboard PDM mics and short-wire digital expansion | Two onboard PDM mics plus two independent analog extension mic inputs | Support near and extended microphone placement without a raw PDM cable across the room |
| Audio conversion | ESP32 directly converts PDM | U23 TLV320ADC5140 receives mixed PDM/analog and returns four PCM channels | One synchronized multichannel capture interface |
| GPIO4 / module pad 4 | PDM_CLK | AUD_BCLK, ESP output | I2S0 master bit clock |
| GPIO5 / module pad 5 | PDM_DIN0 | AUD_FSYNC, ESP output | I2S0 master frame clock |
| GPIO6 / module pad 6 | PDM_DIN1 | AUD_SDOUT, ESP input | ADC TDM output; the net name refers to the ADC direction |
| GPIO42 / module pad 35 | Spare | ADC_SHDN_N, ESP output | Hold the ADC inactive at reset and control its hardware shutdown |
| Shared I2C | Gauge, RTC, button expander | Add ADC at 0x4C | No duplicate address with 0x41, 0x52 or 0x55 |
| Extension connector | Short internal PDM header | Two sockets labeled MIC A / MIC B | Each socket has its own bias, protection and AC-coupled analog input |
| Microphone clocks | ESP-produced PDM | ADC-generated PDM through the specified audio-sheet clock interface | Timing between the converter and exact MEMS part must be measured |
| Speaker | MAX98357A, I2S1 | Retained | Capture and playback remain independent |
| USB | Charging and native USB device/service | Retained | USB-host microphone support is not included |

Remove old direct-PDM controller labels, symbols and external-header wiring. Do not connect the new analog sockets to the old PDM header, and do not use a headphone splitter to combine the inputs. Copy the exact component and pin assignments from `audio-circuit.json`; generic symbols with guessed pin numbers are insufficient.

Keep the existing charger/power-path, protected battery connector, NTC, buck-boost, load switch, fuel gauge, RTC backup, native USB protection, SD and display architecture as the baseline. Adding the ADC and analog input circuitry changes consumption and heat; recalculate measured load and thermal margins before release. The copied power design retains open cell/NTC selection and USB-current validation requirements. A 2,000 mAh pack is a starting capacity, not a week-long recording guarantee.

## What changes mechanically

- Place the built-in microphones near the **front top and front bottom**, with protective raised acoustic caps. Infineon bottom-port sensors need board acoustic holes and a short aligned passage to the front grille; exposing the metal sensor top does not expose the sound inlet. Respect the manufacturer's port, solder-mask and no-paste details.
- Put one extension socket on each side. Use keyed, documented connector wiring and clear MIC A / MIC B labels. Initial cables are detachable one-metre shielded analog leads. Reel mechanism, spring and cassette are excluded from this revision.
- Keep Power, Start/Enter and Stop/Back above the screen; place Volume down and Volume up below the screen. BOOT/RESET remain recessed service controls. Button actuator heights and case travel still need a mechanical drawing.
- Keep the front-facing speaker grille away from the microphone passages. Isolate its mounting from the microphone caps and use an enclosure partition/soft mounts so speaker air movement is not directly coupled into a mic port. Do not route unfiltered speaker outputs beside analog microphone input traces.
- Keep USB-C at an accessible bottom edge and preserve microSD insertion/ejection space on its selected edge. An extension jack or cable must not block card removal.
- Check the complete battery envelope, wires, NTC attachment, screen module, jack bodies and plugs in 3D. Battery capacity alone does not specify its dimensions. Do not compress the LiPo pouch or route screws into its volume.
- Preserve ESP module antenna clearance on all relevant copper layers and separate microphone opening placement from the antenna no-copper area. Use the exact module manufacturer's keepout; a decorative grille is not a reason to violate it.

The original approximately 65 x 105 mm PCB envelope is a starting constraint only. Side sockets and actual battery dimensions may require a revised outline. The previous enclosure STL is not approved for Rev B until these clearances are reconciled. No final coordinates or manufacturing tolerances are implied by a conceptual diagram.

## Layout and assembly requirements

1. Use a fabricator-approved four-layer stackup with a continuous ground reference. Put power switching circuitry in one zone, analog microphone circuitry in another, and keep speaker current returns and clock routes away from analog inputs. Use one coherent ground system with short returns; do not create arbitrary split-ground barriers underneath digital traces.
2. Position socket protection beside each connector; locate input components and ADC bypass capacitors close to their relevant pins. Keep high-impedance analog traces short. Follow the audio sheet's return path and filter choices.
3. Keep ADC, PDM buffer and onboard mics close enough for timing-controlled digital routing. Check clock edge rates and sensor input thresholds at the component pads, not only at the source pin.
4. Place regulator capacitors/inductor according to the vendor reference layout. Thermal copper, exposed pads and current-carrying tracks require a real PCB review. General-purpose autorouting is not a substitute for reviewing these loops.
5. Preserve the verified switch footprints. A four-terminal through-hole switch needs an explicit internal-contact mapping and a new footprint; do not exchange it with the current two-terminal Omron B3U part merely because both are called tactile switches.
6. For beginner hand assembly, consider final-CAD additions for short offboard normally-open button harnesses. Factory-populate hidden-pad power, audio and MEMS devices; hand-solder approved accessible connectors/harnesses and mechanically mount peripherals. This option is documented, not already implemented as additional connectors in the netlist.
7. Produce full silkscreen labels: connector function and polarity, pin 1, test point voltage, mic channel, switch function, PCB revision, and battery/NTC connector identification. Keep silkscreen away from acoustic openings and solder pads.

## Firmware/backend consequences

- This is a custom-board electrical change, not a drop-in firmware update to the current touchscreen development board.
- Set I2S0 to master TDM RX; four 32-bit slots at 16 kHz require 2.048 MHz BCLK. Match ADC frame, data offset, edge polarity and channel order. Keep I2S1 speaker allocation.
- Read all four slots. Store aligned 16-bit PCM as four independent channels: 128,000 bytes/s, 7.68 MB/minute, 460.8 MB/hour. Raw 32-bit DMA containers require 256,000 bytes/s of internal transfer before conversion.
- Preserve the original four-channel WAV and channel map. Channel selection, beamforming or a mono transcription derivative must not overwrite the source recording. The backend must accept this format rather than assume a mono WAV.
- Start/Stop and USB behavior remain bounded and responsive during sustained SD writes. Shutdown must finish/flush the file and manifest before main power is removed; hardware forced-off still needs recovery handling.
- Validate one-hour sustained recording plus Wi-Fi/upload load, card removal handling, mic connect/disconnect, clipping/noise and safe power-off before extending endurance targets. Allocate bounded DMA/queues rather than retaining an entire meeting in RAM.

## Release evidence needed

Before buying bare boards for hand assembly, require **reviewed CAD schematic, exact footprints, routed PCB, ERC, DRC, mechanical fit and fabricator-ready Gerbers/drill files**. This package supplies a design draft and component/pin plan; it is not evidence that those production steps are finished.

On the first populated board, measure 3V3 and its noise/ramp, USB input current, LiPo charging current/temperature, off-state leakage, I2C operation, ADC clock lock and channel identity. Record the same speech using each microphone separately, with Wi-Fi and speaker activity varied. Measure file duration, channel count, actual upload duration and transcription quality. The one-metre cable has no meaningful propagation delay, but input interference, ADC filters and processing latency must still be characterized.

## Primary references

- [Espressif ESP32-S3-WROOM-1 datasheet](https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf), exact module pads, variant and antenna/layout constraints.
- [ESP32-S3 schematic checklist](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/schematic-checklist.html), supply, reset and USB constraints.
- [ESP32-S3 I2S/TDM documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/i2s.html), two peripherals, master/slave and TDM slots.
- [TI TLV320ADC5140 datasheet](https://www.ti.com/lit/ds/symlink/tlv320adc5140.pdf), audio interface, clocking, analog/PDM inputs and supply requirements.
- [Infineon IM69D128S datasheet](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf), bottom acoustic port, timing and layout.
- [Omron B3U datasheet](https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3u.pdf), selected two-terminal switch.
