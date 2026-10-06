# Canonical native microphone footprint

`microphone-footprint-final.esource` is an **unchanged byte copy of the actual native File Source capture after v3**, with SHA256 `45ea8bf5dd2c93b501bb10f20fc2f2704adb103a7e5c5ec3c488ded3f2b14c64`. **Canonical native Apply is accepted, the footprint library is saved, and the correction has been propagated to U20 and U21.** The two original microphone copper-ring/NPTH clearance errors are resolved. Geometry and successful native Save are separate from unfinished routing and stencil review; this is not a fabrication release.

The parent confirmed these native results on 1 October 2026. **All six newly added instance quarter pads are assigned GND and saved**, as recorded in `microphone-ground-binding-audit.json`. The final native DRC shows **452 findings:451 unrouted connection errors,1 schematic metadata mismatch and0 clearance findings**, recorded in `pcb-drc-final-ui.txt`. The native net count is93 including the empty net, representing the92 canonical nets; the ratline network count remains92. `microphone-native-verification-status.json` records these stages without replacing geometric audit results.

The complete independent review is `microphone-footprint-final.audit.json`. It confirms 165 native records, all original identifiers, nine physical PAD records and all seven explicit paste FILLs. Four copper quarters share electrical number5/GND; each routing origin is inside its own copper wall. Pads1–4 and the entire NPTH record retain their positions and identities. Actual native capture normalizes quarter winding and rounds coordinates to four decimal mil; comparison of complete contours, allowing winding reversal, confirms the physical lands remain the same.

| Native physical check | Result |
|---|---:|
| Copper annulus bounding OD, both axes | 1.72500036 mm |
| Nominal copper ID before polygon chord approximation | 0.985 mm |
| Minimum actual copper-to-NPTH distance | 0.192479567 mm |
| Unplated acoustic-hole diameter | 0.60000134 mm |
| Mask annulus outer diameter | 1.82499762 mm |
| Mask annulus inner diameter | 0.88499950 mm |
| Acoustic centre | (0, −0.71000112) mm |
| Automatic full-pad paste | Suppressed with −1000 on every electrical PAD |

The native editor canonicalized each explicit paste FILL's requested zero line width to **0.2 mil = 0.00508 mm**. Its four signal aperture contours are approximately 0.63 × 0.47 mm. **If this boundary stroke is included in exported stencil geometry**, their bounds become approximately **0.63508 × 0.47508 mm**. The ground-sector contour radii remain approximately 0.54/0.83 mm; including that stroke gives approximately **0.53746/0.83254 mm**. This is a recorded native variance, not an assertion of manufacturer-exact final stencil apertures. The actual stencil Gerber must be inspected before fabrication; optional contour compensation can be done in that later release step.

`microphone-footprint-final.png` draws the copper, explicit paste contours and mask separately from the canonical native source. It has the same geometry as the inspected v3 closeup. Copper crosses denote the four routing origins. The paste drawing displays the filled contours; the native 0.2mil border and its conditional export expansion are recorded in the audit rather than hidden. This local drawing does not replace native DRC or Gerber inspection.

Reproduce the audit and canonical copy with:

```text
python hardware/quipus-pcb/rev-a/easyeda/native/validate_microphone_canonical.py
python hardware/quipus-pcb/rev-a/easyeda/native/render_microphone_repair.py hardware/quipus-pcb/rev-a/easyeda/native/microphone-footprint-final.esource
```

The completed native library/PCB refresh preserves U20/U21 placement. **All four number5 lands are assigned GND on each instance**, with the original ground quarter retained and all six new quarters bound and saved. The former two mic copper-to-hole errors are resolved, and the final native DRC has no clearance findings. Its451 connection errors and1 schematic metadata mismatch remain unresolved. Routing, stencil review, electrical/thermal performance and fabrication qualification are separate work.

The accepted correction is in the native EasyEDA footprint library and PCB instances. The original generated KiCad carrier and its local SHA remain separate artifacts; rebuilding/reimporting that carrier does not automatically reproduce this native repair. Preserve the accepted canonical native footprint and repeat its native geometry/net checks after a future carrier import.

The manufacturer dimensions derive from [Infineon's IM69D128S datasheet, Figures12–13](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf). The automatic-paste suppression follows [EasyEDA Pro's documented −1000 custom paste expansion method](https://prodocs.easyeda.com/en/faq/pcb/). The absolute flat-polygon coordinate convention is proven by this actual Pro3.2.149 editor observation, superseding the older relative-origin format for this document.
