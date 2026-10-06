"""Independent physical placement checks, not native CAD DRC or routing checks.

Run after build_import.py with system Python. Uses the actual generated board.
Courtyards are parsed as connected polygons, including U1's nonconvex outline.
Checks SMD courtyards on the same face, PTH pads on both faces, all-layer RF
keepout, board-edge copper, mounting-head keepouts and connector orientation.
"""
from __future__ import annotations
from pathlib import Path
import itertools
import hashlib
import json
import math
from kicad_format import parse, child, children, child_values

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
PCB = REPO/'output/pcb/Quipus-A1-EasyEDA/Quipus-A1.kicad_pcb'
EPS = 1e-7


def point(node, key):
    return tuple(map(float, child(node, key)[1:3]))


def rotate(x, y, angle):
    a=math.radians(angle)
    return x*math.cos(a)+y*math.sin(a), -x*math.sin(a)+y*math.cos(a)


def world(p, origin):
    dx,dy=rotate(p[0],p[1],origin[2])
    return origin[0]+dx,origin[1]+dy


def bounds(poly):
    return min(x for x,y in poly),min(y for x,y in poly),max(x for x,y in poly),max(y for x,y in poly)


def aabb_overlap(a,b):
    ax,ay,axx,ayy=bounds(a);bx,by,bxx,byy=bounds(b)
    return min(axx,bxx)-max(ax,bx)>EPS and min(ayy,byy)-max(ay,by)>EPS


def cross(a,b,c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def on_segment(p,a,b):
    return abs(cross(a,b,p))<EPS and min(a[0],b[0])-EPS<=p[0]<=max(a[0],b[0])+EPS and min(a[1],b[1])-EPS<=p[1]<=max(a[1],b[1])+EPS


def inside(p,poly,strict=True):
    yes=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if on_segment(p,a,b):return not strict
        if (a[1]>p[1]) != (b[1]>p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:yes=not yes
    return yes


def overlaps(a,b):
    if not aabb_overlap(a,b):return False
    if any(inside(p,b) for p in a) or any(inside(p,a) for p in b):return True
    for p,q in zip(a,a[1:]+a[:1]):
        for r,s in zip(b,b[1:]+b[:1]):
            if cross(p,q,r)*cross(p,q,s)<-EPS and cross(r,s,p)*cross(r,s,q)<-EPS:return True
    # Identical polygons and aligned overlapping rectangles can have no strict
    # vertex or crossing intersection. Interior edge midpoints resolve them.
    for poly,other in [(a,b),(b,a)]:
        for p,q in zip(poly,poly[1:]+poly[:1]):
            if inside(((p[0]+q[0])/2,(p[1]+q[1])/2),other):return True
        center=(sum(p[0] for p in poly)/len(poly),sum(p[1] for p in poly)/len(poly))
        if inside(center,poly) and inside(center,other):return True
    return False


def near(a,b):return math.dist(a,b)<1e-5


def outline_polygons(module, layer_suffix='CrtYd'):
    segments=[];closed=[]
    for item in children(module):
        layer=child_values(item,'layer',[''])[0]
        if not str(layer).endswith(layer_suffix):continue
        if item[0]=='fp_line':segments.append((point(item,'start'),point(item,'end')))
        elif item[0]=='fp_rect':
            (x,y),(xx,yy)=point(item,'start'),point(item,'end')
            closed.append([(x,y),(xx,y),(xx,yy),(x,yy)])
        elif item[0]=='fp_circle':
            c=point(item,'center');radius=math.dist(c,point(item,'end'))
            closed.append([(c[0]+radius*math.cos(i*math.pi/24),c[1]+radius*math.sin(i*math.pi/24)) for i in range(48)])
        elif item[0]=='fp_arc':
            c=point(item,'start');start=point(item,'end');sweep=float(child_values(item,'angle')[0]);radius=math.dist(c,start)
            a=math.atan2(start[1]-c[1],start[0]-c[0]);n=max(4,math.ceil(abs(sweep)/10))
            pts=[(c[0]+radius*math.cos(a+math.radians(sweep)*i/n),c[1]+radius*math.sin(a+math.radians(sweep)*i/n)) for i in range(n+1)]
            segments.extend(zip(pts,pts[1:]))
        elif item[0]=='fp_poly':
            closed.append([tuple(map(float,p[1:3])) for p in children(child(item,'pts'),'xy')])
    while segments:
        first,last=segments.pop(0);poly=[first,last]
        while not near(poly[-1],poly[0]):
            match=next(((i,b if near(a,poly[-1]) else a) for i,(a,b) in enumerate(segments) if near(a,poly[-1]) or near(b,poly[-1])),None)
            if match is None:raise ValueError('Unclosed courtyard')
            i,end=match;segments.pop(i);poly.append(end)
        closed.append(poly[:-1])
    return closed


def rectangle(cx,cy,w,h,angle=0):
    pts=[]
    for x,y in [(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]:
        xx,yy=rotate(x,y,angle);pts.append((cx+xx,cy+yy))
    return pts


def pad_polygon(pad,origin):
    at=child_values(pad,'at');center=world(tuple(map(float,at[:2])),origin)
    size=list(map(float,child_values(pad,'size')[:2]));angle=float(at[2]) if len(at)>2 else origin[2]
    return rectangle(*center,*size,angle)


def rounded(poly):return [[round(x,5),round(y,5)] for x,y in poly]


def main(proposed=None):
    tree=parse(PCB.read_text());placement=json.loads((HERE/'placement.json').read_text())
    if proposed:
        # Dry-run only: operate on the parsed tree, never on the PCB or parent
        # placement source. Existing copper keepout geometry remains unchanged.
        for module in children(tree,'module'):
            ref=next(str(x[2]) for x in children(module,'fp_text') if x[1]=='reference')
            if ref in proposed:
                at=child(module,'at');at[1:3]=list(map(str,proposed[ref]))
    board_outline=[]
    for line in children(tree,'gr_line'):
        if child_values(line,'layer',[''])[0]=='Edge.Cuts':board_outline.append(point(line,'start'))
    parts=[]
    for module in children(tree,'module'):
        ref=next(str(x[2]) for x in children(module,'fp_text') if x[1]=='reference')
        at=list(map(float,child_values(module,'at')));origin=(at+[0])[:3]
        side='B' if child_values(module,'layer')[0]=='B.Cu' else 'F'
        polys=outline_polygons(module)
        parts.append({'ref':ref,'side':side,'origin':origin,'module':module,'courtyards':[[world(p,origin) for p in poly] for poly in polys],
                      'pads':[(p,pad_polygon(p,origin)) for p in children(module,'pad')]})
    byref={p['ref']:p for p in parts}
    electronics=[p for p in parts if not p['ref'].startswith('H')]
    courtyard_pairs=[];through_hole=[];edge=[];mount=[];screen=[];missing=[];outboard=[]
    for part in electronics:
        if not part['courtyards']:missing.append(part['ref'])
        for poly in part['courtyards']:
            if not all(inside(p,board_outline,strict=False) for p in poly):
                outboard.append({'ref':part['ref'],'bounds_mm':bounds(poly),'intentional_mating_or_rf_allowance':part['ref'] in {'U1','J1','J6'},'reason':'Courtyard includes antenna air space or connector assembly margin' if part['ref'] in {'U1','J1','J6'} else 'Courtyard extends outside PCB material; investigate physical package/case clearance'})
        for pad,poly in part['pads']:
            # Paste-only shapes and acoustic apertures have no copper.
            layers=child_values(pad,'layers',[])
            if pad[2]=='np_thru_hole' or not any(str(x).endswith('.Cu') for x in layers):continue
            if not all(inside(p,board_outline,strict=False) for p in poly):edge.append({'ref':part['ref'],'pad':str(pad[1]),'bounds_mm':bounds(poly),'reason':'copper outside board/notch'})
            else:
                near_edge=False
                for q in poly:
                    for a,b in zip(board_outline,board_outline[1:]+board_outline[:1]):
                        dx,dy=b[0]-a[0],b[1]-a[1];length2=dx*dx+dy*dy
                        t=max(0,min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/length2))
                        if math.dist(q,(a[0]+t*dx,a[1]+t*dy))<.25-EPS:near_edge=True
                if near_edge:edge.append({'ref':part['ref'],'pad':str(pad[1]),'bounds_mm':bounds(poly),'reason':'copper closer than 0.25 mm to board edge'})
        for hole in [p for p in parts if p['ref'].startswith('H')]:
            if any(overlaps(a,b) for a in part['courtyards'] for b in hole['courtyards']):mount.append({'ref':part['ref'],'hole':hole['ref'],'part_bounds_mm':[bounds(p) for p in part['courtyards']],'hole_center_mm':hole['origin'][:2],'head_keepout_radius_mm':2.75})
        env=placement['screen_envelope'];sp=rectangle(env['x']+env['width']/2,env['y']+env['height']/2,env['width'],env['height'])
        if part['side']=='F' and any(overlaps(p,sp) for p in part['courtyards']):screen.append(part['ref'])
    for a,b in itertools.combinations(electronics,2):
        if a['side']==b['side'] and any(overlaps(p,q) for p in a['courtyards'] for q in b['courtyards']):
            courtyard_pairs.append({'refs':[a['ref'],b['ref']],'side':a['side'],'origins_mm':[a['origin'][:2],b['origin'][:2]],'bounds_mm':[[bounds(p) for p in a['courtyards']],[bounds(p) for p in b['courtyards']]]})
        if a['side']!=b['side']:
            for through,other in [(a,b),(b,a)]:
                for pad,p in through['pads']:
                    if pad[2]=='thru_hole' and any(overlaps(p,q) for q in other['courtyards']):through_hole.append({'through_ref':through['ref'],'pad':str(pad[1]),'other_ref':other['ref'],'bounds_mm':bounds(p)})
    rf=[];rf_layers=set();expected_rf=[(8.5,-14.75),(56.5,-14.75),(56.5,6.25),(8.5,6.25)]
    for zone in children(tree,'zone'):
        if child(zone,'keepout') is None:continue
        pts=[tuple(map(float,p[1:3])) for p in children(child(child(zone,'polygon'),'pts'),'xy')]
        if len(pts)==4 and all(any(near(p,q) for q in expected_rf) for p in pts):rf_layers.add(str(child_values(zone,'layer')[0]))
    for part in electronics:
        if part['ref']=='U1':continue
        if any(overlaps(p,expected_rf) for p in part['courtyards']):rf.append(part['ref'])
    j1=byref['J1'];usb_guide=world((0,3.675),j1['origin'])
    j6=byref['J6'];mouth_center=world((0,7.975),j6['origin'])
    # Source Hirose card insertion/ejection is +localY. Bottom reflection in the
    # importer is localX only, so a 90-degree board angle gives +globalX.
    sd_outward=rotate(0,1,j6['origin'][2])
    result={'status':'Independent geometric placement audit; not native CAD DRC','board_file':str(PCB.relative_to(REPO)).replace('\\','/'),'board_sha256':hashlib.sha256(PCB.read_bytes()).hexdigest(),
            'components':len(electronics),'courtyard_method':'Actual stitched closed polygons; circular keepouts approximated by 48 segments; pad shapes conservatively bounded by rotated rectangles.',
            'same_face_courtyard_overlaps':courtyard_pairs,'opposite_face_through_hole_conflicts':through_hole,'copper_edge_issues':edge,
            'mounting_head_conflicts':mount,'front_components_under_screen_envelope':screen,'missing_courtyards':missing,'courtyard_outside_board':outboard,
            'rf_keepout_layers':sorted(rf_layers),'rf_all_four_layers_present':rf_layers=={'F.Cu','In1.Cu','In2.Cu','B.Cu'},'rf_component_conflicts':rf,
            'usb_pcb_edge_guide_mm':usb_guide,'usb_guide_aligned_bottom':abs(usb_guide[1]-105)<EPS,
            'sd_mouth_center_mm':mouth_center,'sd_outward_unit_vector':sd_outward,'sd_faces_right':abs(sd_outward[0]-1)<EPS and abs(sd_outward[1])<EPS,
            'routing_checks_performed':False,'native_drc_performed':False}
    result['proposal_dry_run']=bool(proposed)
    out=HERE/('placement-proposal-validation.json' if proposed else 'placement-validation.json');out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in {'same_face_courtyard_overlaps','opposite_face_through_hole_conflicts','copper_edge_issues','mounting_head_conflicts','courtyard_method'}},indent=2))
    for title,entries in [('same-face overlaps',courtyard_pairs),('PTH conflicts',through_hole),('edge issues',edge),('mount conflicts',mount)]:
        print('\n'+title+': '+str(len(entries)))
        for issue in entries:print(json.dumps(issue))


if __name__=='__main__':main()
