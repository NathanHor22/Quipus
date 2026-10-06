# Quipus Rev A — audio circuit review

Status: preliminary engineering design, 29 September 2026. This document defines the audio nets and constraints for schematic capture; it is not fabrication approval. GPIO assignments belong to the master pin-allocation sheet.

## Selected baseline and scope

Use two **IM69D128SV01XTMA1** digital PDM microphones and a **MAX98357AETE+** I2S speaker amplifier. The selected mic port is an internal, short-wire digital expansion connector, not a consumer USB or 3.5 mm microphone socket.

The earlier IM69D130 candidate is **not** the baseline: its manufacturer now marks it not for new designs. IM69D128S is active/preferred and better aligned with this recorder's power target. Its pinout and footprint are different; do not swap the schematic symbol or footprint by changing only the part number. [Manufacturer lifecycle status](https://www.infineon.com/part/IM69D130), [selected microphone](https://www.infineon.com/part/IM69D128S).

Rail names below are logical: `3V3` is the regulated 3.3 V rail after shutdown control; `SYS_SW` is the switched battery/power-path rail, about 3.0 V on a low loaded battery and 4.4 V nominal on USB, with the power-path USB upper specification of 4.5 V. Verify actual extrema during power and load transitions. Never connect microphone VDD to raw battery or USB 5 V.

## Schematic connections

### U20 and U21 — IM69D128SV01XTMA1

| Pin | U20 net | U21 net |
|---|---|---|
| 1 VDD | MIC_3V3 | MIC_3V3 |
| 2 CLOCK | PDM_CLK_LOCAL | PDM_CLK_LOCAL |
| 3 DATA | U20_D → R201 → PDM_DIN0 | U21_D → R202 → PDM_DIN0 |
| 4 LR | GND | MIC_3V3 |
| 5 GND | GND | GND |

`R201`, `R202`: 100 Ω, 1%, 0603, directly at each microphone output. `R203`: 33 Ω, 1%, 0603, ESP32 `PDM_CLK` → `PDM_CLK_LOCAL`, near the ESP32. Its value is an engineering starting point for signal-integrity measurement, not a manufacturer mandate. `R204`: 0 Ω, 0603, `3V3` → `MIC_3V3`, allowing rail-current measurement. Place a 1 µF X7R ≥6.3 V capacitor at each microphone VDD; provide an additional 100 nF in parallel at each position. A 4.7 µF X7R ≥6.3 V local reservoir is also allocated.

Datasheet boundary conditions: 1.62–3.6 V supply; 1.2–3.3 MHz normal PDM clock; 100 pF maximum DATA loading; 13 ns maximum clock rise/fall; 45–55% duty cycle. LR low drives after the falling edge, LR high after the rising edge. The package is PG-TLGA-5-2, approximately 3.5 × 2.65 × 1.0 mm, with a bottom sound port. Use the manufacturer's land/stencil geometry and a **0.6 mm PCB acoustic hole**. The datasheet's electrical table requires 1 µF bypass, while its stereo example says 100 nF; the proposed parallel pair satisfies both. [Infineon datasheet, tables 3, 6, 7 and footprint drawing](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf).

Give the acoustic hole no copper barrel: it is a sound opening, not an electrical via. Mount microphones on the reverse of the user-facing PCB surface so their bottom ports hear through the board toward the front/top case openings. Align short gasket ducts to the case and leave the holes unobstructed. Keep battery, adhesive, conformal coating, flux and speaker pressure cavities away from these openings. Final footprint, paste apertures, mask and housing ducts need assembly review.

### J4 — keyed digital microphone connection

Proposed part: JST **SM04B-SRSS-TB**, mating **SHR-04V-S** housing and **SSH-003T-P0.2-H** contacts. This is a 1 mm-pitch internal connector. It intentionally differs from the battery connector. [JST SH family and drawings](https://www.jst.com/products/crimp-style-connectors-wire-to-board-type/sh-connector).

| Pin | Board net | Required accessory connection |
|---|---|---|
| 1 | MIC_3V3 | Mic VDD with local bypass |
| 2 | GND | Mic GND and LR low |
| 3 | PDM_CLK_EXT | Mic CLOCK |
| 4 | PDM_DIN1 | Mic DATA through 100 Ω at accessory |

`R205`: 33 Ω from ESP32 `PDM_CLK` to `PDM_CLK_EXT`, placed at the source. `R206`: 100 kΩ from `PDM_DIN1` to GND to define an unplugged input. Accessory uses the same IM69D128S circuit, including 1 µF + 100 nF bypass. Separate DATA1 leaves the two onboard microphones running together with one external microphone. The accessory's LR state is fixed locally and need not consume a fifth wire.

Keep the initial cable **≤50 mm** and route a ground alongside the clock. This is a prototype wiring target, not a guaranteed PDM cable-length specification. Validate rise/fall times, ringing, data loading and capture at the far end. This connector is internal and not hot-plug rated by this design; if user-accessible, add and verify low-capacitance ESD protection and power limiting before release. Label `3V3 / GND / CLK / DATA` and the pin-1 triangle on both boards; generic JST cable colours do not establish pin order.

### U22 — MAX98357AETE+ TQFN

| Pin(s) | Connection |
|---|---|
| 1 DIN | ESP32 I2S1 `I2S1_DOUT` through R207 33 Ω |
| 2 GAIN_SLOT | R208 100 kΩ, 1%, to SYS_SW |
| 3, 11, 15 GND; exposed pad | Solid GND plane |
| 4 SD_MODE | ESP32 `AMP_ENABLE`; R209 100 kΩ to GND |
| 5, 6, 12, 13 | No connection; explicit schematic NC markers |
| 7, 8 VDD | SYS_SW |
| 9 OUTP | J5 pin 1 / SPK_P |
| 10 OUTN | J5 pin 2 / SPK_N |
| 14 LRCLK | ESP32 I2S1 `I2S1_WS` through R210 33 Ω |
| 16 BCLK | ESP32 I2S1 `I2S1_BCLK` through R211 33 Ω |

At VDD place **10 µF + 100 nF**, X7R, 10 V, with short return loops. Reserve another 47 µF 10 V bulk footprint, initially DNP, if power-path testing reveals dips. Use package T1633+4 / TQFN16, 3 × 3 mm; exposed pad to ground with thermal vias. Audit the land pattern against package drawing 21-0136 and land pattern 90-0031. Use the **A** I2S version, not the B left-justified version.

The amplifier accepts 2.5–5.5 V. SD_MODE high selects left-channel playback, low shuts it down; 3.3 V logic is compatible. The 100 kΩ gain resistor selects **3 dB**. Both speaker terminals are driven outputs: **neither is ground**, and neither may connect to a grounded headphone jack. No MCLK is required. [Analog Devices datasheet, pin table, gain table and application circuit](https://www.analog.com/media/en/technical-documentation/data-sheets/max98357a-max98357b.pdf).

`J5`: JST **SM02B-SRSS-TB** with matching **SHR-02V-S** housing. Use a short twisted pair to an **8 Ω, 2 W nominal dynamic speaker**. Exact acoustic driver and enclosure are not yet selected. Existing speaker may only be reused after its impedance and power rating are confirmed. An 8 Ω, 1 W driver is conditional on validated level limiting; do not substitute 4 Ω without reviewing thermal/current budgets.

Speaker-wire and power trace geometry, speaker inductance, and EMI must be tested. Allocate unpopulated filter footprints if board area permits; populate filters from measured emissions rather than inventing an unverified LC network. Keep output pair away from microphones, clock lines, RF antenna and connector signal returns.

## Clocking and firmware contract

Use **I2S0 in PDM RX mode** for the microphones and **I2S1 in standard I2S TX mode** for playback. ESP32-S3's PDM-to-PCM converter is on I2S0; multiple PDM data lines can supply the external channel. Explicitly configure and bench-test line/slot mapping rather than assuming the SDK's interleaved ordering. [Espressif I2S guide](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/i2s.html).

For the selected IM69D128S baseline, start at **16 kHz PCM with 128× PDM decimation**, so PDM clock = **2.048 MHz**, within the mic's normal-mode band. Do not accidentally use 64× at 16 kHz: **1.024 MHz** is above its 1.020 MHz low-power band and below its 1.2 MHz normal band. A high-fidelity characterization mode may instead use 48 kHz PCM and 64× = **3.072 MHz**. Store those samples at 48 kHz, or apply a real anti-alias lowpass before 3:1 downsampling.

This clock configuration is an arithmetic compatibility check, not a completed firmware demonstration. Verify the exact ESP-IDF version's multi-DIN API, generated clocks, channel alignment and SD throughput before PCB release. The current single-mic firmware will need an explicit new board profile.

Preserve each microphone's channel until the processing strategy is measured; indiscriminate summing can cancel speech. Two mics do not correspond to two people. They provide synchronized room signals for later processing; no guaranteed 3–5 m range or diarization accuracy follows from the hardware alone.

Hold `AMP_ENABLE` low during recording unless echo-cancellation is explicitly active. Playback should use left I2S samples, start muted, ramp up, ramp down, then pull `AMP_ENABLE` low. Stop the PDM clock at logic low between sessions. On restart discard at least 50 ms before declaring capture ready; determine the final settling window from tests. Sleep firmware must maintain known GPIO levels so unpowered blocks cannot be back-powered through clocks/data.

## Power estimates and volume limit

For microphone budgeting reserve **1 mA per microphone at 3.3 V** (3 mA with expansion). This is a provisional allocation, not a specified maximum. The published current tables characterize 1.8 V and differ from our 3.3 V design; measure at the selected clock and supply. Digital pin charging currents add to the microphone's own current.

With 3 dB amplifier gain, the datasheet's output equation gives, for a full-scale sine:

`V_RMS = 10^((2.1 + 3)/20) = 1.80 V`

`P_sine = V_RMS² / 8 = 0.40 W` (nominal, before clipping).

A full-amplitude square waveform can approach twice that heating: about 0.81 W at nominal impedance. Gain tolerance, impedance variation, equalization and clipping prevent this calculation from being a speaker-protection guarantee. Start firmware at a **−6 dBFS maximum signal ceiling**, disable aggressive bass boost, and validate the final permitted volume thermally and acoustically. The 2 W speaker rating is headroom, not a promise of 2 W output.

At an illustrative 0.4 W output and assumed 85% efficiency, `I ≈ 0.4/(3.3×0.85) = 143 mA`, plus overhead. Allocate **0.5 A transient capacity** to the SYS_SW speaker branch for initial design checks. Do not use the amp's short-circuit current limit as its normal operating current. Measure output using a differential probe or differential audio analyser; a grounded oscilloscope clip on SPK_N would short a driven output.

## Release gates

1. Confirm exact speaker and expansion accessory dimensions.
2. Verify every CAD pin and mechanical land pattern independently, including top/bottom orientation.
3. Check 3.3 V overshoot remains below the microphone's 3.6 V limit under hot-plug and shutdown events.
4. Measure PDM signal integrity, channel separation, dropout counts and audio level with two onboard plus one external mic.
5. Record an uninterrupted six-hour test to SD and measure energy at battery terminals.
6. Check amplifier thermal behaviour at highest USB-powered SYS voltage and lowest operating battery voltage.
7. Verify no missing samples during display updates, SD writes or network activity.

These are prototype verification tasks, not claims already tested on hardware.


