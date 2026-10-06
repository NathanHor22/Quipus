"""Render actual KiCad5 PCB geometry with labelled front/rear views.

No CAD or PCB mutation. The rear view is mirrored about the board's long axis.
Python/Pillow required; paths default to the current Quipus EasyEDA carrier.
"""
from __future__ import annotations
import argparse
import hashlib
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from kicad_format import parse, children, child_values

ROOT = Path(__file__).resolve().parents[4]
DEFAULT = ROOT / "output/pcb/Quipus-A1-EasyEDA/Quipus-A1.kicad_pcb"
SCALE = 10.0
BG = "#f4f7f8"
BOARD = "#183c3c"
COPPER = "#d9b968"
FAB = "#8dcbc0"
INK = "#15302f"


def font(size, bold=False):
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    path = Path("C:/Windows/Fonts") / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def xy(node, key):
    return tuple(float(v) for v in child_values(node, key, [])[:2])


def rotate(point, angle):
    x, y = point
    a = math.radians(angle)
    return (x*math.cos(a)+y*math.sin(a), -x*math.sin(a)+y*math.cos(a))


def transformed(point, origin):
    x, y = rotate(point, origin[2] if len(origin) > 2 else 0)
    return (x+origin[0], y+origin[1])


def rounded_rectangle(w, h, radius):
    r = min(radius, w/2, h/2)
    if r <= 0:
        return [(-w/2,-h/2), (w/2,-h/2), (w/2,h/2), (-w/2,h/2)]
    points = []
    for cx, cy, start in ((w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)):
        for i in range(13):
            a = math.radians(start+i*90/12)
            points.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    return points


def circle_points(center, radius, count=96):
    return [(center[0]+radius*math.cos(i*2*math.pi/count),center[1]+radius*math.sin(i*2*math.pi/count)) for i in range(count)]


def stitch(edges):
    remaining = list(edges)
    a, b = remaining.pop(0)
    points = [a,b]
    while remaining:
        last = points[-1]
        found = None
        for i, (start,end) in enumerate(remaining):
            if math.dist(last,start) < 1e-5:
                found = (i,end)
                break
            if math.dist(last,end) < 1e-5:
                found = (i,start)
                break
        if found is None:
            raise ValueError("Cannot stitch closed board outline")
        points.append(found[1])
        remaining.pop(found[0])
    if math.dist(points[0],points[-1]) > 1e-5:
        raise ValueError("Board outline is open")
    return points[:-1]


def main(board_path, output_path):
    pcb = parse(board_path.read_text(encoding="utf-8"))
    modules = children(pcb,"module")
    refs = {}
    for mod in modules:
        texts = [n for n in children(mod,"fp_text") if n[1] == "reference"]
        if texts:
            refs[str(texts[0][2])] = mod
    edges = [(xy(n,"start"),xy(n,"end")) for n in children(pcb,"gr_line") if child_values(n,"layer") == ["Edge.Cuts"]]
    border = stitch(edges)
    width=max(p[0] for p in border)-min(p[0] for p in border)
    height=max(p[1] for p in border)-min(p[1] for p in border)
    assert (width,height) == (65.0,105.0), (width,height)
    image = Image.new("RGB", (2240,1570), BG)
    d = ImageDraw.Draw(image)
    d.text((86,48),"QUIPUS A1",font=font(44,True),fill=INK)
    d.text((86,110),"Physical PCB placement • actual KiCad file geometry",font=font(25),fill="#456260")
    d.rounded_rectangle((1695,52,2140,108),radius=14,fill="#f2dfbb")
    d.text((1720,67),"UNROUTED • ENGINEERING REVIEW",font=font(19,True),fill="#705422")
    d.text((86,156),f"{width:g} × {height:g} mm outline   |   1.6 mm board   |   4 copper layers   |   144 electronic references",font=font(23),fill="#456260")

    panels = [("F",150,258,False),("B",1240,258,True)]
    dimfont = font(18)
    label_font = font(18,True)
    small = font(17)

    def panel_point(point, ox, oy, mirrored):
        x = width-point[0] if mirrored else point[0]
        return (ox+x*SCALE,oy+point[1]*SCALE)

    def line(points, ox, oy, mirrored, fill, line_width=1):
        d.line([panel_point(p,ox,oy,mirrored) for p in points],fill=fill,width=line_width)

    def polygon(points,ox,oy,mirrored,fill,outline=None):
        d.polygon([panel_point(p,ox,oy,mirrored) for p in points],fill=fill,outline=outline)

    def graphic(node, origin, ox,oy,mirrored, colour, line_width=1):
        kind=node[0]
        if kind in ("fp_line","gr_line"):
            line([transformed(xy(node,"start"),origin),transformed(xy(node,"end"),origin)],ox,oy,mirrored,colour,line_width)
        elif kind in ("fp_circle","gr_circle"):
            c,e=xy(node,"center"),xy(node,"end")
            points=[transformed(p,origin) for p in circle_points(c,math.dist(c,e))]
            line(points+[points[0]],ox,oy,mirrored,colour,line_width)
        elif kind in ("fp_arc","gr_arc"):
            # KiCad5 start=center, end=arc starting point, angle=sweep.
            c,e=xy(node,"start"),xy(node,"end")
            sweep=float(child_values(node,"angle",[0])[0])
            start=math.atan2(e[1]-c[1],e[0]-c[0])
            radius=math.dist(c,e)
            points=[]
            for i in range(max(16,int(abs(sweep)/3))+1):
                count=max(16,int(abs(sweep)/3))
                angle=start+math.radians(sweep)*i/count
                points.append(transformed((c[0]+radius*math.cos(angle),c[1]+radius*math.sin(angle)),origin))
            line(points,ox,oy,mirrored,colour,line_width)
        elif kind in ("fp_poly","gr_poly"):
            pts=[tuple(float(v) for v in x[1:3]) for x in children(next(n for n in node if isinstance(n,list) and n and n[0]=="pts"),"xy")]
            pts=[transformed(p,origin) for p in pts]
            line(pts+[pts[0]],ox,oy,mirrored,colour,line_width)

    for face,ox,oy,mirrored in panels:
        title="FRONT / user controls" if face=="F" else "REAR / electronics"
        d.text((ox,oy-67),title,font=font(26,True),fill=INK)
        d.text((ox,oy-30),"Component-side view" if face=="F" else "Turn board over; left/right are mirrored",font=small,fill="#5c7471")
        polygon(border,ox,oy,mirrored,BOARD,"#102e2e")
        # Actual all-layer RF keepout polygons, clipped to board material.
        mask=Image.new("L",image.size,0); md=ImageDraw.Draw(mask)
        md.polygon([panel_point(p,ox,oy,mirrored) for p in border],fill=255)
        keep=Image.new("RGB",image.size,BOARD); kd=ImageDraw.Draw(keep)
        zones=[z for z in children(pcb,"zone") if child_values(z,"layer",[])==[face+".Cu"] and child_values(z,"keepout",[])]
        keepmask=Image.new("L",image.size,0); km=ImageDraw.Draw(keepmask)
        for zone in zones:
            for poly in children(zone,"polygon"):
                points=[tuple(float(v) for v in n[1:3]) for n in children(next(n for n in poly if isinstance(n,list) and n and n[0]=="pts"),"xy")]
                pixel=[panel_point(p,ox,oy,mirrored) for p in points]
                kd.polygon(pixel,fill="#5c403b"); km.polygon(pixel,fill=255)
        from PIL import ImageChops
        clipped=ImageChops.multiply(mask,keepmask)
        image.paste(keep,(0,0),clipped)
        d=ImageDraw.Draw(image)
        # Light 10mm grid; it represents coordinates, not copper traces.
        for x in range(10,int(width),10):
            for y in range(10,int(height),10):
                px,py=panel_point((x,y),ox,oy,mirrored)
                d.ellipse((px-1,py-1,px+1,py+1),fill="#42706b")
        for mod in modules:
            layer=child_values(mod,"layer",["F.Cu"])[0]
            modface="B" if layer=="B.Cu" else "F"
            pos=[float(v) for v in child_values(mod,"at")]
            if modface==face:
                for node in children(mod):
                    if node[0].startswith("fp_") and child_values(node,"layer",[])==[face+".Fab"]:
                        graphic(node,pos,ox,oy,mirrored,FAB,1)
            for pad in children(mod,"pad"):
                typ,shape=pad[2:4]
                layers=child_values(pad,"layers",[])
                visible=face+".Cu" in layers or "*.Cu" in layers
                if not visible:
                    continue
                at=[float(v) for v in child_values(pad,"at")]
                centre=transformed(at[:2],pos)
                angle=at[2] if len(at)>2 else (pos[2] if len(pos)>2 else 0)
                size=[float(v) for v in child_values(pad,"size")]
                if typ!="np_thru_hole":
                    if shape=="custom":
                        for prim in children(next(n for n in pad if isinstance(n,list) and n and n[0]=="primitives")):
                            if prim[0]=="gr_circle":
                                c,e=xy(prim,"center"),xy(prim,"end")
                                radius=math.dist(c,e); stroke=float(child_values(prim,"width",[0])[0])
                                centerworld=transformed(c,(*centre,angle))
                                polygon(circle_points(centerworld,radius+stroke/2),ox,oy,mirrored,COPPER)
                                polygon(circle_points(centerworld,radius-stroke/2),ox,oy,mirrored,BOARD)
                            elif prim[0]=="gr_poly":
                                ptsnode=next(n for n in prim if isinstance(n,list) and n and n[0]=="pts")
                                points=[transformed(tuple(float(v) for v in n[1:3]),(*centre,angle)) for n in children(ptsnode,"xy")]
                                polygon(points,ox,oy,mirrored,COPPER)
                    else:
                        if shape=="circle":
                            points=circle_points((0,0),size[0]/2)
                        else:
                            radius=min(size)/2 if shape=="oval" else min(size)*float(child_values(pad,"roundrect_rratio",[0])[0])
                            points=rounded_rectangle(*size,radius)
                        polygon([transformed(p,(*centre,angle)) for p in points],ox,oy,mirrored,COPPER)
                drill=child_values(pad,"drill",[])
                if drill:
                    if drill[0]=="oval":
                        dims=[float(v) for v in drill[1:3]]
                        points=rounded_rectangle(*dims,min(dims)/2)
                    else:
                        points=circle_points((0,0),float(drill[0])/2)
                    polygon([transformed(p,(*centre,angle)) for p in points],ox,oy,mirrored,BG)
        # Draw actual screen-envelope lines from Dwgs.User on the front only.
        if face=="F":
            for node in children(pcb,"gr_line"):
                if child_values(node,"layer",[])==["Dwgs.User"]:
                    graphic(node,(0,0,0),ox,oy,mirrored,"#67c9b7",2)
            p=panel_point((32.5,48),ox,oy,False)
            d.text(p,"45 × 31 mm",font=font(27,True),fill="#a7e0d5",anchor="mm")
            d.text((p[0],p[1]+36),"off-board screen guide",font=font(20),fill="#a7e0d5",anchor="mm")
            for node in children(pcb,"gr_text"):
                if str(node[1]) in ("POWER","START","STOP","UP","DOWN","USB-C","QUIPUS A1"):
                    p=panel_point(xy(node,"at"),ox,oy,False)
                    d.text(p,str(node[1]),font=font(15,True),fill="#c3ebe2",anchor="mm")
        else:
            for ref in ("U1","U11","U12","U20","U21","U22","U30","U31","J2","J3","J4","J5","J6","J7"):
                mod=refs[ref]
                if child_values(mod,"layer",["F.Cu"])[0]!="B.Cu":
                    continue
                at=[float(v) for v in child_values(mod,"at")]
                p=panel_point(at,ox,oy,mirrored)
                if ref=="U1": p=(p[0],p[1]-42)
                if ref in ("U20","U21"): p=(p[0],p[1]+28)
                d.text(p,ref,font=font(13,True),fill="#effcf7",anchor="mm",stroke_width=1,stroke_fill=BOARD)
        # Board dimensions derived from Edge.Cuts.
        top=oy-5; bottom=oy+height*SCALE+5
        xdim=ox-36
        d.line((xdim,oy,xdim,oy+height*SCALE),fill="#718a87",width=1)
        d.line((xdim-6,oy,xdim+6,oy),fill="#718a87",width=1)
        d.line((xdim-6,oy+height*SCALE,xdim+6,oy+height*SCALE),fill="#718a87",width=1)
        d.text((xdim-12,oy+height*SCALE/2),f"{height:g} mm",font=dimfont,fill="#506e68",anchor="rm")
        d.line((ox,bottom+25,ox+width*SCALE,bottom+25),fill="#718a87",width=1)
        for x in (ox,ox+width*SCALE): d.line((x,bottom+19,x,bottom+31),fill="#718a87",width=1)
        d.text((ox+width*SCALE/2,bottom+46),f"{width:g} mm",font=dimfont,fill="#506e68",anchor="mm")

    def leader(worldpoint,face,label,textpos,colour="#527a72"):
        _,ox,oy,mirrored=next(p for p in panels if p[0]==face)
        p=panel_point(worldpoint,ox,oy,mirrored)
        q=textpos
        end=(q[0]-12,q[1]+13)
        distance=math.dist(p,end)
        start=(p[0]+7*(end[0]-p[0])/distance,p[1]+7*(end[1]-p[1])/distance)
        d.line((*start,*end),fill=colour,width=2)
        # Preserve the visible acoustic hole; draw a hollow callout ring.
        d.ellipse((p[0]-7,p[1]-7,p[0]+7,p[1]+7),outline=colour,width=2)
        for i,text in enumerate(label.split("\n")):
            d.text((q[0],q[1]+i*25),text,font=label_font if i==0 else small,fill=INK if i==0 else "#52726c")

    def origin(ref):return tuple(float(v) for v in child_values(refs[ref],"at"))
    def acoustic(ref):
        hole=next(p for p in children(refs[ref],"pad") if p[2]=="np_thru_hole")
        return transformed(xy(hole,"at"),origin(ref))
    leader(acoustic("U20"),"F","Top microphone port\n0.60 mm through PCB\nMic mounted on rear",(875,326))
    leader(acoustic("U21"),"F","Bottom microphone port\n0.60 mm through PCB\nKeep case opening clear",(875,1070))
    leader((65,40),"F","microSD side access\nSocket faces outward\nCase needs push-push travel",(875,704))
    leader(origin("J1")[:2],"F","USB-C at bottom\nCharge + native USB",(875,1256))
    leader(origin("U1")[:2],"B","ESP32-S3-WROOM-1\nAntenna over PCB notch\nClearance on all layers",(1926,340))
    leader(origin("J4")[:2],"B","Digital mic expansion\nJST SH, 4 pins\nShort internal cable",(1926,550))
    leader(origin("J2")[:2],"B","Protected 1S LiPo\nJST PH, 2 pins\nPack dimensions pending",(1926,794))
    leader(origin("J5")[:2],"B","Speaker connection\nJST SH, 2 pins\nDifferential output",(1926,1010))
    d.line((85,1407,2145,1407),fill="#d4e0dd",width=2)
    d.rounded_rectangle((88,1436,112,1460),radius=3,fill=COPPER)
    d.text((128,1435),"Physical copper pads",font=font(20),fill=INK)
    d.line((450,1449,478,1449),fill=FAB,width=3)
    d.text((493,1435),"Actual component outlines",font=font(20),fill=INK)
    d.rounded_rectangle((875,1436,899,1460),radius=3,fill="#5c403b")
    d.text((915,1435),"Copper keepouts",font=font(20),fill=INK)
    d.text((88,1480),"No copper tracks or ground pours are shown: the board is not routed. Native import and ERC/DRC checks are documented separately.",font=font(20),fill="#55716b")
    sha=hashlib.sha256(board_path.read_bytes()).hexdigest()
    d.text((88,1518),f"Source: {board_path.name}   |   SHA-256 {sha[:24]}…   |   Rear mirrored; all geometry in millimetres",font=font(17),fill="#6b827d")
    output_path.parent.mkdir(parents=True,exist_ok=True)
    image.save(output_path)
    print(f"Rendered {len(modules)} modules from actual PCB; output {output_path}; SHA256 {sha}")


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--board",type=Path,default=DEFAULT)
    parser.add_argument("--output",type=Path,default=DEFAULT.parent/"placement-preview.png")
    args=parser.parse_args()
    main(args.board,args.output)
