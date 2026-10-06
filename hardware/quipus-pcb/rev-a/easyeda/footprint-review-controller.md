# Quipus A1 controller footprint review

Review date: 1 October 2026. Status: engineering review; not fabrication release.

`footprints-controller.json` maps all 54 controller circuit references to actual physical KiCad footprint files under `.tools/quipus-footprints/controller/`. Every schematic pin has a corresponding numbered physical pad. The files include copper lands, solder mask and paste layers, component outlines, courtyard geometry and applicable keepouts. No native EasyEDA import or PCB design-rule check has been performed by this footprint review.

| References | Selected physical footprint | Dimensions and mapping |
| --- | --- | --- |
| U1 | ESP32-S3-WROOM-1 | 18 × 25.5 mm module; pins 1–41 match the module. Preserve all twelve plated through-hole pad-41 vias, each with a 0.20 mm drill, plus the central SMD pad 41. All thirteen pad-41 instances are GND; this footprint has no NPTH holes. |
| U30 | MicroCrystal C7 SON-8 | Body 1.5 × 3.2 × 0.8 mm; 0.9 mm side pitch; pins 1–8 match the circuit. This footprint orientation is rotated relative to the circuit's written 3.2 × 1.5 dimensions. |
| U31 | SOIC-8 3.9 × 4.9 mm, P1.27 | TI D package; pins 1–8 match PCA9536DR. |
| U34 | TI RSE UQFN-10 1.5 × 2 mm | Ten pads, 0.5 mm pitch. Pins 1–10 match the TS3USB221A top-view pin table. No thermal-pad substitution. |
| U35 | TI DRT-3 | 1.0 × 0.8 mm body, 0.50 mm maximum height; pins 1 D+, 2 D−, 3 GND. Three 0.30 × 0.30 mm nominal copper lands; confirm the purchased package revision and assembler stencil before release. |
| J6 | Quipus Hirose DM3AT-SF-PEJM5 AB | Actual 13.85 × 15.95 mm socket, 1.68 mm high. Eight card contacts, two separate detector terminals and four shell solder lands. Preserve copper keepouts and ejection envelope. |
| J7 | JST PH B8B-PH-K 1×08 P2.0 vertical | Eight through-hole pads, 0.75 mm drills; square pin 1. Display module is off-board. |
| SW300–SW305 | Quipus Omron B3U-1000P | 3 × 2.5 mm body, 1.2 mm nominal height. Two 0.8 × 1.7 mm lands centered at x = ±1.7 mm; no ground lug or locating boss. |
| R300–R342 present in circuit | R0603 metric1608 | 1.6 × 0.8 mm body; pads 1 and 2 identity mapping. 1%, 0.1 W circuit selection. |
| C300–C340 present in circuit | C0603 metric1608 | 1.6 × 0.8 mm body; pads 1 and 2 identity mapping. 10 V minimum circuit selection. C303/C304 remain DNP. |

## Two reviewed footprint variants

The upstream KiCad microSD footprint uses numeric detector names 9 and 10. The Quipus circuit deliberately uses the manufacturer's A/B names. `Quipus_Hirose_DM3AT-SF-PEJM5_AB.kicad_mod` keeps the upstream geometry and renames rear pad 9 to B, at (−5.875, −7.725) mm, and side pad 10 to A, at (−6.825, +2.775) mm. All four shell lands retain `SH`. A is the active-low card detector and B is grounded in the circuit. These are a nonpolar dry switch, so exchanging A/B has no functional effect; confusing a detector terminal with a shell stake does. Confirm the purchased part drawing and detector continuity before fabrication release. The part is push-push even though the upstream footprint description currently says push-pull.

The upstream KiCad B3U-1000P numbers the left land 1. Omron's nominal terminal diagram numbers the right terminal 1. `Quipus_Omron_B3U-1000P.kicad_mod` therefore swaps the pad labels and uses the nominal manufacturer's 0.8 × 1.7 mm lands. The switch itself is symmetric and normally open; the correction is for traceable physical naming. The nominal land pattern has a 4.2 mm outside span and a 2.6 mm inside gap.

## PCB placement requirements

- Place the ESP antenna at the edge and retain Espressif's antenna keepout across every copper layer. Do not place a display, battery, speaker magnet or case fastener within its clearance area. An imported footprint's F.Cu-only keepout is insufficient by itself.
- Place U35 immediately behind the USB-C connector with a short ground-plane return. Route the differential pair through its lands without a long protection stub. Place U34 and its decoupling capacitor next, and keep the USB pair continuously referenced to ground.
- Preserve the Hirose socket's internal no-trace regions and allow its full card push-in and ejection travel outside the case.
- Verify the J7 harness by signal continuity against Waveshare module J2. Module J1 has the reverse contact order; cable colour or connector orientation is insufficient evidence.
- Place the RTC backup decoupling close to U30 and keep backup traces away from speaker switching outputs and the converter switch node.
- Check 10 µF 0603 capacitor DC-bias curves at 3.3 V. The provided footprint does not prove the effective capacitance needed for ESP/SD transients.
- Resistor/capacitor body heights in the JSON are provisional visual envelopes. Their exact manufacturer part numbers and actual heights must be frozen with the purchase BOM.
- The physical case actuators still need tolerance and travel checks against the small Omron switches.

## Sources

Geometry comes from the [official KiCad footprint library](https://gitlab.com/kicad/libraries/kicad-footprints), with per-part raw-file URLs and SHA-256 hashes recorded in the JSON. Manufacturer verification sources are:

- [Espressif ESP32-S3-WROOM-1 datasheet](https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf).
- [Micro Crystal RV-3028-C7 application manual](https://www.microcrystal.com/fileadmin/Media/Products/RTC/App.Manual/RV-3028-C7_App-Manual.pdf).
- [TI PCA9536 datasheet](https://www.ti.com/lit/ds/symlink/pca9536.pdf).
- [TI TS3USB221A datasheet and RSE package drawing](https://www.ti.com/lit/ds/symlink/ts3usb221a.pdf).
- [TI TPD2EUSB30 datasheet and DRT package drawing](https://www.ti.com/lit/ds/symlink/tpd2eusb30.pdf).
- [Hirose DM3 catalog, including DM3AT pad pattern](https://www.hirose.com/product/download/?distributor=mouser&lang=en&num=DM3AT-SF-PEJM5&type=catalogue).
- [JST PH series dimensional drawing](https://www.jst-mfg.com/product/pdf/eng/ePH.pdf).
- [Omron B3U switch datasheet, page 2 nominal terminal and pad pattern](https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3u.pdf).
- [Waveshare 1.3-inch LCD module schematic](https://files.waveshare.com/upload/0/0c/1.3inch_LCD_Module_Schematic.pdf).

The original upstream files remain untouched. Custom variants are separately named. Upstream footprints use KiCad format version 20260206; EasyEDA's importer may require the PCB exporter to normalize the syntax to its supported KiCad version without changing pad geometry. No drawing download or footprint assignment constitutes a fabrication approval.
