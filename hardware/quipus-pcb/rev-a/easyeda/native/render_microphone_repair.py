"""Render repaired native geometry; never mutates CAD or the footprint."""
from __future__ import annotations
import math
import sys
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from repair_microphone import AFTER as DEFAULT, records, MM_PER_MIL, hash_file

AFTER = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
OUT = AFTER.with_suffix('.png')
BG = '#163b3b'
SCALE = 130


def font(size, bold=False):
    path = Path('C:/Windows/Fonts') / ('segoeuib.ttf' if bold else 'segoeui.ttf')
    return ImageFont.truetype(str(path), size)


def arc_points(a, b, angle):
    dx, dy = b[0]-a[0], b[1]-a[1]
    length = math.hypot(dx, dy)
    midpoint = ((a[0]+b[0])/2, (a[1]+b[1])/2)
    theta = math.radians(angle)
    offset = length/(2*math.tan(theta/2))
    center = (midpoint[0]-dy/length*offset, midpoint[1]+dx/length*offset)
    radius = math.dist(a, center)
    start = math.atan2(a[1]-center[1], a[0]-center[0])
    count = max(2, math.ceil(abs(angle)/.5))
    return [(center[0]+radius*math.cos(start+theta*i/count),
             center[1]+radius*math.sin(start+theta*i/count)) for i in range(count+1)]


def points(path):
    current = (path[0], path[1])
    result, index, mode = [current], 2, 'L'
    while index < len(path):
        if isinstance(path[index], str):
            mode = path[index]
            index += 1
        if mode == 'ARC':
            angle = path[index]
            target = (path[index+1], path[index+2])
            result += arc_points(current, target, angle)[1:]
            index += 3
        elif mode == 'L':
            target = (path[index], path[index+1])
            result.append(target)
            index += 2
        else:
            raise ValueError(mode)
        current = target
    return result


def main():
    rs = records(AFTER)
    audit = json.loads(AFTER.with_suffix('.audit.json').read_text(encoding='utf-8'))
    absolute_paths = audit.get('v3_changes', {}).get('path_coordinate_mode') == 'absolute footprint coordinates'
    pads = {d['num']: d for _, h, d in rs if h['type'] == 'PAD'}
    hole = pads['']
    image = Image.new('RGB', (1620, 750), '#f3f6f6')
    draw = ImageDraw.Draw(image)
    draw.text((28, 16), 'IM69D128S · repaired native footprint geometry', font=font(28, True), fill='#173b3b')
    draw.text((28, 55), 'Derived from repaired .esource; local coordinate render, not native CAD / Gerber verification.', font=font(18), fill='#475d5b')

    for panel, title in enumerate(('Copper + acoustic NPTH', 'Stencil apertures only', 'Solder-mask openings')):
        ox, oy = 270+panel*540, 380
        def xy(x, y):
            return (ox+x*MM_PER_MIL*SCALE, oy-y*MM_PER_MIL*SCALE)
        def circle(cx, cy, radius, fill):
            p = xy(cx, cy)
            r = radius*MM_PER_MIL*SCALE
            draw.ellipse((p[0]-r, p[1]-r, p[0]+r, p[1]+r), fill=fill)
        draw.rounded_rectangle((panel*540+20, 116, panel*540+520, 640), radius=12, fill=BG)
        draw.text((panel*540+27, 88), title, font=font(22, True), fill='#173b3b')
        body = [xy(-1.325/MM_PER_MIL, 1.75/MM_PER_MIL), xy(1.325/MM_PER_MIL, -1.75/MM_PER_MIL)]
        draw.rectangle([body[0], body[1]], outline='#668a87', width=2)
        if panel == 0:
            for num in ('1', '2', '3', '4'):
                p = pads[num]
                w, h = p['defaultPad']['width'], p['defaultPad']['height']
                draw.rectangle([xy(p['centerX']-w/2, p['centerY']+h/2), xy(p['centerX']+w/2, p['centerY']-h/2)], fill='#dfc376')
                pt = xy(p['centerX'], p['centerY'])
                draw.text((pt[0]-6, pt[1]-13), num, font=font(20, True), fill='#172f2c')
            for p in (d for _, h, d in rs if h['type'] == 'PAD' and d['num'] == '5'):
                path = p['defaultPad']['path']
                if isinstance(path[0], (float, int)):
                    offset = (0, 0) if absolute_paths else (p['centerX'], p['centerY'])
                    draw.polygon([xy(x+offset[0], y+offset[1]) for x, y in points(path)], fill='#dfc376')
                else:
                    for contour in path:
                        assert contour[0] == 'CIRCLE'
                        _, cx, cy, r, winding = contour
                        circle(p['centerX']+cx, p['centerY']+cy, r, '#dfc376' if winding == 0 else BG)
        elif panel == 1:
            for _, hdr, d in rs:
                if hdr['type'] == 'FILL' and d['layerId'] == 7:
                    for path in d['path']:
                        draw.polygon([xy(*p) for p in points(path)], fill='#89c7db')
        else:
            for num in ('1', '2', '3', '4'):
                p = pads[num]
                w = p['defaultPad']['width']+2*p['topSolderExpansion']
                h = p['defaultPad']['height']+2*p['topSolderExpansion']
                draw.rectangle([xy(p['centerX']-w/2, p['centerY']+h/2), xy(p['centerX']+w/2, p['centerY']-h/2)], fill='#b3dbb2')
            d = next(d for _, h, d in rs if h.get('id') == 'ie19')
            cx, cy = hole['centerX'], hole['centerY']
            r = abs(d['path'][0]-cx)
            circle(cx, cy, r+d['width']/2, '#b3dbb2')
            circle(cx, cy, r-d['width']/2, BG)
        if panel == 0 and absolute_paths:
            for p in (d for _, h, d in rs if h['type'] == 'PAD' and d['num'] == '5'):
                pt = xy(p['centerX'], p['centerY'])
                draw.line((pt[0]-5, pt[1], pt[0]+5, pt[1]), fill='#173b3b', width=2)
                draw.line((pt[0], pt[1]-5, pt[0], pt[1]+5), fill='#173b3b', width=2)
        circle(hole['centerX'], hole['centerY'], hole['hole']['width']/2, '#eef5f3')
        draw.text((panel*540+28, 651), ('OD1.725 / ID0.985 · 0.1925 mm nominal gap',
                                    '4 rectangles + 3 exact sectors · auto paste OFF',
                                    'Ring OD1.825 / ID0.885 · signal +0.05 mm')[panel], font=font(18), fill='#173b3b')
    draw.text((28, 689), 'Acoustic hole: Ø0.600 mm, unplated, same centre in all three views. Native Y plotted upward.', font=font(18), fill='#475d5b')
    draw.text((28, 719), 'File SHA256: '+hash_file(AFTER), font=font(14), fill='#475d5b')
    image.save(OUT)
    print(str(OUT))


if __name__ == '__main__':
    main()
