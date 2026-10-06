# Native schematic layout audit

The nine `*-before.esource` files are untouched captures from EasyEDA Pro's
visible File Source editor. Their corresponding `*-neat.esource` files contain
ordinary schematic pages, not hierarchy/reuse blocks.

Every page uses an A3 native frame and one descriptive heading. Physically
connected electronic islands are translated without scaling or rotation. The
frame's symbol, position and title attributes remain unchanged on pages 02–09;
only Page Size, Width and Height change. Page 01's fixed 1260 × 891 mm imported
frame is replaced with the existing native frame from P1, retaining its project
library references and assigning fresh frame/attribute IDs. Old standalone
paragraphs from the flat imported page are removed.

`P1-neat.esource` is page 08 (buttons and USB termination). Do not import it
twice under a second filename: the electrical component IDs must stay unique.

## Checks completed

`native-project-validation.json` passes 144 unique component references, 92
named nets and 471 source-symbol pin checks: 444 connected pins and 27 explicit
NO_CONNECT markers. Every component Unique ID, device/symbol/footprint binding,
wire NET value and NC attribute is preserved. All 444 wire segments retain
their original length and direction. No component is scaled, mirrored or
rotated. Every output was parsed again from disk and revalidated.

Pin coordinates are reconstructed from the embedded KiCad symbols used for
the import: one native unit is 0.254 mm and the importer reverses local symbol
Y. This verifies page geometry against the independent canonical connection
list, including each numbered pin. It does not replace the editor's own
resolved-library/netlist check. Native library PIN documents were not captured.

After applying all nine pages through File Source, export the **whole project**
netlist and compare numbered ref/pin/net triples with
`output/pcb/Quipus-A1/connections.json`. Check that the PCB update proposes no
component additions/removals. The design remains an unrouted engineering draft;
native ERC/DRC and fabrication approval have not been claimed.

## Reproduce

From the repository root, run the script with the captured paths. Multiple
inputs are accepted, for example:

```powershell
python hardware/quipus-pcb/rev-a/easyeda/native/normalize_page.py hardware/quipus-pcb/rev-a/easyeda/native/01-usb-charge-before.esource hardware/quipus-pcb/rev-a/easyeda/native/09-audio-before.esource
```

The original capture is never overwritten. Each output gets a detailed
`.validation.json` report. To check all pages together, pass the nine neat paths
followed by `--full-project`. Use `--validate-only` to inspect a page without
writing it. `--sheet keep` preserves the existing frame size.

## Official format references

- [Component primitives and transform order](https://prodocs.easyeda.com/en/format/schematic/component/)
- [Attribute ownership and displayed positions](https://prodocs.easyeda.com/en/format/schematic/attr/)
- [Wire primitives and mandatory NET attributes](https://prodocs.easyeda.com/en/format/schematic/wire/)
- [File Source](https://prodocs.easyeda.com/en/schematic/file-file-source/)
- [Whole-project netlist export](https://prodocs.easyeda.com/en/schematic/export-netlist/)
