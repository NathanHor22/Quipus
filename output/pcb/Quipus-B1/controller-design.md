# Quipus Rev B — controller, controls, timekeeping, storage and display

Revision B1, 2 October 2026. Engineering review draft, not a fabrication release. The accompanying `controller-circuit.json` is a pin-to-net design specification; it is not an EasyEDA project or a routed PCB. No firmware is changed by this work.

## Decisions

- U1 is **ESP32-S3-WROOM-1-N16R8**, with 16 MB quad flash and 8 MB octal PSRAM. Use this exact ordering code; substitutes need a fresh pin and voltage review.
- Two onboard PDM microphones and two external analog microphone inputs feed U23 TLV320ADC5140. It sends four separately identified channels over one TDM stream into I2S0; I2S1 still drives the speaker amplifier. The old external PDM header is removed. Audio front end is defined separately.
- A **Waveshare SKU 15867 1.3inch LCD Module**, 240 × 240 ST7789, is mounted above the controller board and connected through a keyed cable. This is a 45 × 31 mm display-module PCB, not a bare display bonded onto the custom PCB. It is non-touch; LVGL handles the UI in firmware.
- Native 1-bit SDMMC and a Hirose DM3AT-SF-PEJM5 socket provide recording storage. The display uses **SPI2_HOST**; SPI1 is reserved for flash/cache and must not be assigned to the screen.
- Start/Enter connects directly to RTC-capable GPIO7 for standby wake. Stop/Back, Up and Down use a PCA9536 I2C expander. Power, BOOT and RESET remain independent hardware functions.
- RV-3028-C7 keeps calendar time while main system power is off, as long as the protected LiPo remains attached and usable. A separate backup cell is not included.

## Verified ESP32 module pin allocation

Numbers below are physical **module pads**, not bare SoC pins or development-board header positions. All signal levels are 3.3 V. Pin table checked against Espressif WROOM-1 datasheet v1.8, Table 3-1.

| Function / net | GPIO | Module pad | Direction / reset consideration |
| --- | ---: | ---: | --- |
| AUD_BCLK | 4 | 4 | I2S0 master output: 2.048 MHz at 16 kHz / four 32-bit slots |
| AUD_FSYNC | 5 | 5 | I2S0 master frame output: 16 kHz |
| AUD_SDOUT | 6 | 6 | Input: U23 ADC digital TDM output; ESP32 capture DIN |
| I2S1_BCLK | 14 | 22 | Speaker bit clock |
| I2S1_WS | 15 | 8 | Speaker frame clock |
| I2S1_DOUT | 16 | 9 | Speaker audio output |
| AMP_ENABLE | 17 | 10 | Audio sheet must hold amplifier disabled at reset |
| LCD_CS_N | 10 | 18 | 10 kΩ pull-up; deselect display during boot |
| LCD_MOSI_MCU | 11 | 19 | Through 33 Ω to LCD_MOSI |
| LCD_SCLK_MCU | 12 | 20 | Through 33 Ω to LCD_SCLK |
| LCD_BL | 13 | 21 | Backlight control only; module has its own transistor |
| LCD_DC | 43 | 37 | Also ROM UART0 TX; safe only because CS is pulled high |
| LCD_RST_N | 44 | 36 | 10 kΩ pull-up; firmware performs reset pulse |
| SD_CLK_MCU | 38 | 31 | Through 22 Ω to card CLK |
| SD_CMD | 39 | 32 | Bidirectional, 10 kΩ pull-up |
| SD_D0 | 40 | 33 | Bidirectional, 10 kΩ pull-up |
| SD_CD_N | 41 | 34 | Detect switch to ground; 100 kΩ pull-up |
| I2C_SDA | 8 | 12 | Fuel gauge, RTC, button expander and audio ADC; pull-ups on power sheet |
| I2C_SCL | 9 | 17 | Start at 100 kHz; validate bus rise time |
| PWR_INT_N | 18 | 11 | LTC2951 shutdown request input |
| POWER_HOLD | 21 | 23 | Open-drain; LOW only after file flush; pull-up on power sheet |
| CHARGING_N | 47 | 24 | Charger open-drain status; pull-up on power sheet |
| USB_PGOOD_N | 48 | 25 | Charger input-valid status; not itself charging current |
| USB_ENUM_500 | 1 | 39 | Active-high authorization after USB enumeration; default low |
| USB_SUSPEND | 2 | 38 | Active-high suspend signal; default low, per power design |
| ESP_USB_DM | 19 | 13 | Native USB D− after isolation and series resistor |
| ESP_USB_DP | 20 | 14 | Native USB D+ after isolation and series resistor |
| BOOT_N | 0 | 27 | 10 kΩ pull-up, service switch to ground |
| ESP_EN | EN | 3 | 10 kΩ / 1 µF RC, service RESET switch to ground |
| BTN_START_N | 7 | 7 | Direct active-low Start/Enter and RTC-domain wake input |
| ADC_SHDN_N | 42 | 35 | Output: U23 hardware shutdown; pull-down belongs to audio sheet |

U1 pads 1, 40 and 41 connect to GND; pad 2 connects to regulated 3V3. Place 10 µF plus 100 nF close to pad 2. The regulator must meet aggregate peak current, not merely the module's idle current.

Leave GPIO35/36/37 (pads 28/29/30) unconnected because this module uses them internally for octal PSRAM. GPIO3/45/46 (pads 15/26/16) are unused strap pins and must not acquire peripheral pull-ups. GPIO0 is the only intentionally exposed boot strap. No extra 40 MHz crystal is required; the module includes one.

Budget: 36 exposed GPIO − 3 PSRAM-reserved − 4 straps − 2 native USB = 27 available general GPIO. Rev B uses all 27; GPIO42 is now ADC_SHDN_N. There is no spare general GPIO. UART0 pads are occupied by the display; use native USB Serial/JTAG for ordinary service. Optional UART probing on LCD_DC is read-only, and the screen must remain deselected. Do not claim a separate unrestricted UART header.

## Four-channel capture and storage contract

The ESP32 supplies BCLK and FSYNC as I2S0 **master RX**. The ADC is an audio-interface slave, deriving its internal clock from BCLK through its PLL. This choice avoids needing a separate ADC MCLK pin or external oscillator. Keep ADC_SHDN_N low at reset; configure the ADC over I2C, establish the clocks, then start recording only after clock/channel configuration is valid. Initialization order must follow the ADC datasheet rather than the sequence being inferred from this summary.

Proposed transport: 16,000 frames/s x four slots x 32 bits/slot = **2.048 MHz BCLK**. Receive all four slots; do not configure ordinary two-channel stereo I2S and assume the extra microphones are captured. TDM frame shape, shift, sampling edge and channel offsets must be matched between the ESP32 driver and ADC registers. ESP32-S3 supports four 32-bit TDM slots; a native I2S driver is used, with DMA buffers in suitable internal memory and a bounded storage queue. The pin reassignment needs new custom-board firmware; this document does not make the firmware for an existing development board compatible.

The raw four-slot DMA payload is 256,000 bytes/s. Converting aligned 32-bit containers to four-channel 16-bit PCM gives **128,000 bytes/s, 7.68 MB/minute or 460.8 MB/hour**, before the small WAV/header/manifest overhead. Six hours is 2.7648 GB in decimal units. Preserve the four channels in the original stored file with a fixed channel map; channel selection or mixing is a derivative. Do not blindly add the microphones together, discard channels or truncate the WAV. Supporting four-channel archival and transcription ingestion also requires a firmware/backend format change; routing the PCB alone does not provide it.

Keep speaker playback on I2S1 and disable or mark playback intervals during meeting capture until acoustic feedback has been measured. A one-metre analog extension introduces no practically significant transport delay; analog input filters, ADC conversion and storage/upload/AI processing determine the noticeable delay. These are design goals requiring measurement, not latency guarantees.

Primary support: [ESP32-S3 I2S/TDM driver documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/i2s.html), and [TI TLV320ADC5140 datasheet, clock generation and audio interface](https://www.ti.com/lit/ds/symlink/tlv320adc5140.pdf).

## USB and reset

USB connector D+/D− nets enter a TPD2EUSB30DRTR clamp array immediately beside the connector, then TS3USB221ARSER, then 22 Ω series resistors close to the ESP32. U35 uses TI's DRT three-terminal package with a 1.0 × 0.8 mm body and 0.50 mm maximum height; the three nominal copper lands are 0.30 × 0.30 mm. Keep the pair short over continuous ground with differential impedance designed using the fabricator's stackup. DNP shunt-capacitor pads are for measured tuning only. [TI TPD2EUSB30 datasheet and DRT drawing](https://www.ti.com/lit/ds/symlink/tpd2eusb30.pdf).

The TS3USB221A is powered from switched 3V3, S and /OE tied low. Its first port connects to the ESP; its common port connects to the USB connector; unused second-port lines have 49.9 Ω terminations to ground. TI specifies power-off leakage when VCC=0. This stops the live USB data connector from being directly wired to a powered-off ESP while the charging circuit remains available. It is not galvanic isolation. Its 30 µA maximum supply contribution belongs in the power budget. Validate powered-off leakage and USB signal quality on the assembled prototype.

GPIO19 is D− and GPIO20 is D+. Do not add external device attach pull-ups: the ESP USB peripheral controls them. The charger sheet owns CC resistors, VBUS protection and current-selection rules. Firmware must only assert USB_ENUM_500 when the USB host has allowed the corresponding configuration; merely detecting 5 V does not authorize that current. Native USB Serial/JTAG operation needs a firmware path that exposes the required bus state; otherwise retain the conservative input limit. This integration is a release test, not assumed complete from a schematic.

EN RC is 10 kΩ to 3V3 and 1 µF to GND, with RESET shorting EN to GND. Nominal RC is 10 ms. Espressif recommends checking this against actual supply ramp; add a reset supervisor if the brownout/ramp test fails. BOOT_N is 10 kΩ to 3V3 with a separate normally-open switch to GND and no capacitor. Holding BOOT while releasing RESET must enter native USB download mode. Do not burn boot/security eFuses during prototype bring-up.

## Display connector: a reversal that matters

Quipus J7 is an 8-way JST PH connector whose numbering follows **the display module's J2**, not its J1 header:

| Quipus J7 pad | Signal | Module J2 pad | Module J1 header pad |
| ---: | --- | ---: | ---: |
| 1 | BL | 1 | 8 |
| 2 | RST | 2 | 7 |
| 3 | DC | 3 | 6 |
| 4 | CS | 4 | 5 |
| 5 | CLK | 5 | 4 |
| 6 | DIN | 6 | 3 |
| 7 | GND | 7 | 2 |
| 8 | VCC = 3V3 | 8 | 1 |

This was checked directly in the official Waveshare schematic. Before first power, continuity-check both ends of the assembled cable against named signals; generic PH cables may reverse numbering. JST PH is 2.0 mm pitch, not 2.54 mm.

The module accepts 3.3 V supply and logic. Its BL input drives an onboard NPN through 1 kΩ; the LED current is not carried by the ESP pin. The module also biases that transistor, so a default-dark boot is not guaranteed before firmware drives BL low. Initialize BL low immediately, then enable PWM after display initialization. The entire screen loses supply when main power is shut down. Active backlight current remains a measured power-budget item.

Initialize SPI2 with Mode 0, MSB first and a conservative 10 MHz clock for the short cable; increase only after a signal-integrity test. LVGL can use partial line buffers: two 240 × 20 × 2-byte buffers use 19,200 bytes, compared with 115,200 bytes for a single full RGB565 frame. These are planned firmware settings, not implemented changes.

## SD socket

Hirose DM3AT-SF-PEJM5 contacts: 1 DAT2; 2 CD/DAT3; 3 CMD; 4 VDD; 5 CLK; 6 VSS; 7 DAT0; 8 DAT1. One-bit SDMMC uses CMD/CLK/DAT0. Install five separate 10 kΩ pull-ups from CMD and DAT0–DAT3 to 3V3, including the three data lines not connected to the ESP. Never confuse contact 2 CD/DAT3 with the physical card-insertion detector.

The manufacturer calls the detector terminals **A and B**. Connect A to SD_CD_N and B to GND; the switch closes on insertion. CAD library pad labels must be mapped to the manufacturer's A/B locations. Connect shell stakes to GND without inadvertently grounding detector A. Reserve socket no-copper areas and full push/ejection travel in the enclosure.

Provide local 10 µF and 100 nF at the socket. Start at 400 kHz, validate sustained recording and background I/O at 20 MHz in one-bit mode, and only then consider 40 MHz. The card is supplied with the main 3V3 rail, so stopping power requires completing WAV/manifest writes and unmounting before POWER_HOLD goes low. A hardware power-cut override can still interrupt a write; the recording format and boot recovery must handle this explicitly.

## Offline timekeeping

U30 RV-3028-C7 uses VDD=3V3, VBACKUP=BAT_P through 330 Ω, and 100 nF bypass on each supply. Its backup input accepts the protected single LiPo range; it must never connect to an unprotected cell contact. Pin 8 EVI has 10 kΩ to GND; pin 1 CLKOUT and pin 2 /INT are unconnected. Pin 3 SCL and pin 4 SDA share the switched I2C bus. Address is 0x52.

Factory firmware must select **LSM backup mode (BSM=11), disable the trickle charger (TCE=0), disable CLKOUT, and persist the configuration to EEPROM**. The default shipped configuration has backup switching disabled. LSM is necessary because a fully charged LiPo can exceed the main 3.3 V supply; direct switching mode would unnecessarily switch to backup during ordinary operation. I2C is high impedance on backup, and all bus pull-ups are on main 3V3; there is no pull-up from the LiPo into ESP pins.

Time survives a main power-button shutdown while BAT_P remains present. If the battery is disconnected or its protection removes power, the RTC may lose time; check the RTC validity/POR status and use unsynchronized timestamps until network time is obtained. Keep UUID/sequence identifiers independent of wall-clock validity. This design does not need an independent coin cell for normal daily power-off operation.

## Buttons and shared I2C

U31 is PCA9536DR, SOIC-8: P0 pin 1 unused, P1 pin 2 Stop/Back, P2 pin 3 Up, GND pin 4, P3 pin 5 Down, SCL pin 6, SDA pin 7, VCC pin 8. Address 0x41; all ports default to inputs but firmware explicitly sets configuration 0x03 to 0x0F. Leave P0 unconnected with its internal weak pull-up and mask its read value. Start/Enter instead connects directly to **ESP GPIO7, physical module pad 7**, through net BTN_START_N. All four buttons are active-low contacts to GND, with 47 kΩ external pull-ups and 10 nF filters. Buttons are Omron B3U-1000P, the two-terminal top-actuated version; do not substitute the three-terminal grounded variant without adapting the footprint.

Poll the three expander buttons approximately every 10 ms while the user interface is active and debounce for 20 ms. There is no expander interrupt output. During standby, stop I2C button polling and configure GPIO7/RTC_GPIO7 as an active-low external wake source. Its external pull-up remains effective in deep sleep. Wait for release before entering sleep so a held button cannot cause an immediate wake loop. Start wakes the device from deep sleep; Stop/Up/Down do not. The independent LTC2951 power button remains the control when main power is fully off. Before sleep, close files, shut down the amplifier and backlight, stop microphone clocks and put peripherals into appropriate idle states; the SD/display standby currents still require measurement. A wake-capable button by itself does not establish a multi-day battery-life claim.

The bus addresses are distinct: RTC 0x52, expander 0x41, fuel gauge 0x55 and audio ADC 0x4C (ADD0/ADD1 grounded on the audio sheet). The power sheet owns one pair of 10 kΩ bus pull-ups to 3V3 plus off-state discharge resistors; do not populate a duplicate set here. Begin at 100 kHz and measure SCL/SDA rise time with the actual total capacitance. Do not enable 400 kHz simply because all chips list it as a maximum.

### Front controls and beginner assembly

Front upper row: **Power, Start/Enter, Stop/Back**. Front lower row: **Volume down, Volume up**. BOOT and RESET are recessed service controls reachable through the enclosure, not ordinary meeting controls. Power is the existing separate power-sheet switch; Start/Stop/Up/Down plus BOOT/RESET are controller switches SW300-SW305.

Retain the verified two-terminal Omron B3U-1000P footprints in this draft. A common four-legged through-hole switch is not a drop-in replacement: two pairs of legs may already be internally connected, so the wrong mapping can permanently short a button input. No unverified B3F replacement has been inserted. For an easier hand-soldered prototype, use normally-open offboard buttons on short two-wire harnesses connected to the same input/GND nets; add keyed harness connectors and adjust the enclosure in final CAD. That option is a proposed CAD change, not a connector already present in controller-circuit.json. Test continuity while released and pressed before connecting any switch. The power-button harness must only reach the power sheet's button nets, not battery supply or the GPIO inputs.

The retained B3U switches are small SMD parts. The ESP32 underside ground pad, USB switch and ESD array, RTC and audio/power IC packages require reflow or advanced equipment; learning to solder does not make these hidden pads accessible to an ordinary iron. Factory assembly of the difficult core plus user assembly of through-hole connectors, wiring and peripherals is the recommended first route.

## Outstanding before fabrication

1. Cross-check every symbol and footprint against the exact package drawing, particularly module pad 41, USB switch RSE, microSD detector A/B and display J2 orientation.
2. Complete whole-board electrical rules and power-domain review, including powered-off I2C/USB behavior and discharge timing.
3. Reconcile the display's measured current, real SD write peaks and Wi-Fi current with the regulator's peak and thermal margins.
4. Confirm mechanical button heights, screen connector cable bend, SD ejection path, microphone acoustic openings and ESP antenna keepout.
5. Run a first-article test: native USB boot, all buttons, RTC continuity through power-off, microSD recoverability, four independently captured microphone channels, full WAV recording, Wi-Fi upload, charging and safe shutdown.

No claim of proven field battery life, validated charging behavior or fabrication readiness follows from this draft alone.

## Primary references

- [Espressif WROOM-1 datasheet v1.8](https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf), module pads and ordering variants.
- [ESP32-S3 schematic checklist](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/schematic-checklist.html), EN RC, native USB series resistors and strap constraints.
- [ESP-IDF 5.2.3 S3 SD pull-up requirements](https://docs.espressif.com/projects/esp-idf/en/v5.2.3/esp32s3/api-reference/peripherals/sd_pullup_requirements.html).
- [Hirose DM3AT-SF-PEJM5 drawing](https://www.hirose.com/product/download/?distributor=chip1&lang=en&num=DM3AT-SF-PEJM5&type=2d), card contact and A/B detector geometry.
- [Waveshare display schematic](https://files.waveshare.com/upload/0/0c/1.3inch_LCD_Module_Schematic.pdf) and [product documentation](https://docs.waveshare.net/1.3inch_LCD_Module/), module J1/J2 and backlight driver.
- [RV-3028-C7 application manual](https://www.microcrystal.com/fileadmin/Media/Products/RTC/App.Manual/RV-3028-C7_App-Manual.pdf), pinout and backup states.
- [TI PCA9536 datasheet](https://www.ti.com/lit/ds/symlink/pca9536.pdf), expander pinout, input defaults and address.
- [TI TS3USB221A datasheet](https://www.ti.com/lit/ds/symlink/ts3usb221a.pdf), pinout, truth table and Ioff behavior.
- [TI TPD2EUSB30 datasheet](https://www.ti.com/lit/ds/symlink/tpd2eusb30.pdf), clamp pin numbering.
- [Omron B3U datasheet](https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3u.pdf), two-terminal button drawing.
