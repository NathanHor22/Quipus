# Quipus Rev A — controller, controls, timekeeping, storage and display

Revision A1, 29 September 2026. Engineering review draft, not a fabrication release. The accompanying `controller-circuit.json` is a pin-to-net design specification; it is not an EasyEDA project or a routed PCB. No firmware is changed by this work.

## Decisions

- U1 is **ESP32-S3-WROOM-1-N16R8**, with 16 MB quad flash and 8 MB octal PSRAM. Use this exact ordering code; substitutes need a fresh pin and voltage review.
- Two onboard PDM microphones use I2S0; external PDM input has a separate data line. I2S1 drives the speaker amplifier. Audio front end is defined separately.
- A **Waveshare SKU 15867 1.3inch LCD Module**, 240 × 240 ST7789, is mounted above the controller board and connected through a keyed cable. This is a 45 × 31 mm display-module PCB, not a bare display bonded onto the custom PCB. It is non-touch; LVGL handles the UI in firmware.
- Native 1-bit SDMMC and a Hirose DM3AT-SF-PEJM5 socket provide recording storage. The display uses **SPI2_HOST**; SPI1 is reserved for flash/cache and must not be assigned to the screen.
- Start/Enter connects directly to RTC-capable GPIO7 for standby wake. Stop/Back, Up and Down use a PCA9536 I2C expander. Power, BOOT and RESET remain independent hardware functions.
- RV-3028-C7 keeps calendar time while main system power is off, as long as the protected LiPo remains attached and usable. A separate backup cell is not included.

## Verified ESP32 module pin allocation

Numbers below are physical **module pads**, not bare SoC pins or development-board header positions. All signal levels are 3.3 V. Pin table checked against Espressif WROOM-1 datasheet v1.8, Table 3-1.

| Function / net | GPIO | Module pad | Direction / reset consideration |
| --- | ---: | ---: | --- |
| PDM_CLK | 4 | 4 | Clock output; audio sheet owns source damping |
| PDM_DIN0 | 5 | 5 | Two onboard microphones, complementary PDM clock edges |
| PDM_DIN1 | 6 | 6 | External short-wire PDM daughterboard input |
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
| I2C_SDA | 8 | 12 | Fuel gauge, RTC and button expander; pull-ups on power sheet |
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
| Spare, unconnected | 42 | 35 | Reserved for prototype changes |

U1 pads 1, 40 and 41 connect to GND; pad 2 connects to regulated 3V3. Place 10 µF plus 100 nF close to pad 2. The regulator must meet aggregate peak current, not merely the module's idle current.

Leave GPIO35/36/37 (pads 28/29/30) unconnected because this module uses them internally for octal PSRAM. GPIO3/45/46 (pads 15/26/16) are unused strap pins and must not acquire peripheral pull-ups. GPIO0 is the only intentionally exposed boot strap. No extra 40 MHz crystal is required; the module includes one.

Budget: 36 exposed GPIO − 3 PSRAM-reserved − 4 straps − 2 native USB = 27 available general GPIO. This design uses 26 and retains GPIO42. UART0 pads are occupied by the display; use native USB Serial/JTAG for ordinary service. Optional UART probing on LCD_DC is read-only, and the screen must remain deselected. Do not claim a separate unrestricted UART header.

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

The bus addresses are distinct: RTC 0x52, expander 0x41, fuel gauge 0x55. The power sheet owns one pair of 10 kΩ bus pull-ups to 3V3 plus off-state discharge resistors; do not populate a duplicate set here. Begin at 100 kHz and measure SCL/SDA rise time with the actual total capacitance. Do not enable 400 kHz simply because all chips list it as a maximum.

## Outstanding before fabrication

1. Cross-check every symbol and footprint against the exact package drawing, particularly module pad 41, USB switch RSE, microSD detector A/B and display J2 orientation.
2. Complete whole-board electrical rules and power-domain review, including powered-off I2C/USB behavior and discharge timing.
3. Reconcile the display's measured current, real SD write peaks and Wi-Fi current with the regulator's peak and thermal margins.
4. Confirm mechanical button heights, screen connector cable bend, SD ejection path, microphone acoustic openings and ESP antenna keepout.
5. Run a first-article test: native USB boot, all buttons, RTC continuity through power-off, microSD recoverability, full audio capture, Wi-Fi upload, charging and safe shutdown.

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
