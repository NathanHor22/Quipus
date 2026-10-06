"""Build self-contained editable schematics and an illustrated review PDF.

The source describes an electrical draft. It deliberately does not invent
footprints, copper routing, Gerbers or a fabrication-ready PCB.
"""
from pathlib import Path
import csv, json, uuid, math, re, textwrap, zipfile
from collections import defaultdict, Counter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape, A3
from power_budget import calculate

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = REPO/'output/pcb/Quipus-B1'
CAD = OUT/'schematics'
LEGACY = OUT/'legacy-kicad'
PDF = REPO/'output/pdf/Quipus-B1-schematic-and-assembly-guide.pdf'
for d in [OUT, CAD, LEGACY, PDF.parent]: d.mkdir(parents=True, exist_ok=True)
PROJECT = 'Quipus-B1'
UID = lambda x: str(uuid.uuid5(uuid.NAMESPACE_URL, 'quipus-b1/'+str(x)))
Q = lambda x: json.dumps(str(x), ensure_ascii=True)
ROOT_ID = UID('root')

ALIASES = {'3V3':'3V3_SYS','3V3_MAIN':'3V3_SYS','SYS_SW':'MAIN_RAW'}
PARTS = []
RAW = {}
for filename, defaultgroup in [('power-circuit.json','Power'),('controller-circuit.json','Controller'),('audio-circuit.json','Audio')]:
    data = json.loads((ROOT/filename).read_text(encoding='utf-8-sig'))
    RAW[defaultgroup] = data
    for original in data.get('components', data.get('parts', [])):
        p = json.loads(json.dumps(original))
        p['group'] = p.get('group', p.get('section', defaultgroup))
        p['origin'] = defaultgroup
        p['note'] = p.get('notes', p.get('note',''))
        p['package'] = p.get('package', '')
        for pin in p['pins']:
            pin['number'] = str(pin['number'])
            pin['net'] = ALIASES.get(pin.get('net'), pin.get('net'))
        PARTS.append(p)

def ascii_text(s):
    return str(s).replace('\u03a9','ohm').replace('\u00b5','u').replace('\u2013','-').replace('\u2014','-').replace('\u2265','>=').replace('\u2264','<=').replace('\u00d7','x').encode('ascii','replace').decode()

def pin_type(p, pin):
    provided = pin.get('electrical_type',pin.get('type'))
    if provided in {'input','output','bidirectional','tri_state','passive','free','unspecified','power_in','power_out','open_collector','open_emitter','no_connect'}:
        return provided
    if not p['ref'].startswith('U'): return 'passive'
    ref, name, n = p['ref'], pin['name'], str(pin['number'])
    if name in {'NC'}: return 'no_connect'
    if name in {'GND','GND_EP','EP','VSS','AGND','PGND'}: return 'power_in'
    if ref == 'U12' and name == 'VDD': return 'power_out'
    if name in {'VCC','VDD','VIN','IN','VBACKUP','3V3'}: return 'power_in'
    if ref == 'U1': return 'input' if name == 'EN' else 'bidirectional'
    if ref == 'U2':
        if name in {'OUT'}: return 'power_out'
        if name in {'PGOOD_N','CHG_N'}: return 'open_collector'
        return 'passive' if name == 'BAT' else 'input'
    if ref == 'U3':
        if name in {'CC1','CC2'}: return 'bidirectional'
        if name in {'OUT1','OUT2','OUT3','ID'}: return 'open_collector'
        return 'input'
    if ref == 'U4': return 'power_out' if name == 'OUT' else 'input'
    if ref in {'U5','U6','U7','U8'}: return 'output' if name == 'Y' else 'input'
    if ref == 'U9': return 'open_collector' if name in {'INT_N','EN'} else 'input'
    if ref == 'U10': return {'VOUT':'power_out','QOD':'passive'}.get(name,'input')
    if ref == 'U11': return {'VOUT':'power_out','PG':'open_collector','L1':'passive','L2':'passive'}.get(name,'input')
    if ref == 'U12': return {'SDA':'open_collector','GPOUT':'open_collector','BAT':'power_in'}.get(name,'input')
    if ref in {'U13','U35'}: return 'passive'
    if ref == 'U30': return {'CLKOUT':'output','INT_N':'open_collector','SDA':'open_collector'}.get(name,'input')
    if ref == 'U31': return 'input' if name == 'SCL' else 'bidirectional'
    if ref == 'U34': return 'input' if name in {'S','OE_N'} else 'passive'
    return 'unspecified'

for p in PARTS:
    for pin in p['pins']: pin['electrical_type'] = pin_type(p, pin)

GROUPS = list(dict.fromkeys(p['group'] for p in PARTS))

def layout(parts):
    pages=[]; placed=[]; col=0; y=40
    for p in parts:
        h=max(7.62, (len(p['pins'])-1)*2.54+5.08)
        block=h+16
        if y+block>259:
            col+=1; y=40
        if col==3:
            pages.append(placed); placed=[]; col=0; y=40
        placed.append(dict(part=p,x=85+col*136,y=y+h/2,h=h))
        y+=block
    if placed: pages.append(placed)
    return pages

def symbol(p,h):
    ref=p['ref']
    out=[f'(symbol "Quipus:{ref}" (pin_names (offset 0.508)) (in_bom yes) (on_board yes)',
         f'(property "Reference" {Q(ref)} (at 0 {h/2+3} 0) (effects (font (size 1.27 1.27))))',
         f'(property "Value" {Q(p["value"])} (at 0 {h/2+6} 0) (effects (font (size 1.27 1.27))))',
         f'(symbol "{ref}_0_1" (rectangle (start -19.05 {h/2}) (end 19.05 {-h/2}) (stroke (width 0.254) (type default)) (fill (type background))))',
         f'(symbol "{ref}_1_1"']
    for i,pin in enumerate(p['pins']):
        y=(len(p['pins'])-1)*1.27-i*2.54
        out.append(f'(pin {pin_type(p,pin)} line (at -24.13 {y:.4f} 0) (length 5.08) (name {Q(pin["name"])} (effects (font (size 1.016 1.016)))) (number {Q(pin["number"])} (effects (font (size 1.016 1.016)))))')
    return '\n'.join(out+['))'])

SHEETS=[]
for gi,g in enumerate(GROUPS):
    for pi,placed in enumerate(layout([p for p in PARTS if p['group']==g])):
        filename=f'{gi+1:02d}_{re.sub("[^a-z0-9]+","_",g.lower()).strip("_")}_{pi+1}'
        sid=UID(filename); page=len(SHEETS)+2
        lines=[f'(kicad_sch (version 20230121) (generator "quipus_draft") (uuid {Q(UID(filename+"document"))}) (paper "A3")',
               f'(title_block (title {Q(g)}) (date "2026-10-02") (rev "B1-DRAFT") (company "Quipus") (comment 1 "Review draft - no routing - footprint and ERC review required"))',
               '(lib_symbols',*[symbol(v['part'],v['h']) for v in placed],')',
               f'(text "MATCHING GLOBAL LABELS ARE ELECTRICALLY CONNECTED / PHYSICAL PIN NUMBERS SHOWN" (at 12 16 0) (effects (font (size 1.5 1.5)) (justify left)) (uuid {Q(UID(filename+"note"))}))']
        for v in placed:
            p,x,y,h=v['part'],v['x'],v['y'],v['h']; ref=p['ref']
            for i,pin in enumerate(p['pins']):
                px=x-24.13; py=y-(len(p['pins'])-1)*1.27+i*2.54; key=ref+':'+pin['number']
                if pin['net'] is None:
                    lines.append(f'(no_connect (at {px:.4f} {py:.4f}) (uuid {Q(UID(key+"nc"))}))')
                else:
                    lx=px-5.08
                    lines.append(f'(wire (pts (xy {px:.4f} {py:.4f}) (xy {lx:.4f} {py:.4f})) (stroke (width 0) (type default)) (uuid {Q(UID(key+"wire"))}))')
                    lines.append(f'(global_label {Q(pin["net"])} (shape bidirectional) (at {lx:.4f} {py:.4f} 0) (effects (font (size 1.016 1.016)) (justify right)) (uuid {Q(UID(key+"label"))}))')
            dnp = 'yes' if 'DNP' in p['value'] else 'no'
            lines.append(f'(symbol (lib_id "Quipus:{ref}") (at {x} {y:.4f} 0) (unit 1) (in_bom yes) (on_board yes) (dnp {dnp}) (uuid {Q(UID(ref))})')
            lines.append(f'(property "Reference" {Q(ref)} (at {x-19.05} {y-h/2-6:.4f} 0) (effects (font (size 1.27 1.27)) (justify left)))')
            lines.append(f'(property "Value" {Q(p["value"])} (at {x-19.05} {y-h/2-2.8:.4f} 0) (effects (font (size 1.05 1.05)) (justify left)))')
            lines.append(f'(property "Footprint" "" (at {x} {y:.4f} 0) (effects (font (size 1.27 1.27)) hide))')
            if p.get('source'): lines.append(f'(property "Datasheet" {Q(p["source"])} (at {x} {y:.4f} 0) (effects (font (size 1.27 1.27)) hide))')
            for pin in p['pins']: lines.append(f'(pin {Q(pin["number"])} (uuid {Q(UID(ref+":"+pin["number"]+":pin"))}))')
            lines.append(f'(instances (project {Q(PROJECT)} (path {Q("/"+ROOT_ID+"/"+sid)} (reference {Q(ref)}) (unit 1)))) )')
        lines.append(')')
        (CAD/(filename+'.kicad_sch')).write_text('\n'.join(lines),encoding='utf-8')
        SHEETS.append(dict(filename=filename,uuid=sid,page=page,group=g,placed=placed))

root=[f'(kicad_sch (version 20230121) (generator "quipus_draft") (uuid {Q(ROOT_ID)}) (paper "A3")',
      '(title_block (title "Quipus B1 - 2000 mAh recorder") (date "2026-10-02") (rev "B1-DRAFT"))','(lib_symbols)',
      f'(text "ENGINEERING REVIEW DRAFT / NO ROUTED PCB / DO NOT FABRICATE" (at 15 16 0) (effects (font (size 2 2)) (justify left)) (uuid {Q(UID("root_note"))}))']
for i,s in enumerate(SHEETS):
    x=15+(i%3)*135; y=35+(i//3)*40
    root.append(f'(sheet (at {x} {y}) (size 122 23) (stroke (width 0.254) (type default)) (fill (color 0 0 0 0)) (uuid {Q(s["uuid"])}) (property "Sheetname" {Q(s["group"]+" / "+str(s["page"]-1))} (at {x} {y-2} 0) (effects (font (size 1.1 1.1)) (justify left))) (property "Sheetfile" {Q(s["filename"]+".kicad_sch")} (at {x} {y+26} 0) (effects (font (size 0.9 0.9)) (justify left))) (instances (project {Q(PROJECT)} (path {Q("/"+ROOT_ID)} (page {Q(s["page"])})))))')
root.extend(['(sheet_instances (path "/" (page "1")))',')'])
(CAD/(PROJECT+'.kicad_sch')).write_text('\n'.join(root),encoding='utf-8')
(CAD/(PROJECT+'.kicad_pro')).write_text(json.dumps({'meta':{'filename':PROJECT+'.kicad_pro','version':1}},indent=2),encoding='utf-8')

# Legacy 5.x-compatible source format and its cache library. Export format is
# provided for conversion; neither native CAD open nor EasyEDA import is claimed.
MIL=1000/25.4
lib=['EESchema-LIBRARY Version 2.4','#encoding utf-8']
typenames={'input':'I','output':'O','bidirectional':'B','tri_state':'T','passive':'P','power_in':'W','power_out':'w','open_collector':'C','open_emitter':'E','unspecified':'U','no_connect':'N','free':'U'}
for p in PARTS:
    h=max(7.62,(len(p['pins'])-1)*2.54+5.08)*MIL/2; ref=p['ref']
    lib += ['#',f'# {ref}',f'DEF {ref} {re.sub("[0-9]", "", ref)} 0 20 Y Y 1 F N',f'F0 "{ref}" 0 {int(h+130)} 50 H V C CNN',f'F1 "{ascii_text(p["value"])}" 0 {int(h+250)} 40 H V C CNN','DRAW',f'S -750 {int(h)} 750 {-int(h)} 0 1 10 f']
    for i,pin in enumerate(p['pins']):
        y=int((len(p['pins'])-1)*50-i*100)
        lib.append(f'X {ascii_text(pin["name"]).replace(" ","_")} {pin["number"]} -950 {y} 200 R 40 40 1 1 {typenames.get(pin_type(p,pin),"U")}')
    lib+=['ENDDRAW','ENDDEF']
lib+=['#End Library']
(LEGACY/(PROJECT+'-cache.lib')).write_text('\n'.join(lib),encoding='utf-8')
(LEGACY/'sym-lib-table').write_text(f'(sym_lib_table (lib (name "Quipus")(type "Legacy")(uri "${{KIPRJMOD}}/{PROJECT}-cache.lib")(options "")(descr "Review draft embedded symbols")))',encoding='utf-8')
def legacy_header(title):
    return ['EESchema Schematic File Version 4','LIBS:'+PROJECT+'-cache','EELAYER 29 0','EELAYER END','$Descr A3 16535 11693','encoding utf-8','Sheet 1 1',f'Title "{ascii_text(title)}"','Date "2026-10-02"','Rev "B1-DRAFT"','Comp "Quipus"','Comment1 "Review draft, not for fabrication"','$EndDescr']
for s in SHEETS:
    lines=legacy_header(s['group'])
    for v in s['placed']:
        p=v['part']; x=round(v['x']*MIL); y=round(v['y']*MIL); ref=p['ref']; stamp=uuid.UUID(UID(ref)).hex[:8].upper()
        lines+=['$Comp',f'L Quipus:{ref} {ref}',f'U 1 1 {stamp}',f'P {x} {y}',f'F 0 "{ref}" H {x-750} {y-round(v["h"]/2*MIL)-230} 50 0000 L CNN',f'F 1 "{ascii_text(p["value"])}" H {x-750} {y-round(v["h"]/2*MIL)-110} 40 0000 L CNN',f'\t1 {x} {y}', '\t1 0 0 -1','$EndComp']
        for i,pin in enumerate(p['pins']):
            px=x-950; py=y-round((len(p['pins'])-1)*50-i*100)
            if pin['net'] is None: lines.append(f'NoConn ~ {px} {py}')
            else: lines+=['Wire Wire Line',f'\t{px} {py} {px-200} {py}',f'Text GLabel {px-200} {py} 0 40 BiDi ~ 0',pin['net']]
    (LEGACY/(s['filename']+'.sch')).write_text('\n'.join(lines+['$EndSCHEMATC']),encoding='utf-8')
lines=legacy_header(PROJECT)
for i,s in enumerate(SHEETS):
    x=600+(i%3)*5200; y=1200+(i//3)*1600
    lines+=['$Sheet',f'S {x} {y} 4700 900',f'U {uuid.UUID(s["uuid"]).hex[:8].upper()}',f'F0 "{ascii_text(s["group"])}" 50',f'F1 "{s["filename"]}.sch" 40','$EndSheet']
(LEGACY/(PROJECT+'.sch')).write_text('\n'.join(lines+['$EndSCHEMATC']),encoding='utf-8')

NETS=defaultdict(list)
for p in PARTS:
    for pin in p['pins']:
        if pin['net'] is not None: NETS[pin['net']].append({'ref':p['ref'],'pin':pin['number'],'name':pin['name']})
(OUT/'connections.json').write_text(json.dumps({'revision':'B1-DRAFT','net_aliases':ALIASES,'components':PARTS,'nets':NETS},indent=2),encoding='utf-8')
(OUT/'power-budget.json').write_text(json.dumps(calculate(),indent=2),encoding='utf-8')
with (OUT/'pin-connections.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['Reference','Physical pin','Pin name','Net','Package'])
    for p in PARTS:
        for pin in p['pins']:w.writerow([p['ref'],pin['number'],pin['name'],pin['net'] or 'NC',p['package']])
with (OUT/'bill-of-materials.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['Reference','Part/value','Package','Notes','Manufacturer reference'])
    for p in PARTS:w.writerow([p['ref'],p['value'],p['package'],p['note'],p.get('source','')])


from review_outputs import build_review_outputs
build_review_outputs(ROOT, OUT, CAD, LEGACY, PDF, PROJECT, RAW, PARTS, NETS, SHEETS, ALIASES)
