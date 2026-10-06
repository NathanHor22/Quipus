# Microphone annulus — native import repair investigation

**Historical investigation, now superseded by the accepted native correction.** The canonical footprint in `native/microphone-footprint-final.esource` is accepted, saved and propagated to U20/U21; all six new-quarter instance pads are assigned GND. Final native DRC records0 clearance findings,451 unrouted connection errors and1 schematic metadata mismatch. See `native/microphone-footprint-final-notes.md` for exact dimensions, native paste-width variance and current verification status. The unassigned candidates below remain investigation records and are not the accepted library artifact.

The initial native EasyEDA PCB DRC reported two zero-clearance collisions between each microphone's ground pad and its acoustic NPTH. The KiCad source geometry has a 0.985 mm inner copper diameter around a 0.60 mm acoustic hole, so nominal copper-to-hole clearance is 0.1925 mm. A local source pass therefore does not resolve the native violations. Inspect the actual imported copper and pad definition before deciding whether the importer filled the centre or the native rule engine is evaluating an incorrect contour.

`mic-annulus-repair-proposal.json` records a new **unassigned** candidate and exact native contour geometry. No assigned footprint, manifest, pin mapping or placement was changed by generating the candidate.

## Native representation

The current [official Pro pad API](https://prodocs.easyeda.com/en/api/reference/pro-api.tpcb_primitivepadshape.html) supports a complex polygon as the ordinary pad shape. Its [API shape enum](https://prodocs.easyeda.com/en/api/reference/pro-api.epcb_primitivepadshapetype.html) uses `POLYGON`. Use an outer circular contour and an oppositely wound inner circular contour; the manufacturer's copper radii are 0.8625 mm and 0.4925 mm. The separate physical drill remains 0.60 mm NPTH.

Do not confuse API parameters, older file-source array records and current object records. The [official legacy PAD format](https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/primitives/pad.md) uses a `POLY` array for a polygon pad. The [current pad format description](https://raw.githubusercontent.com/easyeda/easyeda-pro-format-skill/main/primitives/PCB/pad.md) describes an object `defaultPad` with a `padType` discriminator. A real native sample must establish the actual document version and coordinate units before patching.

The [official complex-polygon definition](https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/complex-polygon.md) uses nonzero winding; an inner contour must oppose the outer winding. [Circle contour syntax](https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/single-polygon.md) has a centre, radius and winding flag. The proposal's native contours are relative to the unchanged source custom-pad anchor at (+0.6775,-0.710) mm: their common relative centre is (-0.6775,0). The imported bottom-side mirror or changed native pad origin may require a different relative centre; read the actual e4 pad definition rather than assuming signs.

The [official Pro PCB FAQ](https://prodocs.easyeda.com/en/faq/pcb/) also documents a native UI method for a single-layer circular pad: draw two arcs, convert them to pads and assign both nets. A ring can alternatively be constructed from two circular fill regions with **Boolean Operation → Exclude Overlapping Areas**, then converted to a pad. For this component, the ring centreline radius would be 0.6775 mm and its width 0.37 mm. Preserve pad number 5 and GND while replacing its geometry.

## KiCad polygon candidate

The candidate footprint contains one pad 5, with its 0.10 mm anchor entirely inside the copper wall. Four filled concave quarter-ring polygons replace the stroked-circle primitive. Their shared radial edges join to form the complete ring without a centre-filled polygon or an internal-contour interpretation. Separate explicit mask polygons preserve 1.825 mm outer and 0.885 mm inner mask diameters; the three paste sectors and the sound hole are unchanged.

Each quarter has 90 straight segments on each circular edge. Maximum inner-edge chord error is 0.0000188 mm; minimum copper-to-hole clearance is 0.192481 mm. Independent checks confirmed four copper quarters, an empty centre, an anchor in copper, four mask quarters, preserved cardinal diameters and three unchanged paste sectors. This tests the candidate source; it does not prove native import or native DRC.

## Acceptance

Read the native pad's actual source, repair the relevant geometry without altering its net or pin identity, then re-run native DRC. Inspect native copper, mask, paste and drill separately at high zoom and compare the two microphone positions. Both 0.60 mm NPTHs must remain clear of copper by the specified annulus spacing. Only a verified native result should replace the assigned footprint or be described as repaired. Do not lower the rule or ignore these violations to make the count disappear.

The exact land pattern comes from the [IM69D128S datasheet, Figures 12/13](https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf). Infineon provides official footprint-library downloads, but [the exact Eagle library](https://www.infineon.com/gated/infineon-pcb-footprints-and-symbols-im69d128s-mems-microphones-for-consumer_fc9d0143-b865-492e-a730-1abc1a0f2f4b) currently requires an Infineon login. No verified native supplier-library substitute was established in this investigation.
