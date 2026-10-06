"""Package reviewed design outputs; exclude temporary render sheets."""
from pathlib import Path
import zipfile, hashlib, json, csv

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
OUT=REPO/'output/pcb/Quipus-A1'
PDF=REPO/'output/pdf/Quipus-A1-schematic-review.pdf'
ZIP=OUT.parent/'Quipus-A1-design-review.zip'

extras=[
 ('BAT1','Protected 1S LiPo, 2000 mAh, 3.7 V / 4.2 V','Exact pack TBD','>=2 A discharge; polarity/chemistry/temperature window and dimensions require approval'),
 ('NTC1','10k NTC, Semitec 103AT-2 characteristic','Cell-contact sensor','Must track cell temperature; BQ24074 window must fit selected pack including tolerances'),
 ('LCD1','Waveshare 1.3inch LCD Module, SKU 15867','45 x 31 mm module','8-pin module J2 harness; 3.3 V; verify stack height on sample'),
 ('SPK1','8 ohm, 2 W miniature speaker','Same Sky CDS-27208 candidate','27 x 20 x 5.9 mm; solder-pad speaker needs pigtail; final enclosure acoustic test'),
 ('SD1','microSD 32 GB initial evaluation card','Removable storage','Select known genuine card; format/recovery and write latency require testing'),
 ('HAR1','Battery JST PH cable, 2.00 mm, 2 pins','Correct mating housing/contact','Do not infer polarity from colours or another vendor cable'),
 ('HAR2','NTC JST SH cable, 1.00 mm, 3 pins','Correct mating housing/contact','NTC / GND / NC; cannot share two-pin speaker harness'),
 ('HAR3','Speaker JST SH cable, 1.00 mm, 2 pins','Correct mating housing/contact','Differential SPK+ / SPK-; neither wire is ground'),
 ('HAR4','Display JST PH cable, 2.00 mm, 8 pins','Correct mating housing/contact','Pin 1 BL through pin 8 VCC; continuity-check against Waveshare J2'),
 ('OPT1','Optional Quipus PDM microphone daughterboard','4-pin JST SH short internal lead','MIC_3V3 / GND / CLK / DATA; external board design is a separate option'),
]
with (OUT/'off-board-assembly-parts.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['Reference','Requirement/candidate','Form','Notes']);w.writerows(extras)

files=[p for folder in ['schematics','legacy-kicad','model'] for p in (OUT/folder).rglob('*') if p.is_file()]
files += [p for p in OUT.iterdir() if p.is_file() and p.suffix in {'.md','.csv','.json'} and p.name!='package-manifest.json']
manifest={'status':'engineering review draft; not for fabrication','pdf':PDF.name,'files':[]}
with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(files):
        name='Quipus-A1/'+p.relative_to(OUT).as_posix()
        z.write(p,name)
        manifest['files'].append({'path':name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    z.write(PDF,'Quipus-A1/'+PDF.name)
    for p in sorted(ROOT.iterdir()):
        if p.is_file() and p.suffix in {'.py','.json','.md'}: z.write(p,'Quipus-A1/source/'+p.name)
    z.writestr('Quipus-A1/package-manifest.json',json.dumps(manifest,indent=2))
(OUT/'package-manifest.json').write_text(json.dumps(manifest,indent=2))
with zipfile.ZipFile(ZIP) as z:
    assert z.testzip() is None
    assert any(n.endswith('.step') for n in z.namelist())
    assert any(n.endswith('.kicad_sch') for n in z.namelist())
print(f'{ZIP} ({ZIP.stat().st_size:,} bytes)')
