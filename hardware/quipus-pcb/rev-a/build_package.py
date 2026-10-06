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
OUT = REPO/'output/pcb/Quipus-A1'
CAD = OUT/'schematics'
LEGACY = OUT/'legacy-kicad'
PDF = REPO/'output/pdf/Quipus-A1-schematic-review.pdf'
for d in [OUT, CAD, LEGACY, PDF.parent]: d.mkdir(parents=True, exist_ok=True)
PROJECT = 'Quipus-A1'
UID = lambda x: str(uuid.uuid5(uuid.NAMESPACE_URL, 'quipus-a1/'+str(x)))
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
               f'(title_block (title {Q(g)}) (date "2026-09-29") (rev "A1-DRAFT") (company "Quipus") (comment 1 "Review draft - no routing - footprint and ERC review required"))',
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
      '(title_block (title "Quipus A1 - 2000 mAh recorder") (date "2026-09-29") (rev "A1-DRAFT"))','(lib_symbols)',
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
    return ['EESchema Schematic File Version 4','LIBS:'+PROJECT+'-cache','EELAYER 29 0','EELAYER END','$Descr A3 16535 11693','encoding utf-8','Sheet 1 1',f'Title "{ascii_text(title)}"','Date "2026-09-29"','Rev "A1-DRAFT"','Comp "Quipus"','Comment1 "Review draft, not for fabrication"','$EndDescr']
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
(OUT/'connections.json').write_text(json.dumps({'revision':'A1-DRAFT','net_aliases':ALIASES,'components':PARTS,'nets':NETS},indent=2),encoding='utf-8')
(OUT/'power-budget.json').write_text(json.dumps(calculate(),indent=2),encoding='utf-8')
with (OUT/'pin-connections.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['Reference','Physical pin','Pin name','Net','Package'])
    for p in PARTS:
        for pin in p['pins']:w.writerow([p['ref'],pin['number'],pin['name'],pin['net'] or 'NC',p['package']])
with (OUT/'bill-of-materials.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['Reference','Part/value','Package','Notes','Manufacturer reference'])
    for p in PARTS:w.writerow([p['ref'],p['value'],p['package'],p['note'],p.get('source','')])

MM=72/25.4; W,H=landscape(A3)
c=canvas.Canvas(str(PDF),pagesize=(W,H));c.setTitle('Quipus A1 - 2000 mAh schematic review');c.setAuthor('Quipus')
PAGE=0
GREEN='#135F4B'; DARK='#17302C'; GREY='#586B65'; LIGHT='#EDF4F0'; AMBER='#915621'
def txt(x,y,s,size=11,color=DARK,bold=False):
    c.setFillColor(HexColor(color));c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawString(x,y,ascii_text(s))
def wrap(x,y,s,width=85,size=11,leading=16,color=DARK):
    for line in textwrap.wrap(ascii_text(s),width):txt(x,y,line,size,color);y-=leading
    return y
def begin(title,sub=''):
    global PAGE
    PAGE+=1;c.bookmarkPage(str(PAGE));c.addOutlineEntry(title,str(PAGE),level=0)
    txt(36,H-30,'QUIPUS  /  HARDWARE ENGINEERING  /  A1',10,GREEN,True)
    txt(36,H-63,title,25,DARK,True);txt(36,H-85,sub,10,GREY)
    c.setStrokeColor(HexColor('#CCDCD4'));c.line(36,35,W-36,35)
    txt(36,22,'29 SEP 2026  |  REVIEW DRAFT - NOT FOR FABRICATION  |  UNMEASURED POWER BUDGET',8,GREY)
    txt(W-56,22,str(PAGE),8,GREY)
def table(headers,rows,y,widths,lineheight=31):
    for k,row in enumerate([headers]+rows):
        x=36;h=lineheight
        c.setFillColor(HexColor(GREEN if k==0 else (LIGHT if k%2 else '#FFFFFF')));c.rect(x,y-h,sum(widths),h,stroke=0,fill=1)
        for j,value in enumerate(row):
            txt(x+8,y-h/2-3,value,10,'#FFFFFF' if k==0 else DARK,k==0);x+=widths[j]
        y-=h
    return y-20
def box(x,y,w,h,title,body):
    c.setFillColor(HexColor(LIGHT));c.setStrokeColor(HexColor('#AAC6B8'));c.roundRect(x,y,w,h,8,stroke=1,fill=1)
    txt(x+14,y+h-24,title,13,GREEN,True);wrap(x+14,y+h-45,body,int(w/6.1),10,14)

begin('A smaller Quipus recorder','Editable electrical design, connection tables and a proposed physical arrangement.')
txt(36,H-140,'2,000 mAh / replaceable protected LiPo / offline recording first',21,GREEN,True)
wrap(36,H-181,'This revision is designed around two onboard microphones, a digital expansion port, one speaker, microSD and a small display. Power, Start, Stop, Up and Down are physical controls. USB-C supplies charging and programming.',126,14,22)
box(36,360,350,170,'Power and battery','1S LiPo, 3.7 V nominal / 4.2 V charge. JST PH battery connector plus separate NTC. Hardware power-button controller; charger remains active when recording electronics are off.')
box(408,360,350,170,'Controller and storage','ESP32-S3-WROOM-1-N16R8. Native USB, microSD in 1-bit mode, a 1.3-inch SPI display and RTC. Start has a direct wake pin; three menu buttons use an I2C expander.')
box(780,360,374,170,'Audio','Two IM69D128S PDM microphones. Keyed short-wire digital expansion. MAX98357A class-D amplifier with a separate differential speaker output. Keep microphones clear of speaker vibration.')
wrap(36,308,'Release status: circuit review draft. Exact PCB footprints, copper routing, native ERC/DRC and hardware qualification are not complete. This package is for design review; it must not be sent straight to fabrication.',130,13,20,AMBER)
wrap(36,235,'Battery life: six hours of recording is the first measured acceptance goal. A week of 5-6 recording hours each day is not promised with 2,000 mAh. Larger packs need matching polarity, temperature limits, current capability and gauge settings.',132,12,19)
txt(36,118,f'{len(PARTS)} circuit entries / {len(NETS)} named nets / {len(SHEETS)} editable schematic sheets',14,GREEN,True)
c.showPage()

model_preview=OUT/'model/Quipus-A1-placement-preview.png'
if model_preview.exists():
    begin('3D placement study','STEP assembly included. Body envelopes are provisional; this is not a model of a routed or manufactured PCB.')
    c.drawImage(str(model_preview),36,90,width=W-72,height=H-200,preserveAspectRatio=True,anchor='c',mask='auto')
    c.showPage()

begin('Power architecture','Different rails serve the charger, low-power controls and recording electronics.')
box(42,580,260,105,'USB-C 5 V','TUSB320 CC detection sets source-current entitlement. Native USB data goes to the ESP32-S3.')
box(360,580,260,105,'BQ24074 power path','USB input limit selected in hardware; about 445 mA nominal battery charging. SYS_RAW powers the system path.')
box(720,580,390,105,'Battery and temperature','Protected 1S 2,000 mAh pack. Gauge measures battery current. Separate pack-contact thermistor required; do not bypass it.')
box(42,365,330,135,'Always-on domain','Power button controller, source detection, fuel gauge and RTC backup remain available. Off is very low power, not a physically disconnected battery.')
box(430,365,330,135,'Switched domain','LTC2951 controls the load switch. TPS63802 produces 3.3 V for ESP32-S3, mics, SD and display. MAIN_RAW supplies the audio amplifier.')
box(820,365,290,135,'Shutdown sequence','Hold power about 0.7 s -> interrupt -> stop capture -> finalize WAV -> sync queue -> mute -> power cut. Hardware timeout is the fallback.')
for x1,y1,x2,y2 in [(302,632,360,632),(620,632,720,632),(490,580,595,500),(490,580,207,500),(760,430,820,430)]:
    c.setStrokeColor(HexColor(GREEN));c.setLineWidth(1.4);c.line(x1,y1,x2,y2)
wrap(42,300,'USB default mode is limited until the source permits more current. An ordinary USB socket and a USB-C high-current charger are not interchangeable. Off-state charging must work without the ESP32 running; USB suspend and enumeration are explicit firmware responsibilities.',144,12,19)
wrap(42,216,'The BQ24074 thermistor protection window must be checked against the purchased pack: its usual 0-50 C nominal window does not automatically satisfy a pack rated for charging only at 0-45 C. Pack/NTC selection and thermal qualification remain release blockers.',140,12,19,AMBER)
c.showPage()

begin('Capacity, current and storage','These are planning calculations, not observed runtime or measured audio power.')
budget=calculate()
y=table(['Average battery current*','Recording hours','Days at 6 h recording'],[[f'{v["battery_ma"]} mA',str(v['recording_hours']),str(v['six_hour_days'])] for v in budget['runtime_scenarios']],H-125,[310,220,280])
wrap(36,y,'*All loads and conversion losses are included in these hypothetical battery-side currents. Calculation: 2,000 mAh x 0.8 reserve allowance / average current. Idle time, uploads and voice playback reduce the working-day result.',145,11,17)
y=table(['Electrical design check','Planning value','Implication'],[
 ['Battery energy','3.7 V x 2 Ah = 7.4 Wh','Capacity is not output power'],
 ['Week of 5-6 h/day','35-42 h recording','Requires <=38-46 mA before idle'],
 ['Charger nominal current','445 mA','Capacity/current = 4.49 h, before CV tail'],
 ['3.3 V rail peak allowance','0.85 A','Validate converter at lowest loaded input'],
 ['Main-switch peak estimate','1.45 A at 3.0 V input / 85% efficiency','Includes 0.35 A speaker allowance; derate below this input'],
 ['Stereo PCM16 at 16 kHz','64,000 bytes/s','1.3824 GB for six hours'],
 ['Mono PCM16 at 16 kHz','32,000 bytes/s','0.6912 GB for six hours'],
 ['Classic WAV / FAT32 limit','About 18.64 h per stereo file','Segment audio; retain one meeting manifest'],
],y-75,[310,300,505],32)
wrap(36,y,'Battery/connector current ratings and actual voltage drops must be checked together. SD write peaks, radio bursts and speaker playback can overlap; average current alone cannot size the power circuit.',143,11,17,AMBER)
c.showPage()

begin('Power component calculations','Values are derived from manufacturer limits; routing, component bias and temperature still require validation.')
pc=RAW['Power']['calculations']
y=table(['Circuit / setting','Nominal result','Tolerance or consequence'],[
 ['BQ24074 RISET = 2.00k 1%',f'{pc["charge_current_nominal_A"]*1000:.0f} mA charge',f'{pc["charge_current_max_A"]*1000:.1f} mA maximum using specified gain tolerance'],
 ['BQ24074 RILIM = 1.24k 1%',f'{pc["input_current_high_nominal_A"]:.3f} A USB input',f'{pc["input_current_high_max_A"]:.3f} A maximum; only with >=1.5 A CC advertisement'],
 ['TPS63802 FB = 511k / 91k',f'{pc["voltage_nominal_V"]:.4f} V rail',f'{pc["voltage_min_V"]:.4f} to {pc["voltage_max_V"]:.4f} V calculated tolerance band'],
 ['LTC2951 OFFT = 100nF',f'{pc["off_press_typ_ms"]:.0f} ms press qualification','Button is momentary; press timing is not a power-current rating'],
 ['LTC2951 KILLT = 1uF',f'{pc["poweroff_timeout_typ_ms"]/1000:.2f} s typical shutdown grace','Verify capacitor tolerance/leakage and SD flush worst case'],
 ['BQ24074 TMR = 68k',f'{pc["fastcharge_safety_typ_h"]:.2f} h typical timer',f'{pc["fastcharge_safety_min_h"]:.2f} to {pc["fastcharge_safety_max_h"]:.2f} h calculated; review after capacity change'],
 ['Gauge shunt = 0.010 ohm','20 mV / 40 mW at 2 A','Use 1%, low-TCR Kelvin connections; selected resistor rated 0.25 W'],
],H-125,[305,300,510],34)
y=table(['USB state','EN1 / EN2','Allowed charger input mode'],[
 ['Default source, not enumerated','0 / 0','100 mA mode'],
 ['Default source, USB configured for 500 mA','1 / 0','500 mA mode'],
 ['Type-C source advertises >=1.5 A','0 / 1','RILIM mode, about 1.30 A nominal'],
 ['USB suspend requested','1 / 1','Suspend mode; verify actual total connector current'],
],y-5,[420,160,535],30)
wrap(36,y,'Charge-path heating example: (5.0 - 3.2) V x 0.445 A = 0.80 W before additional system-path losses. Thermal copper and enclosure temperature matter even at this moderate charge current. No thermal rise or loop stability is claimed from these calculations.',145,11,17,AMBER)
c.showPage()

begin('Proposed physical arrangement','65 x 105 mm placement study, not an approved board outline or a footprint drawing.')
BX,BY,S=80,100,5.1
c.setFillColor(HexColor('#DCEDE4'));c.setStrokeColor(HexColor(GREEN));c.roundRect(BX,BY,65*S,105*S,10,stroke=1,fill=1)
def place(x,y,w,h,label,color='#FFFFFF'):
    # x/y from upper-left board corner in millimetres.
    xx=BX+x*S;yy=BY+(105-y-h)*S
    c.setFillColor(HexColor(color));c.setStrokeColor(HexColor(GREEN));c.rect(xx,yy,w*S,h*S,stroke=1,fill=1)
    txt(xx+4,yy+h*S/2-3,label,8,GREEN,True)
place(3,3,12,8,'MIC A');place(50,3,12,8,'MIC B')
place(23.5,0,18,25.5,'ESP / REAR','#C1DAD0')
place(10,34.5,45,31,'1.3 in DISPLAY')
place(58,30,7,20,'SD')
place(49,23,16,6,'EXT MIC')
place(57,73,8,7,'SPK')
place(0,79,8,7,'PWR')
for x,y,l in [(17,78,'START'),(38,78,'STOP'),(17,91,'UP'),(38,91,'DOWN')]:place(x,y,11,7,l)
place(28,98,9,7,'USB-C')
for x,y in [(5,19),(60,19),(5,99),(60,99)]:
    c.setFillColor(HexColor('#FFFFFF'));c.circle(BX+x*S,BY+(105-y)*S,1.4*S,stroke=1,fill=1)
txt(BX,BY-25,'TOP / USER-FACING SIDE',11,GREEN,True)
y=H-147
for title,body in [
 ('Microphones face the user','Bottom-port MEMS bodies mount on the rear, with individual PCB sound holes opening toward the front/top case surface. Keep an isolated acoustic path to each mic; no foam or adhesive across the port.'),
 ('Antenna clearance','ESP module antenna is at the upper edge. Preserve its manufacturer keepout on every layer and in the enclosure. No battery, metal screen frame or cabling may invade that space.'),
 ('Side access','SD card must be removable from the side. Speaker is external to the PCB and sits behind a side-facing grille. Keep the speaker cavity separate from microphone inlet channels.'),
 ('Battery and service','Battery sits behind the lower board with insulated clearance. Its exact size is not selected. Leave a wire route to JST battery/NTC and speaker connectors; preserve service access to BOOT/RESET.'),
 ('Four-layer construction','Signal/components / continuous ground / power and slow signals / signal/components. The drawing is a zoning proposal only: final dimensions follow footprints, routing and battery fit.')]:
    txt(480,y,title,14,GREEN,True);y=wrap(480,y-22,body,91,11,17)-30
c.showPage()

connectors=[p for p in PARTS if p['ref'].startswith('J')]
for i in range(0,len(connectors),4):
    begin('Connector and harness definitions', 'Use the numbered contact in the selected manufacturer drawing; do not infer polarity from wire colour.')
    y=H-120
    for p in connectors[i:i+4]:
        txt(36,y,p['ref']+' / '+p['value'],14,GREEN,True);y-=22
        pins='; '.join(pin['number']+': '+pin['name']+' -> '+str(pin['net'] or 'NC') for pin in p['pins'])
        y=wrap(36,y,pins,153,11,16)-9
        y=wrap(36,y,p['package']+' | '+p['note'],160,10,15,GREY)-28
    c.showPage()

begin('Firmware contract and validation','Circuit capability does not mean the existing firmware already supports the new board.')
y=H-125
for title,body in [
 ('Capture without a network','I2S0 receives two PDM microphone slots. Start at 16 kHz PCM / 2.048 MHz PDM clock. Preserve both channels during evaluation; mixing them blindly is not beamforming. SD files and meeting IDs must survive reboot.'),
 ('Avoid bus and pin conflicts','I2S1 supplies speaker playback. SPI serves the display; SD uses the dedicated 1-bit bus. GPIO35-37 are reserved for the N16R8 module PSRAM. Native USB uses GPIO19/20. Do not reuse strapping pins for normal buttons.'),
 ('Power and UI','Set the gauge capacity/profile for the fitted cell; read real charger status. Keep Wi-Fi and backlight off during offline capture when possible. Only show a time-to-full estimate while charging and after current measurements are stable.'),
 ('Time and shutdown','Provision RTC backup settings and disable its trickle charging. Battery removal can lose time; mark timestamps uncertain until resynchronised. Service the shutdown interrupt, close files and release power within the hardware timeout.'),
 ('Measurements that decide release','Scope power rails during simultaneous SD writes, Wi-Fi and speaker playback. Measure charging temperature, current limits, off-state current and six-hour capture. Interrupt power during file updates and validate queue recovery.'),
 ('CAD checks still outstanding','Generated source is structurally checked. Native KiCad/ERC and EasyEDA import have not been run here. Exact footprints, routing, DRC, acoustic stackup, USB signal integrity and prototype approval are required before fabrication.')]:
    txt(36,y,title,14,GREEN,True);y=wrap(36,y-24,body,145,12,18)-29
c.showPage()

for s in SHEETS:
    begin(f'Circuit {s["page"]-1:02d} / {s["group"]}','Same global label = same electrical net. Pin numbers are physical package contacts. NC is intentional no-connect.')
    for v in s['placed']:
        p,x,y,h=v['part'],v['x'],v['y']+1,v['h']; px=x*MM;py=H-y*MM
        c.setStrokeColor(HexColor(GREEN));c.setFillColor(HexColor(LIGHT));c.setLineWidth(.6)
        c.rect(px-19.05*MM,py-h*MM/2,38.1*MM,h*MM,stroke=1,fill=1)
        txt(px-19.05*MM,py+h*MM/2+14,p['ref'],9,GREEN,True)
        txt(px-19.05*MM,py+h*MM/2+4,p['value'],6.7,DARK)
        for n,pin in enumerate(p['pins']):
            yy=py+((len(p['pins'])-1)*1.27-n*2.54)*MM
            c.line(px-24.13*MM,yy,px-19.05*MM,yy)
            txt(px-18.0*MM,yy-2,pin['name'],6.2)
            txt(px-23.8*MM,yy+2,pin['number'],5.2,GREY)
            c.setFillColor(HexColor(GREEN));c.setFont('Helvetica',6.5)
            c.drawRightString(px-25.3*MM,yy-2,ascii_text(pin['net'] or 'NC'))
    c.showPage()

sources=sorted({p.get('source','') for p in PARTS if p.get('source','').startswith('http')})
for i in range(0,len(sources),14):
    begin('Manufacturer references','Circuit domain notes retain assumptions and selection details. Datasheets take precedence over drawings in this draft.')
    y=H-125
    for j,url in enumerate(sources[i:i+14],start=i+1):
        y=wrap(36,y,f'{j:02d}. '+url,145,10,14)-17
    c.showPage()
c.save()

for filename in ['README.md','power-design.md','audio-design.md','controller-design.md']:
    p=ROOT/filename
    if p.exists(): (OUT/filename).write_text(p.read_text(encoding='utf-8'),encoding='utf-8')

# Structural verification is deliberately narrower than native ERC.
assert len({p['ref'] for p in PARTS})==len(PARTS),'Duplicate reference'
for p in PARTS:
    assert len({v['number'] for v in p['pins']})==len(p['pins']), 'Duplicate pin: '+p['ref']
    assert all(v['net'] is None or (isinstance(v['net'],str) and v['net']) for v in p['pins'])
for path in CAD.glob('*.kicad_sch'):
    # Count balanced parentheses outside escaped strings.
    stripped=re.sub(r'"(?:\\.|[^"\\])*"','""',path.read_text(encoding='utf-8'))
    level=0
    for ch in stripped:
        level += (ch=='(')-(ch==')')
        assert level>=0, path.name
    assert level==0,path.name
report={'components':len(PARTS),'nets':len(NETS),'sheets':len(SHEETS),'pdf_pages':PAGE,'structural_checks':'passed','native_erc':'not run - KiCad unavailable','easyeda_import':'not tested','footprints':'not released','routing':'not performed','single_contact_nets':{k:v for k,v in NETS.items() if len(v)<2}}
(OUT/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
print(PDF)
