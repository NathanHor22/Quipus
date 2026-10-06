"""Pack the actual Rev B footprint courtyards; independent of copper routing.

This writes placement.json and a geometric packing audit, never a routed board.
Uses retained A1 downleveler/geometry functions with all exact assigned lands.
"""
from pathlib import Path
import json, sys, math, warnings, itertools, hashlib

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
REPO=ROOT.parents[2]
OLD=REPO/'hardware/quipus-pcb/rev-a/easyeda'
sys.path.insert(0,str(OLD))
from kicad_format import parse, children, child_values, load_footprint
from validate_placement import outline_polygons, world, pad_polygon, overlaps, bounds, inside, rectangle

PLAN=json.loads((ROOT/'pcb-placement-plan.json').read_text())
PARTS={}
for f in ['power-circuit.json','controller-circuit.json','audio-circuit.json']:
    d=json.loads((ROOT/f).read_text())
    for p in d.get('components',d.get('parts',[])): PARTS[p['ref']]=p
ASSIGN={}
for f in ['footprints-power.json','footprints-controller.json']:
    for p in json.loads((OLD/f).read_text())['components']:
        if p['ref'] in PARTS: ASSIGN[p['ref']]=p
for p in json.loads((ROOT/'audio-footprints/assignments.json').read_text())['components']: ASSIGN[p['ref']]=p
ASSIGN['SW1']={**ASSIGN['SW301'],'ref':'SW1'}
assert set(ASSIGN)==set(PARTS) and len(PARTS)==180
OLDPOS=json.loads((OLD/'placement.json').read_text())['placements']
ANCHORS=dict(PLAN['candidate_anchor_placements'])
# The plastic body front is at the board edge (with a 0.30mm recess to leave
# 0.60mm nominal copper margin). The mating bushing projects 3.70mm beyond it.
ANCHORS.update({'J8':[1.5,74.1,90,'B'],'J9':[63.5,75.9,270,'B']})
GROUP={r:g for g,d in PLAN['region_assignments'].items() for r in d['references']}
OUTLINE=PLAN['outline_mm']; WIDTH=65;HEIGHT=125
F_KEEP=[rectangle(32.5,50,45,31), rectangle(32.5,96.5,41,29)]
RF=[(8.5,-14.75),(56.5,-14.75),(56.5,6.25),(8.5,6.25)]
HEADS=[[(x+2.75*math.cos(i*math.pi/24),y+2.75*math.sin(i*math.pi/24)) for i in range(48)] for x,y in PLAN['mounting_holes_mm']]
EPS=1e-7
NPTH_BODY_CLEARANCE_MM=0.254
ALLOW_OUT={'U1','J1','J6','J8','J9'}
GEO={}
def geometry(ref,angle,side):
    key=(ref,angle,side)
    if key in GEO:return GEO[key]
    src=REPO/ASSIGN[ref]['footprint_file']
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        m=parse(load_footprint(src,ref,PARTS[ref]['value'],0,0,angle,side,{}))
    polys=[[world(p,[0,0,angle]) for p in poly] for poly in outline_polygons(m)]
    if not polys:raise ValueError(('No courtyard',ref,src))
    pads=[];holes=[]
    for pad in children(m,'pad'):
        if pad[2]=='np_thru_hole':
            # NPTHs exist physically through BOTH faces even though they have
            # no copper. Native EasyEDA's device-to-hole rule needs a 10mil
            # body margin; treating only plated pads as obstacles misses it.
            drill=child_values(pad,'drill',[])
            at=child_values(pad,'at');cx,cy=world(tuple(map(float,at[:2])),[0,0,angle])
            pa=float(at[2]) if len(at)>2 else angle
            if drill and drill[0]=='oval':
                w,h=map(float,drill[1:3])
                hp=rectangle(cx,cy,w+2*NPTH_BODY_CLEARANCE_MM,h+2*NPTH_BODY_CLEARANCE_MM,pa)
            else:
                diameter=float(drill[0]);segments=96
                radius=(diameter/2+NPTH_BODY_CLEARANCE_MM)/math.cos(math.pi/segments)
                hp=[(cx+radius*math.cos(2*math.pi*i/segments),cy+radius*math.sin(2*math.pi*i/segments)) for i in range(segments)]
            holes.append({'number':str(pad[1]),'clearance_mm':NPTH_BODY_CLEARANCE_MM,'poly':hp})
            continue
        if not any(str(l).endswith('.Cu') for l in child_values(pad,'layers',[])):continue
        pads.append({'number':str(pad[1]),'pth':pad[2]=='thru_hole','poly':pad_polygon(pad,[0,0,angle])})
    GEO[key]={'polys':polys,'pads':pads,'holes':holes}
    return GEO[key]

def move(poly,x,y):return [(a+x,b+y) for a,b in poly]
def placed(ref,x,y,a,s):
    g=geometry(ref,a,s)
    ps=[move(p,x,y) for p in g['polys']]
    pads=[{**p,'poly':move(p['poly'],x,y)} for p in g['pads']]
    holes=[{**p,'poly':move(p['poly'],x,y)} for p in g['holes']]
    all_shapes=ps+[p['poly'] for p in holes]
    return {'ref':ref,'x':x,'y':y,'angle':a,'side':s,'polys':ps,'pads':pads,'holes':holes,
            'bounds':(min(bounds(p)[0] for p in all_shapes),min(bounds(p)[1] for p in all_shapes),max(bounds(p)[2] for p in all_shapes),max(bounds(p)[3] for p in all_shapes))}

def bbover(a,b):return min(a[2],b[2])-max(a[0],b[0])>EPS and min(a[3],b[3])-max(a[1],b[1])>EPS
def distance_segment(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
    t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den))
    return math.dist(p,(a[0]+t*dx,a[1]+t*dy))

def invalid_static(q):
    r=q['ref'];ps=q['polys']
    if r not in ALLOW_OUT and any(not inside(p,OUTLINE,strict=False) for poly in ps for p in poly):return 'courtyard outside board'
    if r!='U1' and any(overlaps(p,RF) for p in ps):return 'RF keepout'
    if any(overlaps(p,h) for p in ps for h in HEADS):return 'mounting head'
    if q['side']=='F' and any(overlaps(p,k) for p in ps for k in F_KEEP):return 'front mechanical reservation'
    for pad in q['pads']:
        poly=pad['poly']
        if any(not inside(p,OUTLINE,strict=False) for p in poly):return 'copper outside board'
        if any(distance_segment(p,a,b)<0.5-EPS for p in poly for a,b in zip(OUTLINE,OUTLINE[1:]+OUTLINE[:1])):return 'copper edge below 0.5mm'
        if pad['pth'] and any(overlaps(poly,k) for k in F_KEEP):return 'PTH tail in front reservation'
    return None

def conflicts(q,objects):
    for o in objects:
        if not bbover(q['bounds'],o['bounds']):continue
        if any(overlaps(h['poly'],p) for h in q['holes'] for p in o['polys']):return o['ref']+' NPTH/body'
        if any(overlaps(h['poly'],p) for h in o['holes'] for p in q['polys']):return o['ref']+' NPTH/body'
        if q['side']==o['side']:
            if any(overlaps(p,t) for p in q['polys'] for t in o['polys']):return o['ref']
        else:
            if any(p['pth'] and overlaps(p['poly'],t) for p in q['pads'] for t in o['polys']):return o['ref']
            if any(p['pth'] and overlaps(p['poly'],t) for p in o['pads'] for t in q['polys']):return o['ref']
    return None

placed_objects=[];pos={};notes=[];failures=[]
AUDIT_EXISTING='--audit-existing' in sys.argv
if AUDIT_EXISTING:
    pos=json.loads((HERE/'placement.json').read_text())['placements']
    assert set(pos)==set(PARTS)
    placed_objects=[placed(r,*a) for r,a in pos.items()]
    if (HERE/'placement-packing-audit.json').exists():
        notes=json.loads((HERE/'placement-packing-audit.json').read_text()).get('anchor_adjustments',[])
def add(ref,target,fixed=False,max_radius=20):
    tx,ty,angle,side=target
    # Closest first; exact preferred anchor first. Use 0.5mm grid offsets and
    # both passive orientations. No side change is silently performed.
    offsets=[(0,0)] if fixed else [(i*.5,j*.5) for i in range(-2*max_radius,2*max_radius+1) for j in range(-2*max_radius,2*max_radius+1) if i*i+j*j<=4*max_radius*max_radius]
    offsets.sort(key=lambda p:p[0]*p[0]+p[1]*p[1])
    angles=[angle] if ref.startswith(('U','J','SW','L')) else list(dict.fromkeys([angle,(angle+90)%360]))
    for dx,dy in offsets:
        x,y=round(tx+dx,4),round(ty+dy,4)
        if not 0<x<WIDTH or not 0<y<HEIGHT:continue
        for a in angles:
            q=placed(ref,x,y,a,side)
            reason=invalid_static(q)
            if reason or conflicts(q,placed_objects):continue
            placed_objects.append(q);pos[ref]=[x,y,a,side]
            if dx or dy:notes.append({'ref':ref,'preferred':target,'actual':pos[ref],'movement_mm':round(math.hypot(dx,dy),3)})
            return True
    q=placed(ref,tx,ty,angle,side)
    failures.append({'ref':ref,'preferred':target,'reason':invalid_static(q) or conflicts(q,placed_objects) or 'no candidate in search radius'})
    return False

# Fix mechanical anchors first; other IC anchors may move locally for true
# courtyard clearance. Connector origins must never be reinterpreted as mouths.
FIXED=['U1','U20','U21','J1','J6','J8','J9','J7','SW1','SW301','SW302','SW303','SW304','SW300','SW305']
if not AUDIT_EXISTING:
    for r in FIXED:
        if not add(r,ANCHORS[r],True):raise RuntimeError(('Fixed anchor failed',failures[-1]))
    for r,t in ANCHORS.items():
        if r not in pos:add(r,t,max_radius=6)

def preferred(ref):
    group=GROUP[ref];reg=PLAN['region_assignments'][group];s=reg['side']
    # Retain the minimal native-DRC repair instead of proposing the previous
    # USB locating-hole collision again on a future deliberate repack.
    if ref=='R342':return [30.0,116.0,90,'B']
    if ref=='R221':return [44.6,11.55,0,'B']
    if ref=='R222':return [44.6,14.4,0,'B']
    # Retain local A1 placement relations to the nearest relocated anchor in
    # the same functional group, preserving analogue/power bypass proximity.
    if ref in OLDPOS:
        candidates=[r for r in reg['references'] if r in ANCHORS and r in OLDPOS]
        if candidates:
            nearest=min(candidates,key=lambda r:math.dist(OLDPOS[ref][:2],OLDPOS[r][:2]))
            base=OLDPOS[ref];old=OLDPOS[nearest];new=pos.get(nearest,ANCHORS[nearest])
            return [new[0]+base[0]-old[0],new[1]+base[1]-old[1],base[2],s]
        base=OLDPOS[ref]
        if group=='usb_data':return [base[0]+2.5,base[1]+25,base[2],s]
        if group=='button_filters':
            order=['R330','C331','R331','C332','R332','C333','R333','C334'].index(ref)
            return [16+order*4.3,31.6,0,s]
        return [base[0],base[1],base[2],s]
    x0,y0,x1,y1=reg['bounds_mm']
    # New ADC bypasses and analogue input groups start at their actual ADC /
    # connector neighbourhood, not in an unrelated generic part grid.
    if group=='adc_capture':return [33.5,42,0,s]
    if group=='mic_a':return [21,75,0,s]
    if group=='mic_b':return [44,75,0,s]
    if group=='mic_clock_filter':return [20,30,0,s]
    return [(x0+x1)/2,(y0+y1)/2,0,s]

# Larger footprints first; then local bypasses and gain/filter resistors.
remaining=[r for r in PARTS if r not in pos]
def area(ref):
    q=geometry(ref,0,preferred(ref)[3]);bb=[bounds(p) for p in q['polys']]
    return sum((b[2]-b[0])*(b[3]-b[1]) for b in bb)
remaining.sort(key=lambda r:(-area(r),r))
for r in remaining:add(r,preferred(r))

same=[];pth=[];npth=[];static=[]
for q in placed_objects:
    why=invalid_static(q)
    if why:static.append({'ref':q['ref'],'reason':why})
for a,b in itertools.combinations(placed_objects,2):
    if not bbover(a['bounds'],b['bounds']):continue
    if a['side']==b['side'] and any(overlaps(p,q) for p in a['polys'] for q in b['polys']):same.append([a['ref'],b['ref']])
    for h,o in [(a,b),(b,a)]:
        if any(overlaps(p['poly'],q) for p in h['holes'] for q in o['polys']):npth.append([h['ref'],o['ref']])
    if a['side']!=b['side']:
        for t,o in [(a,b),(b,a)]:
            if any(p['pth'] and overlaps(p['poly'],q) for p in t['pads'] for q in o['polys']):pth.append([t['ref'],o['ref']])
audit={'status':'Independent geometry check on actual assigned footprint shapes; not native CAD DRC','components_expected':180,'components_placed':len(pos),'unplaced':sorted(set(PARTS)-set(pos)),'same_face_courtyard_overlaps':same,'opposite_face_PTH_conflicts':pth,'NPTH_body_conflicts':npth,'NPTH_body_clearance_mm':NPTH_BODY_CLEARANCE_MM,'audit_existing_placements':AUDIT_EXISTING,'static_conflicts':static,'packing_failures':failures,'anchor_adjustments':notes,'native_drc_performed':False,'routing_performed':False,'input_footprint_files':{r:{'path':ASSIGN[r]['footprint_file'],'sha256':hashlib.sha256((REPO/ASSIGN[r]['footprint_file']).read_bytes()).hexdigest()} for r in ASSIGN}}
result={'status':'Engineering placement draft; independently packed courtyards; routing and native checks remain','units':'mm','board':PLAN['board'],'mounting_holes':PLAN['mounting_holes_mm'],'screen_envelope':PLAN['screen_envelope'],'front_speaker_envelope':PLAN['front_speaker_envelope'],'placements':pos,'outline_mm':OUTLINE,'antenna_keepout':PLAN['copper_rules']['antenna_keepout'],'geometric_packing':{'expected':180,'placed':len(pos),'same_face':len(same),'PTH_conflicts':len(pth),'NPTH_body_conflicts':len(npth),'static_conflicts':len(static),'source_audit':'placement-packing-audit.json'}}
HERE.mkdir(parents=True,exist_ok=True)
(HERE/'placement.json').write_text(json.dumps(result,indent=2)+'\n')
(HERE/'placement-packing-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps({k:v for k,v in audit.items() if k not in ['anchor_adjustments','input_footprint_files']},indent=2))
