# Quipus A1 physical placement review

Scope: actual `output/pcb/Quipus-A1-EasyEDA/Quipus-A1.kicad_pcb`, generated from all 144 components. Review date: 1 October 2026. This is an independent geometric audit, not native CAD DRC, routing signoff or fabrication release.

Run `python hardware/quipus-pcb/rev-a/easyeda/validate_placement.py` after rebuilding the import. Its current actual-board results are written to `placement-validation.json`. A separate `placement-proposal-validation.json`, if present, is an in-memory dry run and must not be presented as actual-board validation.

The audit uses the generated board's placed footprint geometry, side and angle. It stitches actual closed courtyard polygons, preserving U1's nonconvex antenna/body courtyard instead of treating the whole module as a rectangular bounding box. Circular mounting-head keepouts use 48 segments, with a maximum radius error below 0.006 mm. Copper pads are conservatively bounded by rotated rectangles; this does not inspect custom-pad primitive-to-primitive solder clearances. Strict-overlap, touching-only, coincident-polygon and nonconvex-courtyard cases were checked independently. The JSON records the actual PCB SHA-256 so a later rebuild can be distinguished from this reviewed version.

## Final actual-board result

The revised actual board was rebuilt by the parent and independently rechecked. This result is for the actual file, with `proposal_dry_run=false`; it is not the separate proposal report.

The latest reviewed carrier SHA-256 is `5f48361c2ff1a57b59c6621943f8e72196b9cb33372bc079969b886fc56f1d6c`. The CAD-derived `placement-preview.png` was regenerated from this exact file and visually checked. It shows one microphone near the top and one near the bottom. All 65 revised placements were subsequently checked in native EasyEDA Properties. The separate native microphone footprint correction is described below and is not part of this generated-carrier checksum.

| Check | Result |
| --- | --- |
| Electronic references with physical courtyards | 144 of 144 |
| Same-face courtyard intersections | 0 |
| Through-hole copper against opposite-face courtyards | 0 |
| Copper outside the board or within the draft 0.25 mm edge margin | 0 |
| Fastener/head keepout intersections, both faces | 0 |
| Component courtyards in the RF region | 0 |
| RF keepout layer coverage | All four: F.Cu, In1.Cu, In2.Cu, B.Cu |
| Front component courtyards inside the screen envelope | 0 |
| USB-C PCB-edge guide | Exactly y105 mm |
| microSD insertion/ejection direction | Right, +globalX |

Three courtyard regions intentionally extend outside the PCB: U1's external antenna air/clearance region, J1's 0.505 mm assembly margin beyond the mating edge, and J6's 0.280 mm assembly margin beyond the right edge. These are not outboard copper. Confirm that the enclosure and assembly process preserve those margins.

The final SD origin is **(56.4,40), 90 degrees, bottom side**. Its nearest shell copper reaches x64.725, providing **0.275 mm** nominal clearance to board edge x65. This exceeds the draft 0.25 mm check by only 0.025 mm; freeze actual fabrication routing tolerances or increase clearance before manufacturing if the board house requires a larger edge margin. Nominal socket mouth is (64.375,40), recessed **0.625 mm** from the PCB edge.

## Initial findings and corrections

The initial placement contained 17 same-face courtyard overlaps, two microSD shell lands closer than 0.25 mm to the right edge, and two capacitor courtyards overlapping mounting-head keepouts. There were no opposite-face through-hole collisions or RF-region component conflicts.

| Group | Initial conflicts | Reason and correction direction |
| --- | --- | --- |
| Front charger/buttons | F1-SW304, C1-SW304, R2-C2, R6-SW303 | Charger/current-detection parts entered the DOWN/UP button courtyards. Move F1 below the button, C1 left, R2 right/down, R6 below UP; rerun because moving these can create new nearby collisions. |
| Rear battery/gauge | J2-R19, J2-R25, J2-R26 | PH battery connector occupies much more area than its two electrical pads. Use its 9.2 x 10.2 mm courtyard; keep gauge/shunt sense routing compact while clearing the connector body. Changes must also retain clearance to the NTC connector J3. |
| Rear microSD | J6-R310/R311/R312/R313/R314/R316 | Pullup resistors overlapped the real Hirose socket's inward courtyard edge. Move resistor row inward and move R315 separately if the relocated row intersects it. |
| Rear bulk/SD bypass | C300-C310, C300-C311 | Capacitor courtyard intersections near the ESP/SD region. Move bulk capacitor without separating the high-frequency bypass excessively from its supply pin. |
| Closely packed resistors | R341-R342; R208-R209 | Two vertically oriented 0603 parts were only 2.5 mm apart; their actual courtyards are about 2.96 mm tall. Increase center spacing or move one sideways. |
| Top fasteners | C201-H1 and C203-H2 | Capacitors at y16.5 entered the actual 2.75 mm-radius fastener/head keepout around holes at y19. Move the bypasses toward their microphones/top outer edges while retaining short supply loops. |
| Right copper edge | Two J6 shell lands | Initial x56.6 socket origin left shell copper at x64.925, only 0.075 mm from x65. Move socket inward by at least 0.175 mm to meet the draft 0.25 mm copper-to-edge check; x56.2 gives 0.475 mm. |
| Front display | U5-U8, C9/C10, R9/R10 | These front courtyards intersected the 45 x 31 mm display envelope. A standoff could permit some components, but its height is unresolved; move the logic group to a clear rear area rather than assuming vertical clearance. U5/U6 intersections were only courtyard margins near the left display edge. |

The parent owns placement changes. This review does not modify `placement.json` or the PCB.

## Geometry that must survive import

- Board outer dimensions are 65 x 105 mm. The central top notch is x22.5..42.5, y0..6.7. The module antenna is above air. Its first solder-pad copper starts at y7.29, about 0.59 mm below the notch bottom.
- U1 RF keepout spans x8.5..56.5, y-14.75..6.25 and must appear on F.Cu, In1.Cu, In2.Cu and B.Cu. All four were present in the initial actual board. It restricts traces, vias and pours; independent component-placement checks keep parts out too.
- Revised microphone centers are **U20 (5.75,10.2)** and **U21 (59.25,93)**, both on the rear. Their front-facing PCB acoustic holes are **(5.75,9.49)** and **(59.25,92.29)**. Their body envelopes and courtyards clear the RF and fastener regions. Preserve each hole's alignment and the correct rear-side reflection. The lower group uses R202 (56,94.3), C202 (62.8,91.2), C203 (62.8,93.7), with both capacitors rotated 180 degrees. Their straight pad-centre distances are 2.05 mm for the 100 nF bypass, 3.71 mm for the 1 uF bypass and 1.59 mm from DATA to the series resistor; routed paths still need engineering. The lower mic courtyard ends at y95, 1.25 mm above the bottom-right fastener head keepout.
- J1 PCB-edge guide at local y+3.675 transforms to world (32.5,105), exactly aligned with the bottom board edge at origin y101.325.
- J6's card insertion/ejection axis is +localY. Bottom-side reflection is localX; a 90-degree module angle therefore points the socket toward +globalX/right. At the final x56.4 its nominal mouth center is (64.375,40), recessed 0.625 mm from the board edge. The case opening must accommodate that recess, push-push travel and finger access.
- The four mounting-head keepouts are 2.75 mm radius, wider than the actual 2.8 mm drill holes. Test both PCB faces against them.
- Through-hole copper exists on both faces even when a connector is placed on only one side. The audit checks these pads against all courtyards on the opposite side. J7's solder protrusion under the off-board display remains a separate vertical mechanical check.

## Remaining checks beyond this audit

The initial native EasyEDA PCB DRC found two microphone ground-ring/NPTH clearances caused by the imported custom-pad shape. The accepted native correction is saved as `native/microphone-footprint-final.esource`, refreshed on both microphone instances, and uses four touching polygon ground quarters around the preserved acoustic NPTH. All four quarters on each instance are assigned GND. The native geometry audit records a minimum copper-to-hole edge gap of 0.192479567 mm. Final native PCB DRC reports **0 clearance findings**, **451 unrouted connection findings** and **one schematic import metadata mismatch**. The final import preview filtered for net changes has no rows. The preview was cancelled; device metadata and four PCB-only mounting holes need deliberate synchronization. See `native/pcb-drc-final-ui.txt`, `native/pcb-net-comparison-final-ui.txt` and `native/microphone-ground-binding-audit.json`.

Earlier annulus proposals and rejected source variants are retained as investigation history. They are not the accepted native footprint. The generated KiCad carrier still has its original custom-pad representation; a future reimport must retain or reapply the accepted native correction and inspect every pad-5 binding. Native paste-fill width normalization also needs stencil/Gerber review before assembly.

Native EasyEDA import must preserve pad numbers, oval plated shell slots, NPTH acoustic holes, custom microphone copper annuli, H-shaped gauge copper/paste, bottom-side transforms and all-layer RF keepouts. Run native ERC/DRC after copper routing and compare electrical nets to the canonical source. Validate actual display and connector heights, screw heads, case posts, harness bends, battery pouch placement and SD travel in mechanical CAD before case tooling.

The protected LiPo MPN, exact dimensions, polarity, NTC and charge-temperature limits remain unresolved. Capacity alone does not define pack dimensions. Charger dissipation is substantial at low battery voltage; the PCB's ground/thermal-via structure and cell-temperature monitoring still require qualification. Converter/amp transient current, shunt Kelvin paths, native USB impedance, SD signal integrity and complete power routing remain to be engineered and checked. Keep battery pouch and speaker magnet outside the antenna's three-dimensional clearance region.

No software polygon audit proves RF performance, charging thermal safety, custom LiPo compatibility, speaker-noise immunity or room recording quality. Those require the selected components, routed PCB and assembled-board measurements. This result clears the identified physical placement collisions; it does not authorize fabrication.
