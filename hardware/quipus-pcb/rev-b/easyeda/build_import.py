"""Build the physical PCB placement and self-contained EasyEDA import carrier.

No pretend copper routes or fabrication exports are generated. The schematic
and every numbered copper pad are tied to the same canonical source netlist.
"""
from pathlib import Path
import json, shutil, sys, zipfile, warnings, math
from collections import Counter
import uuid, copy, hashlib, csv
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"rev-a/easyeda"))

from kicad_format import parse, dumps, children, child, quote, load_footprint, extract_keepouts

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SOURCE = REPO / 'output/pcb/Quipus-B1/schematics'
OUT = REPO / 'output/pcb/Quipus-B1-EasyEDA'
OUT.mkdir(parents=True, exist_ok=True)
FP_DIR = OUT / 'Quipus.pretty'
FP_DIR.mkdir(exist_ok=True)
parts = json.loads((REPO/'output/pcb/Quipus-B1/connections.json').read_text())['components']
by_ref = {p['ref']: p for p in parts}
assignments = {}
A1 = REPO/'hardware/quipus-pcb/rev-a/easyeda'
for domain in ['power','controller']:
    for entry in json.loads((A1/f'footprints-{domain}.json').read_text())['components']:
        assignments[entry['ref']] = entry
for entry in json.loads((HERE.parent/'audio-footprints/assignments.json').read_text())['components']:
    assignments[entry['ref']] = entry
assignments['SW1'] = copy.deepcopy(assignments['SW301'])
assignments['SW1'].update(ref='SW1',value='B3U-1000P')
micpath=HERE/'footprints/Quipus_Infineon_IM69D128S_QuarterGround.kicad_mod'
assert micpath.exists(), 'Quarter annulus footprint required; do not import original ring'
for ref in ['U20','U21']:
    assignments[ref]['footprint_file']=micpath.relative_to(REPO).as_posix()
    assignments[ref]['library_name']='Quipus:'+micpath.stem
    assignments[ref]['sha256']=hashlib.sha256(micpath.read_bytes()).hexdigest()
for part in parts:
    if part['ref']=='SW1':part['value']='B3U-1000P'
    if part['ref']=='J3':part['value']='SM03B-SRSS-TB(LF)(SN)'
(HERE/'assignments.json').write_text(json.dumps({'components':list(assignments.values())},indent=2))
assert set(assignments) == set(by_ref)
placement = json.loads((HERE/'placement.json').read_text())
positions = placement['placements']
assert set(positions) == set(by_ref), {'missing': sorted(set(by_ref)-set(positions)), 'extra': sorted(set(positions)-set(by_ref))}
nets = sorted({pin['net'] for p in parts for pin in p['pins'] if pin['net'] is not None})
net_id = {name:i+1 for i,name in enumerate(nets)}

# Embedded symbols and global labels remain untouched. Assign physical footprint
# properties to placed symbol instances, not only their library definitions.
instance_paths = {}
flat_id='d2c431ed-85f7-50ef-9f97-4d16a05f7fb5'
flat=['kicad_sch',['version','20230121'],['generator',quote('quipus')],['uuid',quote(flat_id)],
      ['paper',quote('User'),'1260','1485'],['lib_symbols']]
flat_symbols=child(flat,'lib_symbols')
def offset_coordinates(node,dx,dy):
    # Only placed objects enter this function. Library symbol geometry remains
    # local to the symbol and must never receive a page offset.
    if not isinstance(node,list) or not node:return
    if node[0] in ['at','xy'] and len(node)>=3:
        node[1]=str(round(float(node[1])+dx,6));node[2]=str(round(float(node[2])+dy,6))
    for item in node[1:]:
        if isinstance(item,list):offset_coordinates(item,dx,dy)
sources=sorted(s for s in SOURCE.glob('*.kicad_sch') if s.name!='Quipus-B1.kicad_sch')
for index,source in enumerate(sources):
    tree = parse(source.read_text())
    dx=(index%3)*420;dy=(index//3)*297
    flat_symbols.extend(children(child(tree,'lib_symbols'),'symbol'))
    for symbol in children(tree,'symbol'):
        props = {str(p[1]):p for p in children(symbol,'property')}
        ref = str(props['Reference'][2])
        props['Value'][2]=quote(by_ref[ref]['value'])
        ident = 'Quipus:'+Path(assignments[ref]['footprint_file']).stem
        props['Footprint'][2] = quote(ident)
        instance = child(symbol,'instances')
        project = child(instance,'project')
        path = child(project,'path')
        path[1]=quote('/'+flat_id)
        instance_paths[ref] = '/'+flat_id+'/'+str(child(symbol,'uuid')[1])
    for item in tree[1:]:
        if not isinstance(item,list) or item[0] not in ['symbol','wire','junction','no_connect','global_label','label','text','polyline']:
            continue
        if item[0]=='global_label':
            # A single flat electrical sheet requires ordinary same-name labels.
            # EasyEDA converts KiCad global_label into reuse-block netports,
            # which incorrectly require explicit block pins in this import.
            item[0]='label'
            item[:]=[v for v in item if not(isinstance(v,list) and v[0] in ['shape','property'])]
        offset_coordinates(item,dx,dy)
        flat.append(item)
flat.append(['sheet_instances',['path',quote('/'),['page',quote('1')]]])
for old in OUT.glob('*.kicad_sch'):old.unlink()
(OUT/'Quipus-B1.kicad_sch').write_text(dumps(flat)+'\n',encoding='utf-8')
assert set(instance_paths) == set(by_ref)
shutil.copyfile(SOURCE/'Quipus-B1.kicad_pro', OUT/'Quipus-B1.kicad_pro')
(OUT/'fp-lib-table').write_text('(fp_lib_table (lib (name "Quipus") (type "KiCad") (uri "${KIPRJMOD}/Quipus.pretty") (options "") (descr "Quipus manufacturer-reviewed footprint geometry")))\n')

board = ['kicad_pcb', ['version','20171130'], ['host','pcbnew',quote('5.1')],
 ['general',['thickness','1.6']], ['page','A4'],
 ['layers',['0','F.Cu','signal'],['1','In1.Cu','power'],['2','In2.Cu','power'],['31','B.Cu','signal'],
  ['32','B.Adhes','user'],['33','F.Adhes','user'],['34','B.Paste','user'],['35','F.Paste','user'],
  ['36','B.SilkS','user'],['37','F.SilkS','user'],['38','B.Mask','user'],['39','F.Mask','user'],
  ['40','Dwgs.User','user'],['41','Cmts.User','user'],['42','Eco1.User','user'],['43','Eco2.User','user'],
  ['44','Edge.Cuts','user'],['46','B.CrtYd','user'],['47','F.CrtYd','user'],['48','B.Fab','user'],['49','F.Fab','user']],
 ['setup',['last_trace_width','0.2'],['trace_clearance','0.15'],['zone_clearance','0.2'],['zone_45_only','no'],
  ['trace_min','0.15'],['segment_width','0.05'],['edge_width','0.05'],['via_size','0.6'],['via_drill','0.3'],
  ['via_min_size','0.5'],['via_min_drill','0.25'],['uvia_size','0.3'],['uvia_drill','0.1'],
  ['uvias_allowed','no'],['uvia_min_size','0.2'],['uvia_min_drill','0.1'],
  ['pcb_text_width','0.15'],['pcb_text_size','1','1'],['pad_size','1.524','1.524'],['pad_drill','0.762'],
  ['pad_to_mask_clearance','0.05'],['aux_axis_origin','0','0'],['visible_elements','FFFFFFFF']],
 ['net','0',quote('')], *[['net',str(net_id[n]),quote(n)] for n in nets],
 ['net_class',quote('Default'),quote('Engineering rule draft'),['clearance','0.15'],['trace_width','0.2'],
  ['via_dia','0.6'],['via_drill','0.3'],['uvia_dia','0.3'],['uvia_drill','0.1'],
  *[['add_net',quote(n)] for n in nets]]]

carrier_warnings=[]
for p in parts:
    ref=p['ref']; assignment=assignments[ref]; x,y,angle,side=positions[ref]
    original=REPO/assignment['footprint_file']
    fid='Quipus:'+original.stem
    # Source physical numbers have already been normalized for A/B and USB
    # combined contacts. Additional mechanical hold-down lands stay unnetted.
    mapping=assignment.get('pad_mapping',{})
    pad_nets={mapping.get(pin['number'],pin['number']):(net_id[pin['net']],pin['net'])
              for pin in p['pins'] if pin['net'] is not None}
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        module=parse(load_footprint(original,ref,p['value'],x,y,angle,side,pad_nets,fid,instance_paths[ref]))
        carrier_warnings.extend(str(w.message) for w in caught)
    # Silkscreen identifiers are compact and readable; value remains hidden on
    # the fabrication layer. Full MPN remains in schematic and BOM.
    for text in children(module,'fp_text'):
        if text[1]=='value' and 'hide' not in text: text.append('hide')
        if text[1]=='reference':
            effects=child(text,'effects');font=child(effects,'font')
            child(font,'size')[:]=['size','0.7','0.7']
            child(font,'thickness')[:]=['thickness','0.12']
    board.append(module)
    # Write reusable libraries with the exact same normalized physical lands.
    library=parse(load_footprint(original,'REF**',original.stem,0,0,0,'F',{},fid,None))
    library[:]=[v for v in library if not (isinstance(v,list) and v and v[0] in ['tstamp','tedit','path','at'])]
    (FP_DIR/(original.stem+'.kicad_mod')).write_text(dumps(library)+'\n')
    for keepout in extract_keepouts(original,x,y,angle,side):
        layers=['F.Cu','In1.Cu','In2.Cu','B.Cu'] if ref=='U1' else keepout['layers']
        for layer in layers:
            for points in keepout['polygons']:
                board.append(['zone',['net','0'],['net_name',quote('')],['layer',layer],['hatch','edge','0.5'],
                  ['connect_pads',['clearance','0.2']],['min_thickness','0.1'],
                  ['keepout',*[[name,keepout['rules'].get(name,'not_allowed')] for name in ['tracks','vias','copperpour']]],
                  ['fill',['thermal_gap','0.3'],['thermal_bridge_width','0.3']],
                  ['polygon',['pts',*[['xy',str(round(px,6)),str(round(py,6))] for px,py in points]]]])

# The central notch leaves the module antenna above air, instead of FR4.
outline=placement['outline_mm']
for a,b in zip(outline,outline[1:]+outline[:1]):
    board.append(['gr_line',['start',*map(str,a)],['end',*map(str,b)],['layer','Edge.Cuts'],['width','0.05']])
for i,(x,y) in enumerate(placement['mounting_holes'],1):
    board.append(['module',quote('MountingHole_2.8mm'),['layer','F.Cu'],['at',str(x),str(y)],
      ['fp_text','reference',quote('H'+str(i)),['at','0','3'],['layer','F.SilkS'],['effects',['font',['size','0.7','0.7'],['thickness','0.12']]]],
      ['pad',quote(''),'np_thru_hole','circle',['at','0','0'],['size','2.8','2.8'],['drill','2.8'],['layers','*.Cu','*.Mask']],
      ['fp_circle',['center','0','0'],['end','2.75','0'],['layer','F.CrtYd'],['width','0.05']]])
def text(value,x,y,size=1,layer='F.SilkS'):
    board.append(['gr_text',quote(value),['at',str(x),str(y)],['layer',layer],['effects',['font',['size',str(size),str(size)],['thickness','0.15']]]])
text('QUIPUS B1',32.5,9,1.2)
text('PLACEMENT DRAFT - ROUTING REQUIRED',32.5,24,0.65,'Dwgs.User')
for label,x,y in [('POWER',16,24.5),('START',32.5,24.5),('STOP',49,24.5),('VOL-',22,76),('VOL+',43,76),('USB-C',32.5,116)]: text(label,x,y,0.7)
text('2 PDM + 2 WIRED MIC / TDM ADC',32.5,15,0.85,'Dwgs.User')
screen=placement['screen_envelope'];a=[screen['x'],screen['y']];b=[a[0]+screen['width'],a[1]+screen['height']]
for p,q in zip([a,[b[0],a[1]],b,[a[0],b[1]]],[[b[0],a[1]],b,[a[0],b[1]],a]):
    board.append(['gr_line',['start',*map(str,p)],['end',*map(str,q)],['layer','Dwgs.User'],['width','0.12']])
text('45 x 31 mm LCD / FRONT',32.5,50,1,'Dwgs.User')
sp=placement['front_speaker_envelope']; sx,sy,sw,sh=sp['x'],sp['y'],sp['width'],sp['height']
for a,b in [([sx,sy],[sx+sw,sy]),([sx+sw,sy],[sx+sw,sy+sh]),([sx+sw,sy+sh],[sx,sy+sh]),([sx,sy+sh],[sx,sy])]:
    board.append(['gr_line',['start',*map(str,a)],['end',*map(str,b)],['layer','Dwgs.User'],['width','0.12']])
text('41 x 29 mm FRONT SPEAKER',32.5,96,0.8,'Dwgs.User')
text('MIC A',7,80,0.7,'B.SilkS');text('MIC B',58,80,0.7,'B.SilkS')

(OUT/'Quipus-B1.kicad_pcb').write_text(dumps(board)+'\n',encoding='utf-8')
manifest={'status':'Engineering PCB placement; unrouted, not fabrication ready','components':len(parts),'nets':len(nets),
 'physical_footprint_count':len(list(FP_DIR.glob('*.kicad_mod'))),'board_mm':[65,125,1.6],
 'copper_layers':4,'antenna_notch_mm':[22.5,0,20,6.7], 'schematic_project':'Quipus-B1',
 'schematic_layout':'Thirteen source panels on one flat electrical sheet; local net labels avoid incorrect reuse-block netport conversion',
 'tracks':0,'native_erc':'pending EasyEDA check','native_drc':'pending EasyEDA check',
 'importer_geometry_checks':['Four-quarter GND mic annulus/NPTH/paste','USB shared contacts','Gauge H-shaped EP','SD detector A/B','All-layer RF keepout'],
 'format_warnings':list(dict.fromkeys(carrier_warnings))}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
shutil.copyfile(HERE/'placement.json',OUT/'placement.json')
shutil.copyfile(REPO/'output/pcb/Quipus-B1/pin-connections.csv',OUT/'pin-connections.csv')
shutil.copyfile(REPO/'output/pcb/Quipus-B1/bill-of-materials.csv',OUT/'bill-of-materials.csv')
with (OUT/'bill-of-materials.csv').open(newline='', encoding='utf-8-sig') as f:
    reader=csv.DictReader(f); columns=reader.fieldnames; bom=list(reader)
for row in bom:
    if row['Reference']=='SW1':
        row.update({'Manufacturer part candidate':'B3U-1000P','Package':'Omron B3U-1000P 3.0 x 2.5 mm SMD; custom manufacturer land',
          'Purchase status':'Footprint selected; case actuator/sample verification pending',
          'Primary source':'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3u.pdf'})
    if row['Reference']=='J3':
        row.update({'Manufacturer part candidate':'SM03B-SRSS-TB(LF)(SN)','Package':'JST SH 3-pin 1.0 mm side-entry SMD',
          'Purchase status':'Footprint selected; mating harness/NTC sample verification pending',
          'Primary source':'https://www.jst-mfg.com/product/pdf/eng/eSH.pdf'})
with (OUT/'bill-of-materials.csv').open('w', newline='', encoding='utf-8-sig') as f:
    writer=csv.DictWriter(f,fieldnames=columns);writer.writeheader();writer.writerows(bom)
shutil.copyfile(HERE/'README.md',OUT/'README.md')
if (HERE/'placement-packing-audit.json').exists():
    shutil.copyfile(HERE/'placement-packing-audit.json',OUT/'placement-packing-audit.json')
shutil.copyfile(HERE/'assignments.json',OUT/'footprint-assignments.json')
archive=OUT.parent/'Quipus-B1-EasyEDA-import.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for f in OUT.rglob('*'):
        if f.is_file():z.write(f,f.relative_to(OUT).as_posix())
print(json.dumps(manifest,indent=2));print(archive)
