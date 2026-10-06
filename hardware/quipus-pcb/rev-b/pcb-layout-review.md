# Quipus Rev B — physical layout proposal and carrier audit

2 October 2026. This is an independent read-only review of the A1 carrier and a **Rev B placement proposal**. It is not a native EasyEDA DRC, copper-routing review or fabrication signoff. This work does not edit the A1 generator or its saved PCB.

## Actual A1 file inspected

- Generator: `hardware/quipus-pcb/rev-a/easyeda/build_import.py`.
- Placement source and copy: `hardware/quipus-pcb/rev-a/easyeda/placement.json` and `output/pcb/Quipus-A1-EasyEDA/placement.json`.
- PCB: `output/pcb/Quipus-A1-EasyEDA/Quipus-A1.kicad_pcb`, SHA-256 `5f48361c2ff1a57b59c6621943f8e72196b9cb33372bc079969b886fc56f1d6c`.
- The parsed board contains **144 electrical footprints plus four mounting holes, 92 nonempty nets, zero track segments and zero standalone vias**. Its 65 x 105 mm outline has the central antenna notch. Grounded plated holes inside a footprint are not counted as standalone via objects.

The retained generator explicitly builds an unrouted placement carrier. It ties numbered component lands to canonical nets and reproduces pad mappings, all-layer antenna keepouts and mounting holes. This is useful import infrastructure; it does not electrically connect the components on a physical board.

## Size and front layout decision

Recommend **65 x 125 mm** for the first Rev B candidate, increasing A1's length by 20 mm while retaining width, antenna position and notch. This is a proposed engineering choice. The user-supplied existing speaker is 41 x 29 x 10 mm; using it on the front below volume controls needs more length than the old front arrangement permits without stacked interference. A smaller purchased speaker might let a later revision shrink again.

| Item | Candidate coordinate/envelope, mm | Requirement |
| --- | --- | --- |
| ESP32 U1 | (32.5,13), B, 0 degrees | Retain original module/antenna geometry |
| Top mic U20 | (5.75,10.2), B | Front acoustic hole (5.75,9.49) |
| Power / Start / Stop | (16,27.5), (32.5,27.5), (49,27.5), F | Above display; exact SW1 part still needs approval |
| Display | x10..55, y34.5..65.5, F | 45 x 31 mm offboard module; no protruding PTH tails inside |
| Down / Up | (22,72), (43,72), F | Below display |
| External MIC A / B | Footprint origins (1.5,74.1), 90 degrees / (63.5,75.9), 270 degrees, B | Body recessed 0.30 mm; bushing mouths (-3.7,75) and (68.7,75) |
| Front speaker | x12..53, y82..111, 10 mm depth | Mechanical clearance box, not an electrical footprint |
| Bottom mic U21 | (59.25,113), B | Front acoustic hole (59.25,112.29) |
| USB-C J1 | (32.5,121.325), F | Same local edge guide y+3.675 reaches new bottom y125 |
| SD J6 | (56.15,40), B, 90 degrees | Ejection remains rightward; nominal copper-edge gap increases to 0.525 mm |
| Display connector J7 | (39.5,68), B | Moves PTH tails below LCD envelope instead of under its board |
| Mount holes | (5,19), (60,19), (5,119), (60,119) | 2.8 mm NPTH; 2.75 mm radius head keepouts both faces |

The audio-footprint review confirms the SJ1-3533NG body is 14 mm along insertion, 8.2 mm along the edge and 12.5 mm high above the PCB. Pin 1 is the local origin, with tip pin 2 at (2,2.4), ring pin 3 at (2,7.9), and plug centre at (0.9,-5.2). The B-side local-X reflection and KiCad rotation place the two actual mating axes at y75. The 0.30 mm body recess leaves a nominal 0.60 mm copper-edge gap at the sleeve land. The outboard bushing is intentional and requires a matching case opening; it is not outboard PCB copper.

The existing case is not approved for this longer board. Exact protected 2,000 mAh pack dimensions remain unknown; reserve a separate rear battery compartment with clearance to jack bodies, solder protrusions, screw posts, speaker depth and NTC wiring. No hard-coded battery envelope should be inferred from capacity alone.

## Allocation of the full circuit

`pcb-placement-plan.json` allocates **all 180 circuit references** to functional regions and supplies 36 candidate major-component anchors. It has 39 added and three removed references relative to the actual A1 carrier. These are zones and starting coordinates, not 180 validated final placements.

- U23 ADC and its bypass/filter parts occupy a proposed central rear region x25..42, y32..53. Keep audio inputs short and ADC supply bypass loops local.
- J8 and J9 occupy opposite rear edges near y75. Analog input bias, coupling and protection groups occupy their adjacent inward regions; each socket retains an independent channel.
- U31 button expander moves to the front top-left region, avoiding the left microphone input group. Keep its front components outside the ESP antenna/fastener regions and above the display.
- U22 speaker amplifier and J5 move below/right of the external sockets, with short differential speaker wiring. Keep their high-current paths away from analog input returns.
- Latch/load switch, USB-current logic and regulator are repacked in separate rear lower regions. The USB charger/CC/ESD group occupies the front bottom strip below the speaker clearance box. Do not translate the old lower passives by one offset and assume they still fit.
- Power-switch control moves above the display, while BOOT and RESET remain accessible rear service controls. The electronic switch count remains seven.

Every individual component still needs placement based on its actual courtyard and electrical loop requirements. Some region boundaries overlap to permit local decoupling and routing; that is not permission for component courtyards or exposed solder joints to collide.

## Completed placement candidate and geometric check

The actual 180-reference placement is now saved in `easyeda/placement.json`, generated by `easyeda/pack_placement.py`. It loads the exact retained A1 power/controller footprint assignments and the new `audio-footprints/assignments.json`, with SW1 explicitly using the reviewed two-terminal Omron footprint. No component is represented by an invented nominal rectangle in place of its assigned courtyard.

The independent audit `easyeda/placement-packing-audit.json` records every input footprint path/checksum and all anchor adjustments. The completed run reports **180 of 180 placed; zero same-face courtyard overlaps; zero opposite-face through-hole conflicts; zero static violations**. Static checks include copper inside the real notched outline and at least 0.50 mm from its edge, mounting-head keepouts, all-layer RF region, front LCD/speaker reservations, and through-hole tails entering those front reservations. The two side-jack bushings, USB mating courtyard, SD mating courtyard and ESP antenna air region may extend outside PCB material; their copper cannot.

These checks apply to the assigned footprint shapes at the saved placements, not to an exported routed PCB or a live native CAD project. An actual carrier rebuild must reproduce the placements and geometry, then be independently checked. Some ADC bypasses are 5-6 mm from the ADC centre and the ferrite about 7.2 mm from it; electrical routing must refine pin-side capacitor placement and local loop lengths rather than treating a courtyard pass as an audio-noise signoff. Speaker/USB differential routes, regulator/charger thermal copper and exact enclosure height still require engineering review. No routing or native DRC was performed by the packing script.

### Native USB mechanical-hole finding and minimal repair

Native EasyEDA B1 DRC subsequently found R342 against a USB connector **unplated mechanical hole**. The initial local packing filter checked plated through-hole lands but omitted NPTH body clearance across faces, so its earlier zero-conflict report did not cover this native rule. This is a concrete limitation of that earlier audit, not a native DRC pass.

R342 alone was moved from **(30,117), 90 degrees, B** to **(30,116), 90 degrees, B**. All other 179 placements remain unchanged. J1's nearest mechanical hole centre is (29.61,118.72), with 0.65 mm diameter. R342's revised courtyard ends at y117.48, leaving approximately **0.915 mm** to that hole edge. Its adjacent R341 courtyard ends at y114.25 while the revised R342 begins at y114.52, so no new courtyard overlap is introduced.

The packing algorithm now treats every NPTH as a physical obstacle against other component courtyards on both faces, with the native **0.254 mm / 10 mil** body margin. Circular holes are conservatively represented by circumscribed 96-segment polygons; slotted holes use conservative rotated bounding boxes. A regression check reproduces the original J1/R342 conflict and clears it at the revised coordinate. `--audit-existing` validates saved coordinates without repacking unrelated components. The refreshed audit reports 180 placed and zero NPTH-body, courtyard, plated-through-hole or static conflicts. The parent must update the native component and rerun native DRC; these local checks do not assert that native update has already happened.

## Blocking geometry/import issues to preserve or resolve

1. **Microphone annulus:** the generated KiCad carrier retains the original custom annular GND-pad representation which previously failed native EasyEDA acoustic-hole clearance. The accepted native correction is separately saved at `hardware/quipus-pcb/rev-a/easyeda/native/microphone-footprint-final.esource`. It uses four GND quarter pads around the NPTH, with minimum recorded copper-to-hole gap about 0.19248 mm. Reimporting the original carrier does not recreate that accepted repair. Preserve or deliberately reproduce it on both Rev B microphone instances and recheck all number-5 pad nets.
2. **Microphone stencil:** native conversion rounded the explicit paste-fill line width to 0.00508 mm. Inspect the actual exported stencil apertures, acoustic hole, mask and GND quadrants; a good-looking footprint preview does not prove final paste geometry.
3. **New footprints missing from A1:** U23 WQFN24+exposed pad, U24 SOT23-5, two SJ1-3533NG through-hole jacks and the added passives/protection need exact physical assignments. A1 has no footprint mapping for these 39 new references. New mappings are now recorded in `audio-footprints/assignments.json`; the new carrier must use them and preserve jack contact numbering, slotted drills and body orientation. Native import and stencil checks remain.
4. **Controller pad nets change:** the inspected A1 U1 pads 4/5/6 still carry PDM_CLK/PDM_DIN0/PDM_DIN1, and pad35 is unconnected. Rev B requires AUD_BCLK/AUD_FSYNC/AUD_SDOUT and ADC_SHDN_N respectively. Replacing only symbols or labels without updating actual PCB pad nets would leave the wrong connections.
5. **SD edge margin:** A1's nearest J6 shell copper is only 0.275 mm from x65. The new draft target is 0.5 mm, so the proposed x56.15 position provides about 0.525 mm nominal. Confirm router/board-edge tolerances or move it further inward if required. Card mouth recession and ejection travel must follow the changed position.
6. **Display and through-hole tails:** the old J7 position y61 places PTH solder ends inside the front display envelope. An unresolved display standoff height was a mechanical hold. Moving J7 to y68 avoids the nominal display rectangle, but the real connector body, solder tail length and harness bend still need a 3D review.
7. **Lower front speaker:** old front U34/R302/R303 and some power components would enter the new speaker box if simply translated. Move/repack them onto the specified rear/bottom zones and audit both sides before importing an assembly model.
8. **Battery/current measurement:** retain distinct BAT_PACK_P and BAT_P nets across the shunt, SYS_RAW and MAIN_RAW across the load switch, and MIC_3V3/ADC supply filters. An exporter merge would bypass measurement or isolation even if the board looks tidy.

The inspected USB shared-contact mappings, microSD A/B detector mapping and ESP pad-41 GND bindings match their documented A1 sources. This review found no reason to renumber them. Preserve all twelve plated pad-41 holes plus the centre pad; they are not microphone-style NPTH features.

The archived native A1 review records zero clearance findings after its mic correction, **451 unrouted connection findings and one import metadata mismatch**. Those are historical native results for the old project, not validation of Rev B or the newly inspected candidate plan.

## Rules for the next actual PCB review

- Retain a fabricator-approved four-layer stackup. Use continuous ground reference for audio/digital routes; do not create arbitrary plane splits beneath them.
- Draft ordinary signal rule: 0.15 mm clearance, 0.20 mm default track, 0.60/0.30 mm via. These are starting manufacturing rules, not power-track sizing or supplier approval.
- Increase copper-to-edge target to 0.50 mm. Existing footprint-internal plated 0.20 mm holes and acoustic 0.60 mm NPTH require explicit manufacturing capability checks.
- Preserve antenna clearance x8.5..56.5, y-14.75..6.25 on F.Cu, In1.Cu, In2.Cu and B.Cu. No tracks, vias, pours or mechanical intrusion in that region.
- Check PTH copper and solder-tail volume on both faces, including side jacks and the display header. Clear fastener heads on both faces and provide SD push/ejection and connector plug clearance.
- Define USB differential width/gap from the chosen stackup; keep protection close to the connector and continuously reference the pair to ground. Do not claim controlled impedance from the default 0.20 mm signal width.
- Size power paths using actual currents, copper thickness, trace length and permitted temperature rise. Validate thermal copper/vias for charger, converter, amplifier and ADC exposed pads.
- Run footprint/net parity checks before import, then native schematic ERC and PCB DRC after synchronization and after routing. Finally inspect Gerbers, drill and stencil outputs against the PCB and assembly drawings.

The zero-track carrier must not be ordered as a functioning prototype. Manufacturing approval follows completion of routed copper and the electrical, mechanical and thermal review.
