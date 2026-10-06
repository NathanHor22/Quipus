# Quipus B1 audio circuit and microphone assembly

**Engineering review draft — do not fabricate this circuit yet.** This document accompanies `audio-circuit.json`; the generated schematic must be reviewed with exact footprints, ERC, board routing and bench measurements. The earlier EasyEDA Rev A project remains a different revision until explicitly updated.

## What changes on the PCB

Keep U20/U21, the two Infineon IM69D128SV01 digital microphones, at the front upper and lower acoustic openings. Keep the MAX98357A U22 and J5 differential speaker harness. Remove the short digital expansion J4 and obsolete R205/R206.

Add U23 TLV320ADC5140IRTWR, U24 SN74LVC1G17DBVR, a filtered ADC supply, all regulator/reference bypass capacitors, J8/J9 side-mounted 3.5 mm microphone sockets, and a separate analog power/input/protection network for each socket. New passive references start at 220. Passive sizes in this audio draft are 0805 where practical; hidden-pad chips and MEMS microphones remain factory-reflow parts.

| Function | Physical connection |
|---|---|
| MIC A (left socket J8) | U23 IN1P pin 6 and AC-grounded IN1M pin 7 |
| MIC B (right socket J9) | U23 IN2P pin 8 and AC-grounded IN2M pin 9 |
| Top/bottom built-in microphone DATA | R201/R202 100 ohm, then common PDM_DIN_PAIR to U23 pin 10 |
| Microphone clock | U23 pin 11 -> U24 input pin 2 -> U24 output pin 4 -> R203 33 ohm -> microphone CLOCK |
| ESP32 capture clock | GPIO4 AUD_BCLK -> R221 -> U23 pin 22 |
| ESP32 capture frame sync | GPIO5 AUD_FSYNC -> R222 -> U23 pin 23 |
| ESP32 capture samples | U23 pin 21 -> R223 -> GPIO6 AUD_SDOUT |
| ADC shutdown | GPIO42 ADC_SHDN_N -> U23 pin 14; R220 100k keeps low during reset |
| Control bus | U23 pin 17 I2C_SCL and pin 18 I2C_SDA; pins 15/16 GND select 7-bit address 0x4C |
| Playback | Existing I2S1 speaker interface and U22 retained |

The ESP32 is **TDM master RX**; the ADC is **TDM slave TX**. The ADC PLL derives its reference from BCLK. Making the ADC master instead would require an additional reference MCLK source; that source is not present in this draft.

Record four independent channels at 16 kHz. Four 32-bit slots require 128 BCLK periods per frame, so BCLK = **2.048 MHz**. PCM16 stored audio requires **128 kB/s**, or **7.68 MB/minute**; six recording hours are approximately **2.765 GB**, excluding metadata. Raw 32-bit DMA/storage is twice that. No firmware implementation is claimed by this electrical package.

## Analog microphone input

Each Quipus puck is a purchased PUI AOM-5024L-HD-R condenser capsule attached to a shielded cable and housed in a protective printed puck. The bias/load resistor lives on the main board, not inside the puck.

```text
U23 MICBIAS pin5, configured3.014V
  |
  +-- R230 2.2k -- J8 TIP / cable signal ---------------- capsule positive
  |                  |
  |                  +-- D220 TVS -- GND
  |                  |
  |                  +-- R231100ohm -- C2331uF -- U23 IN1P pin6
  |                                                   +-- C235100pF -- GND
  |
J8 SLEEVE / cable ground -------------------------------- capsule negative
  |
  +-- R232100ohm -- C2341uF ------------------------- U23 IN1M pin7
                                                       +-- C236100pF -- GND

J8 RING is NC.
J9 repeats this circuit with its own resistor/capacitors/TVS into IN2P/IN2M.
```

**Do not connect IN1M/IN2M directly to ground in this AC-coupled configuration.** Their ground reference passes through a coupling capacitor, permitting the ADC's internal common-mode voltage. This follows TI Figure 37.

At nominal 500 uA capsule current, a 2.2k resistor drops approximately 1.1V, leaving **1.914V at the capsule terminal** from a 3.014V source. The published 3V source is applied through the load resistor; it does not mean 3V must remain across the capsule. A shorted input draws approximately 1.37mA per branch, within the ADC's published 20mA MICBIAS capacity. Bias must nevertheless be measured during insertion, current changes and capture.

Use fixed 0dB initial gain and20kohm ADC input impedance. Set gain only after clipping/noise measurements. There is no separate microphone op-amp in this architecture: the ADC includes gain/conversion. This does not eliminate the need for careful analog layout.

The TPD1E10B06 provides a candidate socket TVS network. Its pulse clamp voltage exceeds the ADC's absolute maximum, so this circuit does **not** claim complete transient qualification. Verify ESD and hot-plug behaviour with the actual PCB, series network and test equipment before release.

## Verified socket wiring

The manufacturer part is **Same Sky SJ1-3533NG**. “SJ13533NG” is a distributor alias, not the correct manufacturer ordering string.

| Actual socket pin | Contact | Quipus connection |
|---|---|---|
| 1 | Sleeve | GND / accessory return |
| 2 | Tip | Analog audio plus low-voltage plug-in bias |
| 3 | Ring | No connection |

Manufacturer sheet2 was downloaded and visually checked. The part has **no insertion switch**: this draft cannot infer presence from an absent switch. A 3.5mm TRRS headset, line output or arbitrary branded mic is not automatically compatible. This is a specified mono Quipus accessory interface, not a headphone output.

The drawing gives a14mm body length and8.2mm body width, with12.5mm height. Copy the **exact 3-pin top-view land pattern** and drill requirements; do not import the adjacent 4/5-pin switched variants. CAD-footprint verification and a physical sample fit are still release gates.

## Supply and bypass rules

- AVDD pin1 receives filtered3.3V through FB220 BLM21PG221SN1D. This bead's rated220ohm is its impedance at100MHz, not its DC resistance; published maximum DCR is0.045ohm.
- IOVDD pin19 uses3.3V. AVDD and IOVDD must remain within3.0–3.6V for this configuration.
- AREG pin2 is an internal1.8V regulator output; DREG pin24 is an internal1.5V regulator output. Use10uF+100nF each. Never connect either output to3.3V.
- VREF pin3 uses2.2uF+100nF. Verify at least1uF effective capacitance at2.75V. Allow10ms reference quick charge in the firmware draft and verify measured settling.
- MICBIAS pin5 uses2.2uF+100nF and separate2.2k branch resistors.
- Put AVSS pin4, exposed pad25 and all ground returns on one continuous ground system. Partition placement/current paths; do not create a floating “analog ground” island.
- Route reference/bias capacitor ground directly to AVSS as TI recommends. Keep preamp inputs away from switching regulator, antenna, SD clocks and class-D speaker outputs.
- MIC_3V3 powers U20/U21 and U24. Each microphone has local1uF+100nF bypass. Published Infineon electrical-current characterization is chiefly1.8V; measure actual3.3V results.

## PDM clock and channel identity

U23 pin10/GPI3 is configured as PDMDIN2, carrying channels3/4. Pin11/GPO3 provides PDMCLK. U20 LR=GND drives its bit after the falling clock edge; U21 LR=VDD drives after the rising edge. Configure PDMDIN2_EDGE=1 so channel3 captures U20 at the following rising edge and channel4 captures U21 at the following falling edge. Confirm identity acoustically and with a logic analyser.

At3.072MHz, Infineon specifies clock rise/fall <=13ns; TI permits up to18ns at its PDM output. U24 is therefore a **candidate edge-restoring buffer**, not proof of timing closure. Measure loaded edges, duty cycle, propagation skew and data setup/hold. TI requires30ns PDM input setup. Worst short half-cycle at45%duty leaves only about16.5ns after microphone100ns data validity and ADC30ns setup, before buffer and trace effects. **Begin bring-up at1.536MHz PDM if necessary**, then verify3.072MHz operation before claiming the69dB(A) microphone profile.

Analog and digital paths have different decimation/group delays. Four shared-clock channels are synchronized in sample rate, but must still be calibrated before beamforming or phase-sensitive mixing.

## How to assemble the two external pucks

1. Buy **two** PUI capsules, two solderable3.5mm TRS plugs (or verified shielded preterminated leads), and two1m shielded flexible microphone cables. Assemble one accessory first.
2. With everything unpowered, use a meter to identify each TRS plug's tip/ring/sleeve continuity. Record the conductor colours; never infer colour from another cable.
3. **Hold point: obtain manufacturer-confirmed positive/negative pad identity for the actual PUI capsule.** The downloaded current mechanical drawing shows two pads but does not label them. Do not guess a left/right pad from a rotated photograph or assume case continuity proves polarity.
4. After polarity is confirmed, attach the signal conductor to positive and the return/shield to negative. Tip at the plug goes to signal; sleeve goes to return; ring remains unused. Install the connector sleeve/heat-shrink before soldering.
5. Follow PUI's soldering limits: <=2seconds per terminal, specified iron temperature360C +/-10C. Pre-tin the cable quickly and let the capsule cool between joints. Keep solder, flux and debris away from its acoustic holes.
6. Use a printed puck with acoustic opening/mesh, soft capsule support and separate cable clamp/strain relief. The cable must not pull on the capsule pads.
7. Test from a current-limited3V bench supply through2.2k **before** connecting to Quipus. Check current and signal with appropriate equipment. Do not connect an unverified puck to a battery-powered board.
8. Compare raw WAVs at0.5/1/2/3m and the furthest intended seat, with HVAC and Wi-Fi active. Count errors on the same test passage. Test cable bending and plug movement. Do not infer recording distance from published SNR.
9. Only after the first puck works, build the second and check independent channel identity/crosstalk.
10. Add a reel later as a mechanically isolated detachable accessory. A reel has no role in the initial PCB signal path.

## Beginner soldering scope

Use a hybrid assembly: factory/technician handles U23 WQFN, U22 TQFN, U20/U21 underside MEMS pads, U24 and fine-pitch power parts. The user can solder through-hole J8/J9, build the two wired pucks, and assemble precrimped speaker/battery/display harnesses after the power test. 0805 passives are a possible supervised learning step; small hidden-pad ICs are not a suitable first soldering exercise.

Do not order a bare production PCB expecting jumper wires to replace these missing audio circuits. First prove mixed capture on an ADC evaluation/breakout setup, finalize symbols/footprints and layout, then release manufacturing files.

## Verification before manufacturing

Confirm exact part availability and footprints; verify capsule polarity; check rail sequencing/bias/current; close loaded PDM timing; implement and test mixed4channel TDM; check input clipping/noise and speaker feedback; evaluate hot-plug/ESD; inspect acoustic ports and enclosure isolation; run native CAD ERC/DRC. These are release gates, not approval claims.

## Primary sources

- [TI TLV320ADC5140 datasheet](https://www.ti.com/lit/ds/symlink/tlv320adc5140.pdf): physical pins, mixed-input capability, input coupling, regulators, bias, pin multiplexing and timing.
- [TI analog microphone system application note](https://www.ti.com/lit/pdf/sbaa395): microphone capture design context. The earlier SBAA381 link concerns sample rates/processing, not this microphone circuit.
- [Infineon IM69D128S datasheet](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf): exact microphone pads, acoustic hole, startup and PDM timing.
- [TI SN74LVC1G17](https://www.ti.com/lit/gpn/sn74lvc1g17): DBV5 pin numbering and buffer electrical requirements.
- [Same Sky SJ1-353XNG drawing](https://www.sameskydevices.com/product/resource/sj1-353xng.pdf): verified socket terminal and mechanical drawing.
- [PUI AOM-5024L-HD-R](https://puiaudio.com/file/specs-AOM-5024L-HD-R.pdf): capsule parameters,3V/2.2k drive circuit and handling limits.
- [TI TPD1E10B06](https://www.ti.com/lit/ds/symlink/tpd1e10b06.pdf): TVS operating/clamping limits.
- [Murata BLM21PG221SN1D](https://www.murata.com/en-eu/api/pdfdownloadapi?cate=cgsubChipFerriBead&partno=BLM21PG221SN1D): supply filtering component.
