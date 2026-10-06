# Quipus A1 - 2,000 mAh recorder schematic draft

This revision starts a smaller custom recorder. It does not replace the existing
touchscreen firmware or the earlier four-microphone carrier studies.

**Status: engineering review draft, not released for PCB fabrication.** This
package specifies circuit connections and a proposed placement. It is not a
routed PCB, and there are no production Gerbers. Native CAD electrical-rule
checks, footprint review, layout, thermal checks and bench measurements are
still required.

## Agreed configuration

- ESP32-S3-WROOM-1-N16R8: 16 MB flash and 8 MB PSRAM.
- Protected 1S, 3.7 V nominal / 4.2 V maximum LiPo, starting at 2,000 mAh.
  Two-pin JST PH battery connector, with a separate temperature-sensor lead.
- USB-C charging and native USB programming. The charger remains available
  when the recording electronics are off.
- Two onboard PDM microphones and a keyed digital microphone expansion port
  for short internal wiring. This is not a USB microphone or lapel-mic socket.
- One amplified speaker connector, using an 8-ohm speaker.
- Small 1.3-inch SPI display; LVGL is the firmware UI library.
- Power, Start/Enter, Stop/Back, Up and Down buttons. BOOT and RESET are
  service controls rather than normal navigation buttons.
- Side-accessible microSD, battery gauge and battery-backed real-time clock.
- Power-button shutdown gives firmware time to close the WAV and save the
  upload queue. A roughly 0.7-second hold requests shutdown; the hardware
  timeout provides a forced-off fallback if firmware does not respond.

## Battery expectations

2,000 mAh specifies capacity, not a guaranteed runtime. At 5-6 recording hours
per day, a full week means 35-42 recording hours. With a planning allowance of
80% usable capacity, this would require only 38-46 mA average battery current
during recording, before standby, uploads and voice playback. A week is not
the acceptance target for A1.

The first acceptance target is a measured six-hour recording day, with screen
and Wi-Fi asleep during recording except when needed. The power budget uses
explicit assumptions until there is a working board to measure. A larger
protected 4.2 V pack can be considered later, but polarity, charge/discharge
ratings, temperature limits, physical size and gauge configuration must still
match. A JST plug alone does not establish compatibility. Power off before
replacing the pack; do not interrupt an SD write.

## Design files

The source files in this directory retain the reasoning and manufacturer
references for each circuit. `build_package.py` creates the review package in
`output/pcb/Quipus-A1/` and the PDF in `output/pdf/`. The generated KiCad sheets
include embedded symbols and named electrical nets, with physical pin numbers.
They are editable schematic source, not pictures masquerading as CAD.

EasyEDA Pro documents importing KiCad projects, but its published page lists
older KiCad versions. A legacy schematic/library export is included alongside
the modern schematic. Import has not been verified in EasyEDA. Open and check
the package in CAD before converting it; do not assume conversion preserves
every symbol, pin, net or footprint.

For the legacy route, open `legacy-kicad/Quipus-A1.sch` with its adjacent cache
library and `sym-lib-table`. Use KiCad's own project archive function before
EasyEDA conversion, as required by EasyEDA's guide. The delivered review ZIP
is a document handoff archive, not a claimed tested EasyEDA import archive.

Official import instructions:
https://prodocs.easyeda.com/en/import-export/import-kicad/

## What must happen before manufacture

1. Select the actual protected battery, NTC attachment and mechanical dimensions;
   match its permitted charging temperatures to the hardware protection window.
2. Review all pin-to-pad mappings against the exact purchased package and confirm
   the display harness and connector orientation on physical samples.
3. Run native schematic ERC, assign and review every footprint, then route the
   four-layer board with an uninterrupted ground reference and antenna keepout.
4. Check USB, switcher, audio, ESD and battery-current paths; run DRC and a second
   electrical review. Review the fabrication stackup with the selected supplier.
5. Assemble a small prototype batch. Test power sequencing, charger temperatures,
   microphone channel separation, SD integrity, USB and off-state leakage.
6. Add a separate firmware board profile. Test offline timestamps, queued uploads,
   power-loss recovery, six-hour recording, gauge learning and shutdown timing.

Any Malaysian PCB fabricator can assess standard Gerber/drill fabrication
outputs once those exist. Assembly of the fine-pitch ICs is a separate service;
the current review package is suitable for discussion with an electronics
designer, not for ordering a production run.
