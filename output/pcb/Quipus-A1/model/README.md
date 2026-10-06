# Quipus A1 placement study

**NOT FOR FABRICATION OR CASE TOOLING. Units: millimetres.**

The STEP assembly contains a proposed 65 × 105 × 1.6 mm board and component
envelopes. The PNG is projected from those CAD solids. Neither contains a
routed PCB, copper, real pads, manufacturing clearances or a validated case fit.

Origin is the board top-left, +y down the front face and +z toward the screen.
The board occupies z=0..1.6. Microphones mount on the rear and listen through
0.6 mm board openings at (8,7) and (57,7). The ESP32 antenna end sits at the top;
its complete copper/component/case keepout must be checked during real layout.

The Waveshare display board envelope is 45 × 31 mm. Its modeled thickness and
glass are illustrative pending actual stack measurements. B3U switch bodies
are approximately 3 × 2.5 × 1.2 mm; larger caps are provisional case actuators.
The USB-C part is GCT USB4105-GF-A, with only a simplified envelope here.
All button/connector clearances need exact mechanical review before case design.
The USB port exits the bottom; SD card ejects from the right. Cable bends and
card ejection travel are not yet reserved in an approved enclosure.

Proposed 2.8 mm mounting holes are centered at (5,19), (60,19), (5,99), (60,99).
The microphone connector is at right-edge y=26 to clear the upper-right hole;
the earlier y=18 position collided. The separate NTC connector has three pins
to prevent interchange with the two-pin speaker connection.

The battery has deliberately not been modelled because its dimensions are
unknown. Capacity does not determine its dimensions. The speaker and cable
harness are also omitted.

Open Quipus-A1-placement-study.step in mechanical CAD. Refer to
model-manifest.json for each envelope's assumptions. Do not send these files
to a PCB factory as manufacturing data.
