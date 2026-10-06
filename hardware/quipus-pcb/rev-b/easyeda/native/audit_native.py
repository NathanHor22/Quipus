"""Audit a downloaded EasyEDA Pro native PCB document, not its import carrier.

Usage: python audit_native.py [pcb-final.esource] [--repair-libraries]
The packed source has many DOCHEAD sections. Only the PCB section is counted;
linked FOOTPRINT sections provide its real pads. PAD_NET also creates records
for non-pad graphics, so those records must not be mistaken for physical pins.
No browser, project mutation, routing or fabrication release is performed.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
EASYEDA = HERE.parent
ROOT = HERE.parents[4]
MM = .0254
TOL = .000003  # native 4-decimal-mil rounding fits inside this tolerance


def packed(path):
    documents = []
    current = None
    for line_number, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
        if not line.strip():
            continue
        try:
            left, right = line.split('||', 1)
            h = json.loads(left)
            payload = right.rstrip('|')
            d = json.loads(payload) if payload else None
            if d is None and not (h.get('id') and isinstance(h.get('ticket'),int) and isinstance(h.get('firstTicket'),int)):
                raise ValueError('Empty payload is not an identifiable native history tombstone')
        except Exception as exc:
            raise ValueError(f'{path.name}:{line_number}: invalid native record') from exc
        if h['type'] == 'DOCHEAD':
            current = {'head': d, 'raw_rows': []}
            documents.append(current)
        if current is None:
            raise ValueError('Record precedes DOCHEAD')
        current['raw_rows'].append((line, h, d))
    for document in documents:
        state={}
        deleted=[]
        superseded=[]
        for line,h,d in document['raw_rows']:
            if 'id' not in h and h['type']!='DOCHEAD':
                raise ValueError(f'Unkeyed native {h["type"]} record cannot be replayed safely')
            key=(h['type'],h.get('id','DOCHEAD'))
            if key in state:
                superseded.append({'type':h['type'],'id':h.get('id'),'previous_ticket':state[key][1].get('ticket'),'latest_ticket':h.get('ticket')})
            state[key]=(line,h,d)
            if d is None:
                deleted.append({'type':h['type'],'id':h['id'],'ticket':h['ticket'],'first_ticket':h['firstTicket']})
        document['rows']=[record for record in state.values() if record[2] is not None]
        document['history']={'raw_records':len(document['raw_rows']),'active_records':len(document['rows']),
                             'tombstone_count':len(deleted),'tombstones':deleted,'superseded_records':superseded,
                             'replay_rule':'Last record per(type,id); an identifiable empty-body history record deletes that key.'}
    return documents


def rows(document, kind):
    return [(h, d) for _, h, d in document['rows'] if h['type'] == kind]


def title(document):
    return next((d.get('title') for h, d in rows(document, 'META')), None)


def flat_points(path):
    """Absolute native polygon coordinates; only straight closed contours."""
    if any(isinstance(x, str) and x != 'L' for x in path):
        raise ValueError('Curved path needs its own geometry check')
    numbers = [float(x) for x in path if not isinstance(x, str)]
    if len(numbers) % 2:
        raise ValueError('Odd native polygon coordinate count')
    result = list(zip(numbers[::2], numbers[1::2]))
    if len(result) > 1 and math.dist(result[0], result[-1]) < 1e-8:
        result.pop()
    return result


def inside(p, polygon):
    x, y = p
    answer = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            answer = not answer
    return answer


def distance(p, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    den = dx*dx+dy*dy
    k = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
    return math.dist(p, (a[0]+k*dx, a[1]+k*dy))


def contour_error(a, b):
    """Permit a changed winding or start vertex, but no changed polygon."""
    def deduplicate(points):
        result = []
        for p in points:
            if not result or math.dist(p,result[-1])>1e-8:
                result.append(p)
        return result
    # The D-shaped land source repeats the semicircle's first endpoint; the
    # native importer removes that zero-length edge without changing copper.
    a,b = deduplicate(a),deduplicate(b)
    if a and math.dist(a[0],a[-1]) < 1e-8:
        a = a[:-1]
    if b and math.dist(b[0],b[-1]) < 1e-8:
        b = b[:-1]
    if len(a) != len(b) or not a:
        return float('inf')
    errors = []
    for contour in (a, list(reversed(a))):
        offset = min(range(len(contour)), key=lambda i: math.dist(contour[i], b[0]))
        rotated = contour[offset:]+contour[:offset]
        errors.append(max(math.dist(p, q) for p, q in zip(rotated, b)))
    return min(errors)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parser():
    spec = importlib.util.spec_from_file_location('independent_carrier_parser', EASYEDA/'validate_import.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_polygon(pad, parse):
    origin = list(map(float, parse.values(pad, 'at', [0, 0])[:2]))
    primitive = parse.one(parse.one(pad, 'primitives', []), 'gr_poly')
    if primitive is None:
        return None
    # The independent carrier validator verifies that its custom polygons have
    # already been reflected into local B-side coordinates before export.
    angle = float(parse.values(pad, 'at', [0, 0, 0])[2])
    if abs(angle) > 1e-8:
        raise ValueError('Unexpected rotated custom pad in critical source')
    return [(origin[0]+float(p[1]), origin[1]+float(p[2]))
            for p in parse.kids(parse.one(primitive, 'pts'), 'xy')]


def source_paste_contours(module, parse):
    result = []
    for p in parse.kids(module,'pad'):
        layers = parse.values(p,'layers',[])
        if p[1] or not any(x.endswith('.Paste') for x in layers):
            continue
        polygon = source_polygon(p,parse) if p[3]=='custom' else None
        if polygon is None and p[3]=='rect':
            at = list(map(float,parse.values(p,'at')[:2]))
            w,h = map(float,parse.values(p,'size'))
            polygon = [(at[0]-w/2,at[1]-h/2),(at[0]+w/2,at[1]-h/2),
                       (at[0]+w/2,at[1]+h/2),(at[0]-w/2,at[1]+h/2)]
        if polygon is None:
            raise ValueError('Unsupported critical paste aperture shape')
        result.append(polygon)
    for p in parse.kids(module,'fp_poly'):
        if any(x.endswith('.Paste') for x in parse.values(p,'layer',[])):
            result.append([(float(x[1]),float(x[2])) for x in parse.kids(parse.one(p,'pts'),'xy')])
    return result


def path_endpoint_geometry(path):
    """Native line/arc endpoints and analytic radius; angles are not XY."""
    endpoints = [(float(path[0]),float(path[1]))]
    radii,angles = [],[]
    index=2
    while index<len(path):
        if path[index]=='L':
            index+=1
            continue
        if path[index]=='ARC':
            angle=float(path[index+1])
            end=(float(path[index+2]),float(path[index+3]))
            radii.append(math.dist(endpoints[-1],end)/(2*math.sin(math.radians(abs(angle))/2)))
            angles.append(angle)
            endpoints.append(end)
            index+=4
        else:
            endpoints.append((float(path[index]),float(path[index+1])))
            index+=2
    return endpoints,radii,angles


def paste_geometry_audit(document,module,parse):
    """Compare every explicit paste aperture, including rounded rectangles.

    Aperture sets permit cyclic ordering, winding and interchange of symmetric
    windows, but never a translated, reflected or resized physical aperture.
    Native0.2mil boundary stroke is reported separately from contour geometry.
    """
    expected=[]
    for p in parse.kids(module,'pad'):
        if p[1] or not any(x.endswith('.Paste') for x in parse.values(p,'layers',[])):
            continue
        at=list(map(float,parse.values(p,'at',[0,0,0])))
        w,h=map(float,parse.values(p,'size'))
        if p[3]=='custom':
            expected.append({'kind':'polygon','points':source_polygon(p,parse)})
        elif p[3] in ('rect','roundrect'):
            # Legacy KiCad PCB pad angles are absolute PCB rotations;
            # subtract component rotation to recover library-local geometry.
            mod_at=parse.values(module,'at',[0,0,0])
            angle=(at[2] if len(at)>2 else 0)-(float(mod_at[2]) if len(mod_at)>2 else 0)
            theta=math.radians(angle)
            ww=abs(w*math.cos(theta))+abs(h*math.sin(theta))
            hh=abs(w*math.sin(theta))+abs(h*math.cos(theta))
            ratio=float(parse.values(p,'roundrect_rratio',[0])[0]) if p[3]=='roundrect' else 0
            expected.append({'kind':p[3],'center':at[:2],'size':[ww,hh],'radius':min(w,h)*ratio})
        else:
            raise ValueError(f'Unsupported separately defined stencil shape {p[3]}')
    for p in parse.kids(module,'fp_poly'):
        if any(x.endswith('.Paste') for x in parse.values(p,'layer',[])):
            expected.append({'kind':'polygon','points':[(float(x[1]),float(x[2])) for x in parse.kids(parse.one(p,'pts'),'xy')]})
    actual=[]
    for h,d in rows(document,'FILL'):
        if d.get('layerId') not in (7,8):
            continue
        path=d['path'][0]
        points,radii,angles=path_endpoint_geometry(path)
        pp=[(x*MM,y*MM) for x,y in points]
        bounds=[(min(x[i] for x in pp),max(x[i] for x in pp)) for i in (0,1)]
        actual.append({'id':h['id'],'path':path,'points':pp,'center':[(a+b)/2 for a,b in bounds],
                       'size':[b-a for a,b in bounds],'radii':[r*MM for r in radii],
                       'angles':angles,'boundary_stroke_mm':d['width']*MM})
    remaining=list(actual)
    results=[]
    for aperture in expected:
        def error(other):
            if aperture['kind']=='polygon':
                if other['angles']: return float('inf')
                return contour_error(aperture['points'],other['points'])
            if aperture['kind']=='rect' and other['angles']: return float('inf')
            if aperture['kind']=='roundrect' and (len(other['angles'])!=4 or any(abs(abs(x)-90)>1e-6 for x in other['angles'])):
                return float('inf')
            values=[math.dist(aperture['center'],other['center']), *[abs(a-b) for a,b in zip(aperture['size'],other['size'])]]
            values.extend(abs(r-aperture['radius']) for r in other['radii'])
            return max(values)
        if not remaining:
            results.append({'expected_kind':aperture['kind'],'native_id':None,'pass':False,'difference_mm':None})
            continue
        index=min(range(len(remaining)),key=lambda i:error(remaining[i]))
        match=remaining.pop(index)
        difference=error(match)
        results.append({'expected_kind':aperture['kind'],'native_id':match['id'],'pass':difference<TOL,
                        'difference_mm':difference if math.isfinite(difference) else None,
                        'boundary_stroke_mm':match['boundary_stroke_mm']})
    return {'expected_count':len(expected),'native_count':len(actual),'pass':len(expected)==len(actual) and all(r['pass'] for r in results),
            'apertures':results,'unmatched_native_ids':[a['id'] for a in remaining]}


def repair_library(document, path, microphone=False, suppress_numbers=None, source_paste=None):
    """Preserve IDs; repair layer expansion and proven reflected mic paste arcs.

    A live File Source capture may call this document PCB even though the
    project-export record labels the same UUID FOOTPRINT. Never alter DOCHEAD,
    META or primitive IDs: the live editor owns those native format fields.
    """
    output = []
    altered = []
    geometry_repairs = []
    for original, h, d0 in document.get('raw_rows',document['rows']):
        if d0 is None:
            output.append(original)
            continue
        d = dict(d0)
        patch_pad = h['type']=='PAD' and d.get('num') and d.get('layerId') in (1,2) and not (d.get('hole') or {}).get('width',0)
        patch_pad = patch_pad and (suppress_numbers is None or d['num'] in suppress_numbers)
        if patch_pad:
            fields = {'topPasteExpansion': -1000, 'bottomPasteExpansion': -1000}
            if microphone and d['num'] == '5':
                fields.update(topSolderExpansion=-1000, bottomSolderExpansion=-1000)
            changes = {k: {'before': d.get(k), 'after': v} for k, v in fields.items() if d.get(k) != v}
            d.update(fields)
            if changes:
                altered.append({'id': h['id'], 'number': d['num'], 'fields': changes})
                original = json.dumps(h, separators=(',', ':'))+'||'+json.dumps(d, separators=(',', ':'))+'|'
        if microphone and source_paste and h['type']=='FILL' and d.get('layerId')==7:
            pp = flat_points(d['path'][0])
            if len(pp)>4:
                old = [(x*MM,y*MM) for x,y in pp]
                flipped = [(x*MM,-y*MM) for x,y in pp]
                before_error = min(contour_error(p,old) for p in source_paste)
                after_error = min(contour_error(p,flipped) for p in source_paste)
                if before_error>=TOL and after_error<TOL:
                    coords, index = [], 0
                    for value in d['path'][0]:
                        if isinstance(value,str):
                            coords.append(value)
                        else:
                            coords.append(-value if index%2 else value)
                            index += 1
                    d['path']=[coords]
                    original = json.dumps(h,separators=(',',':'))+'||'+json.dumps(d,separators=(',',':'))+'|'
                    geometry_repairs.append({'id':h['id'],'operation':'Reflect only Y of curved paste FILL to match canonical local footprint coordinates',
                                              'max_contour_difference_after_mm':after_error,'vertices':len(pp)})
        output.append(original)
    path.write_text('\n'.join(output)+'\n', encoding='utf-8')
    check = packed(path)[0]
    assert len(check['raw_rows']) == len(document.get('raw_rows',document['rows']))
    for (_, bh, bd), (_, ah, ad) in zip(document.get('raw_rows',document['rows']), check['raw_rows']):
        assert bh == ah
        if bd is None:
            assert ad is None
            continue
        ignore = {'topPasteExpansion', 'bottomPasteExpansion'}
        if microphone and bd.get('num') == '5':
            ignore |= {'topSolderExpansion', 'bottomSolderExpansion'}
        if any(x['id']==bh.get('id') for x in geometry_repairs):
            ignore.add('path')
        assert {k: v for k, v in bd.items() if k not in ignore} == {k: v for k, v in ad.items() if k not in ignore}
    return {'path': str(path), 'sha256': sha(path), 'footprint_uuid': document['head']['uuid'],
            'native_title': title(document), 'record_count': len(output), 'changed_pads': altered,
            'geometry_repairs':geometry_repairs,
            'identifiers_and_all_other_geometry_preserved': True, 'native_apply_and_save': 'NOT_VERIFIED_BY_THIS_SCRIPT'}


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('capture', nargs='?', type=Path,
                      default=HERE/('pcb-final.esource' if (HERE/'pcb-final.esource').exists() else 'pcb-imported-before-fix.esource'))
    args.add_argument('--repair-libraries', action='store_true')
    options = args.parse_args()
    documents = packed(options.capture)
    doc_by_id = {d['head']['uuid']: d for d in documents}
    candidates = [d for d in documents if d['head']['docType'] == 'PCB' and title(d) == 'Quipus-B1']
    if len(candidates) != 1:
        raise ValueError(f'Expected one actual Quipus-B1 PCB DOCHEAD; found {len(candidates)}')
    pcb = candidates[0]
    errors = defaultdict(list)
    warnings = []
    def require(category, condition, message):
        if not condition:
            errors[category].append(message)

    canonical_path = ROOT/'output/pcb/Quipus-B1/connections.json'
    canonical = json.loads(canonical_path.read_text(encoding='utf-8'))
    canonical_components = {c['ref']: c for c in canonical['components']}
    assignments = {c['ref']: c for c in json.loads((EASYEDA/'assignments.json').read_text())['components']}
    placement = json.loads((EASYEDA/'placement.json').read_text())
    aliases = canonical.get('net_aliases', {})
    def normalize(net):
        if not net:
            return None
        while net in aliases:
            net = aliases[net]
        return net
    expected_nets = {normalize(p['net']) for c in canonical_components.values() for p in c['pins'] if p.get('net')}

    attrs = defaultdict(dict)
    for h, d in rows(pcb, 'ATTR'):
        attrs[d.get('parentId')][d.get('key')] = d.get('value')
    components, by_ref = {}, {}
    for h, d in rows(pcb, 'COMPONENT'):
        # New instances store Footprint in a visible attribute, while older
        # imported instances use FootprintName; direct attrs are also valid.
        metadata = {**d.get('attrs',{}),**attrs[h['id']]}
        ref = metadata.get('Designator')
        require('electrical', bool(ref), f'{h["id"]}: missing component designator')
        require('electrical', ref not in by_ref, f'{ref}: duplicate native component')
        instance = {'id': h['id'], 'data': d, 'attrs': metadata, 'ref': ref}
        components[h['id']] = instance
        by_ref[ref] = instance
    electronic_refs=set(by_ref)-{'H1','H2','H3','H4'}
    require('electrical', electronic_refs == set(canonical_components),
            f'Native reference set differs: missing {sorted(set(canonical_components)-set(by_ref))}; '
            f'extra {sorted(set(by_ref)-set(canonical_components)-{"H1","H2","H3","H4"})}')
    require('electrical',len(canonical_components)==180 and len(electronic_refs)==180,
            'Canonical/native electronic component count is not180')

    bindings = {}
    for h, d in rows(pcb, 'PAD_NET'):
        index = json.loads(h['id'])
        require('electrical', len(index) == 4 and index[0] == 'PAD_NET', f'Unexpected PAD_NET schema {h["id"]}')
        _, instance_id, number, primitive_id = index
        key = (instance_id, primitive_id)
        require('electrical', key not in bindings, f'Duplicate PAD_NET binding {key}')
        bindings[key] = {'number': number, 'net': normalize(d.get('padNet'))}

    used_nets = set()
    physical_count = 0
    linked_libraries = {}
    library_links = []
    for instance_id, instance in components.items():
        ref, metadata = instance['ref'], instance['attrs']
        footprint_id = metadata.get('FootprintName') or metadata.get('Footprint')
        library = doc_by_id.get(footprint_id)
        require('electrical', library is not None and library['head']['docType'] == 'FOOTPRINT', f'{ref}: unresolved native footprint {footprint_id}')
        if library is None:
            continue
        linked_libraries[ref] = library
        device_id = metadata.get('Device')
        device = doc_by_id.get(device_id)
        if device:
            device_meta = next((d for h, d in rows(device, 'META')), {})
            dev_fp = device_meta.get('attributes', {}).get('Footprint')
            require('metadata', not dev_fp or dev_fp == footprint_id, f'{ref}: DEVICE footprint link {dev_fp} differs from instance {footprint_id}')
            library_links.append({'ref': ref, 'device_uuid': device_id, 'device_title': title(device),
                                  'footprint_uuid': footprint_id, 'footprint_title': title(library)})
        if ref in canonical_components:
            assignment = assignments[ref]
            mapping = assignment.get('pad_mapping', assignment.get('padmap', {}))
            expectation = {str(mapping.get(str(p['number']), str(p['number']))): normalize(p.get('net'))
                           for p in canonical_components[ref]['pins']}
            for number, net in assignment.get('expected_pad_mapping', {}).items():
                require('electrical', str(number) in expectation and expectation[str(number)] == normalize(net),
                        f'{ref}.{number}: assignment disagrees with canonical net')
            expectation.update({str(n): None for n in assignment.get('additional_mechanical_pads', [])})
            # Audio's retained JST source declares its mounting pads in the
            # physical pad list/notes instead of the older mechanical list.
            # Permit only this explicitly named, netless hold-down category.
            expectation.update({str(p['number']):None for p in assignment.get('pads',[])
                                if p.get('number')=='MP' and p['number'] not in expectation})
        else:
            expectation = {}
        found_numbers = set()
        for ph, pd in rows(library, 'PAD'):
            physical_count += 1
            number = str(pd.get('num', ''))
            binding = bindings.get((instance_id, ph['id']))
            require('electrical', binding is not None, f'{ref}.{number}/{ph["id"]}: missing native pad binding')
            if binding is None:
                continue
            require('electrical', binding['number'] == number, f'{ref}/{ph["id"]}: PAD_NET number differs from footprint num')
            if number:
                found_numbers.add(number)
                require('electrical', number in expectation, f'{ref}.{number}: unexplained physical pad')
            require('electrical', binding['net'] == expectation.get(number),
                    f'{ref}.{number}/{ph["id"]}: net {binding["net"]!r} should be {expectation.get(number)!r}')
            if binding['net']:
                used_nets.add(binding['net'])
        require('electrical', found_numbers == set(expectation), f'{ref}: physical pin-number set differs from canonical/mechanical mapping')
        # A graphic has a blank PAD_NET metadata entry. It must never become a
        # hidden electrical island in the imported PCB.
        pad_ids = {h['id'] for h, d in rows(library, 'PAD')}
        for (cid, pid), binding in bindings.items():
            if cid == instance_id and pid not in pad_ids:
                require('electrical', not binding['number'] and not binding['net'], f'{ref}/{pid}: non-pad primitive has a net')

    selector_nets = set()
    for h, d in rows(pcb, 'RULE_SELECTOR'):
        selector = json.loads(h['id'])
        if len(selector) == 2 and selector[1][0] == 'NET':
            selector_nets.add(normalize(selector[1][1]))
    require('electrical', used_nets == expected_nets, 'Native physical-pad nets differ from canonical113 net set')
    require('electrical', selector_nets == expected_nets, 'Native RULE_SELECTOR net set differs from canonical113 nets')
    require('electrical', len(expected_nets) == 113, 'Canonical net count is not113')

    mounting_holes=[]
    for ref in ('H1','H2','H3','H4'):
        if ref not in by_ref or ref not in linked_libraries: continue
        instance=by_ref[ref]['data']
        for ph,pd in rows(linked_libraries[ref],'PAD'):
            hole=pd.get('hole') or {}
            if not pd.get('plated') and hole.get('width'):
                require('geometry',not pd['num'] and pd['layerId']==12 and abs(pd['centerX'])<1e-6 and abs(pd['centerY'])<1e-6,
                        f'{ref}: mounting-hole native footprint is not the proven centered NPTH')
                mounting_holes.append({'label':ref,'primitive_id':ph['id'],'native_component_id':by_ref[ref]['id'],
                                       'center_mm':[instance['x']*MM,-instance['y']*MM],
                                       'diameter_mm':hole['width']*MM,'plated':pd['plated'],'representation':'footprint component'})
    for ph,pd in rows(pcb,'PAD'):
        physical_count+=1
        hole=pd.get('hole') or {}
        require('electrical',not pd.get('num') and not normalize(pd.get('netName')) and not pd.get('plated') and hole.get('width'),
                f'{ph["id"]}: unexplained standalone board electrical pad')
        if not pd.get('plated') and hole.get('width'):
            require('geometry',pd['layerId']==12 and hole.get('holeType')=='ROUND' and abs(hole['width']-hole.get('height',0))*MM<TOL
                    and pd.get('defaultPad',{}).get('padType')=='ELLIPSE'
                    and all(abs(pd['defaultPad'].get(k,0)-hole[k])*MM<TOL for k in ('width','height')),
                    f'{ph["id"]}: free mounting primitive is not the proven multi-layer circular NPTH schema')
            mounting_holes.append({'label':None,'primitive_id':ph['id'],'native_component_id':None,
                                   'center_mm':[pd['centerX']*MM,-pd['centerY']*MM],
                                   'diameter_mm':hole['width']*MM,'plated':pd['plated'],'representation':'standalone native NPTH PAD'})
    require('geometry',len(mounting_holes)==4,f'Expected four physical board mounting NPTHs; found{len(mounting_holes)}')
    remaining=list(mounting_holes)
    for index,expected in enumerate(placement['mounting_holes'],1):
        if not remaining: continue
        hole=min(remaining,key=lambda p:math.dist(p['center_mm'],expected))
        remaining.remove(hole)
        hole['expected_label']=f'H{index}'
        require('geometry',math.dist(hole['center_mm'],expected)<.0026 and abs(hole['diameter_mm']-2.8)<TOL,
                f'H{index}: native mounting-hole center or2.8mm NPTH diameter differs from canonical geometry')

    mismatches = []
    for ref, expected in placement['placements'].items():
        if ref not in by_ref:
            continue
        d = by_ref[ref]['data']
        actual = [d['x']*MM, -d['y']*MM, d['angle'], {1:'F',2:'B'}.get(d['layerId'],str(d['layerId']))]
        ok = math.dist(actual[:2], expected[:2]) < .0026 and abs((actual[2]-expected[2]+180)%360-180) < 1e-6 and actual[3] == expected[3]
        if not ok:
            mismatches.append({'ref': ref, 'actual_mm_angle_side': actual, 'planned_mm_angle_side': expected})
        require('placement', ok, f'{ref}: native placement differs from current placement.json')
    outline = [d for h,d in rows(pcb,'POLY') if d.get('polyType') == 'BOARD_OUTLINE']
    require('geometry', len(outline) == 1, 'Expected exactly one native board outline')
    outline_dimensions = None
    if outline:
        pp = flat_points(outline[0]['path'])
        outline_dimensions = [(max(p[i] for p in pp)-min(p[i] for p in pp))*MM for i in (0,1)]
        require('geometry', all(abs(a-b)<TOL for a,b in zip(outline_dimensions,[65,125])), 'Native outline bounds changed from65x125mm')
    active_copper_layers = [d['layerName'] for h,d in rows(pcb,'LAYER') if d.get('use') and d.get('layerType') in ('TOP','BOTTOM','SIGNAL')]
    require('geometry', len(active_copper_layers) == 4, 'Native active copper-layer count differs from4')

    parse = parser()
    carrier_path = ROOT/'output/pcb/Quipus-B1-EasyEDA/Quipus-B1.kicad_pcb'
    carrier = parse.sexp(carrier_path.read_text(encoding='utf-8'))
    source_modules = {next(x[2] for x in parse.kids(m,'fp_text') if x[1]=='reference'): m for m in parse.kids(carrier,'module')}
    explicit_paste_audits = {}
    for ref in ('U1','U2','U11','U12','U20','U21','U22','U23'):
        result = paste_geometry_audit(linked_libraries[ref],source_modules[ref],parse)
        explicit_paste_audits[ref] = result
        require('geometry',result['pass'],f'{ref}: one or more explicit paste apertures differ from canonical local geometry')
    automatic_paste_checks = []
    for ref,module in source_modules.items():
        for source in parse.kids(module,'pad'):
            if not source[1] or source[2]!='smd' or any(x.endswith('.Paste') for x in parse.values(source,'layers',[])):
                continue
            source_at = list(map(float,parse.values(source,'at')[:2]))
            candidates = [(h,p) for h,p in rows(linked_libraries[ref],'PAD')
                          if p['num']==source[1] and p['layerId'] in (1,2) and not (p.get('hole') or {}).get('width',0)]
            if not candidates:
                require('geometry',False,f'{ref}.{source[1]}: surface land disappeared during native import')
                continue
            h,p = min(candidates,key=lambda hp:math.dist(source_at,[hp[1]['centerX']*MM,hp[1]['centerY']*MM]))
            suppressed = p['topPasteExpansion']==-1000 and p['bottomPasteExpansion']==-1000
            automatic_paste_checks.append({'ref':ref,'number':source[1],'native_pad_id':h['id'],
                                           'footprint_uuid':linked_libraries[ref]['head']['uuid'],
                                           'source_smd_layer_excludes_paste':True,'automatic_paste_suppressed':suppressed})
            require('stencil',suppressed,f'{ref}.{source[1]}/{h["id"]}: automatic paste enabled although source SMD layer excludes paste')
    critical = []
    for ref in ('U20','U21','U23'):
        library = linked_libraries[ref]
        pads = rows(library,'PAD')
        source_pads = [p for p in parse.kids(source_modules[ref],'pad') if p[1]]
        details = {'ref':ref,'footprint_uuid':library['head']['uuid'],'native_title':title(library),
                   'native_electrical_pad_count':len([1 for h,p in pads if p['num']]), 'custom_contours':[],
                   'explicit_paste_aperture_count':len(rows(library,'FILL'))}
        # Match repeated ground-quarter pads by their absolute local origins.
        for h,p in pads:
            if not p['num']:
                continue
            candidates = [s for s in source_pads if s[1] == p['num']]
            source = min(candidates,key=lambda s:math.dist(list(map(float,parse.values(s,'at')[:2])),[p['centerX']*MM,p['centerY']*MM]))
            require('geometry', math.dist(list(map(float,parse.values(source,'at')[:2])),[p['centerX']*MM,p['centerY']*MM])<TOL,
                    f'{ref}.{p["num"]}/{h["id"]}: critical local pad origin changed')
            if p['defaultPad']['padType']=='POLYGON':
                native_polygon = [(x*MM,y*MM) for x,y in flat_points(p['defaultPad']['path'])]
                expected_polygon = source_polygon(source,parse)
                error = contour_error(expected_polygon,native_polygon)
                require('geometry',error<TOL,f'{ref}.{p["num"]}/{h["id"]}: custom copper contour changed')
                details['custom_contours'].append({'id':h['id'],'number':p['num'],'vertices':len(native_polygon),
                                                   'max_contour_difference_mm':error if math.isfinite(error) else None})
            else:
                actual_size = [p['defaultPad']['width']*MM,p['defaultPad']['height']*MM]
                require('geometry',all(abs(a-b)<TOL for a,b in zip(actual_size,map(float,parse.values(source,'size')))),
                        f'{ref}.{p["num"]}: critical copper size changed')
            expected_mask_margin = .05 if ref in ('U20','U21') and p['num']!='5' else .07 if ref=='U23' else None
            if expected_mask_margin is not None:
                require('geometry',all(abs(p[field]*MM-expected_mask_margin)<TOL for field in ('topSolderExpansion','bottomSolderExpansion')),
                        f'{ref}.{p["num"]}: automatic pad mask margin changed')
        source_paste = source_paste_contours(source_modules[ref],parse)
        native_paste = [[(x*MM,y*MM) for x,y in flat_points(d['path'][0])] for h,d in rows(library,'FILL')]
        require('geometry',len(source_paste)==len(native_paste),f'{ref}: paste aperture count differs from carrier')
        remaining = list(native_paste)
        paste_errors = []
        for polygon in source_paste:
            if not remaining:
                break
            index = min(range(len(remaining)),key=lambda i:contour_error(polygon,remaining[i]))
            difference = contour_error(polygon,remaining.pop(index))
            paste_errors.append(difference)
            require('geometry',difference<TOL,f'{ref}: explicit paste aperture contour changed')
        max_paste_error = max(paste_errors,default=0)
        details['max_explicit_paste_contour_difference_mm'] = max_paste_error if math.isfinite(max_paste_error) else None
        if ref in ('U20','U21'):
            hole = next((p for h,p in pads if not p['num']),None)
            require('geometry',hole is not None and not hole['plated'] and abs(hole['hole']['width']*MM-.6)<TOL,
                    f'{ref}: acoustic0.60mm NPTH missing or changed')
            require('geometry',len(details['custom_contours'])==4 and all(x['number']=='5' and x['vertices']==182 for x in details['custom_contours']),
                    f'{ref}: four182-vertex ground quarters not retained')
            quarter_gaps = []
            if hole:
                center = (hole['centerX'],hole['centerY'])
                for h,p in pads:
                    if p['num']!='5': continue
                    pp = flat_points(p['defaultPad']['path'])
                    require('geometry',not inside(center,pp) and inside((p['centerX'],p['centerY']),pp),f'{ref}/{h["id"]}: quarter anchor/acoustic hole containment incorrect')
                    gap = min(distance(center,a,b) for a,b in zip(pp,pp[1:]+pp[:1]))*MM-hole['hole']['width']*MM/2
                    quarter_gaps.append(gap)
                    require('geometry',gap>.19247,f'{ref}/{h["id"]}: NPTH-to-quarter clearance fell below canonical0.19247mm')
                    require('stencil',p['topSolderExpansion']==-1000 and p['bottomSolderExpansion']==-1000,
                            f'{ref}/{h["id"]}: auto quarter mask overrides separately defined annular mask')
            details['minimum_quarter_copper_to_npth_mm'] = min(quarter_gaps) if quarter_gaps else None
            details['acoustic_npth_diameter_mm'] = hole['hole']['width']*MM if hole else None
            mask = [p for h,p in rows(library,'POLY') if p['layerId']==5]
            require('geometry',len(mask)==1 and abs(mask[0]['width']*MM-.47)<TOL,f'{ref}: explicit annular solder-mask ring missing/changed')
            if len(mask)==1 and hole:
                # Two180-degree arcs share diameter endpoints. This is a
                # stroked annulus, not a filled disk over the acoustic port.
                path = mask[0]['path']
                mask_shape = len(path)==10 and path[2]=='ARC' and path[3]==180 and path[6]=='ARC' and path[7]==180
                require('geometry',mask_shape,f'{ref}: mask ring is not two180-degree arcs')
                if mask_shape:
                    midpoint = ((path[0]+path[4])/2,(path[1]+path[5])/2)
                    radius = math.dist((path[0],path[1]),(path[4],path[5]))*MM/2
                    require('geometry',math.dist(midpoint,(hole['centerX'],hole['centerY']))*MM<TOL and abs(radius-.6775)<TOL,
                            f'{ref}: explicit mask annulus center/radius changed')
            require('geometry',details['explicit_paste_aperture_count']==7,f'{ref}: explicit7-aperture microphone stencil changed')
        else:
            require('geometry',{p['num'] for h,p in pads}=={str(x) for x in range(1,26)},'U23: ADC pins1..24 and exposed-pad25 not retained')
            require('geometry',len(details['custom_contours'])==24,'U23: ADC D-shaped24 perimeter lands not retained')
            require('geometry',details['explicit_paste_aperture_count']==28,'U23: ADC24 perimeter +4 EP paste windows not retained')
            ep = next(p for h,p in pads if p['num']=='25')
            details['exposed_pad25_size_mm']=[ep['defaultPad']['width']*MM,ep['defaultPad']['height']*MM]
            require('geometry',all(abs(x-2.7)<TOL for x in details['exposed_pad25_size_mm']),'U23: exposed pad25 must be2.7x2.7mm')
        details['paste_boundary_stroke_mm'] = sorted({d['width']*MM for h,d in rows(library,'FILL')})
        critical.append(details)

    warnings.append('Native converts explicit paste fill width0 to0.2mil (0.00508mm). Actual plotted stencil bounds require exported Gerber inspection.')
    warnings.append('This audit verifies saved document data and does not route copper. Native editor DRC results are recorded separately from these parity checks.')
    if not any(errors.values()):
        warnings.append('This native project capture contains all targeted footprint repairs and four physical mounting NPTHs. Apply/Save witness evidence is recorded in the repair reports.')
    else:
        warnings.append('Repair candidate output alone does not verify Apply, Save or component refresh; obtain a corrected saved project capture before marking those steps complete.')
    repairs = []
    if options.repair_libraries:
        # Prefer the actual live editor document when available. Its DOCHEAD
        # may be PCB instead of FOOTPRINT and its metadata is editor-owned.
        mic_live = HERE/'mic-editor-before.esource'
        adc_live = HERE/'adc-editor-before.esource'
        mic_document = packed(mic_live)[0] if mic_live.exists() else linked_libraries['U20']
        adc_document = packed(adc_live)[0] if adc_live.exists() else linked_libraries['U23']
        repairs.append(repair_library(mic_document,HERE/'mic-library-fixed.esource',True,
                                      source_paste=source_paste_contours(source_modules['U20'],parse)))
        repairs.append(repair_library(adc_document,HERE/'adc-library-fixed.esource'))
        for ref,numbers in [('U1',{'41'}),('U2',{'17'}),('U11',{'8'}),('U12',{'13'}),('U22',{'17'})]:
            live = HERE/f'{ref.lower()}-editor-before.esource'
            document = packed(live)[0] if live.exists() else linked_libraries[ref]
            repairs.append(repair_library(document,HERE/f'{ref.lower()}-library-fixed.esource',suppress_numbers=numbers))
    categories = ('electrical','metadata','placement','geometry','stencil')
    audit = {
        'status':'NATIVE_CAPTURE_CHECKS_PASS_ROUTING_AND_MANUFACTURING_REMAIN' if not any(errors.values()) else 'NATIVE_CAPTURE_REQUIRES_CORRECTION_OR_UPDATED_CAPTURE',
        'manufacturing_release':False,
        'capture':str(options.capture.resolve()),'capture_sha256':sha(options.capture),
        'canonical_connections_sha256':sha(canonical_path),'carrier_sha256':sha(carrier_path),
        'pcb_document_uuid':pcb['head']['uuid'],'pcb_document_title':title(pcb),
        'packed_document_count':len(documents),'actual_pcb_record_counts':dict(Counter(h['type'] for _,h,d in pcb['rows'])),
        'native_history_replay':{'pcb':pcb['history'],'packed_raw_records':sum(d['history']['raw_records'] for d in documents),
                                 'packed_active_records':sum(d['history']['active_records'] for d in documents),
                                 'all_document_tombstones':sum(d['history']['tombstone_count'] for d in documents),
                                 'all_document_superseded_records':sum(len(d['history']['superseded_records']) for d in documents)},
        'original_pre_fix_capture_sha256':sha(HERE/'pcb-imported-before-fix.esource'),
        'electronic_components':len(set(by_ref)&set(canonical_components)),'mechanical_components':len(set(by_ref)-set(canonical_components)),
        'canonical_net_count':len(expected_nets),'native_pad_net_count':len(used_nets),'native_selector_net_count':len(selector_nets),
        'native_physical_pad_instances':physical_count,
        'board_bounding_dimensions_mm':outline_dimensions,'active_copper_layers':active_copper_layers,
        'mounting_holes':mounting_holes,
        'category_results':{c:'PASS' if not errors[c] else 'FAIL' for c in categories},
        'errors':dict(errors),'placement_mismatches':mismatches,'critical_audio_footprints':critical,
        'source_copper_only_smd_paste_checks':automatic_paste_checks,
        'all_explicit_paste_aperture_audits':explicit_paste_audits,
        'critical_device_footprint_relationships':[l for l in library_links if l['ref'] in ('U20','U21','U23')],
        'repair_candidates':repairs,'warnings':warnings,
        'schema_notes':[
            'Counts are from actual PCB DOCHEAD only; library DEVICE and FOOTPRINT records are excluded from instance/net counts.',
            'Every electrical PAD_NET is joined to its actual linked FOOTPRINT PAD ID; blank graphic bindings do not create physical pads.',
            'Pad numbers repeat intentionally for four microphone ground quarters; every occurrence is independently compared to GND.',
            'Native polygon paths are absolute footprint-local coordinates, including imported back-face reflection; no anchor offset is added twice.',
            'Native canvas uses mils and negative world Y. Position audit converts to positive board-mm Y.',
            'Metadata PASS covers DEVICE-to-FOOTPRINT UUID linkage only; native schematic synchronization and native DRC results require separate UI evidence.',
            'Saved epru contains identifiable empty-body tombstones; actual active records are replayed by(type,id), with removed keys explicitly recorded in this audit.',
            'Footprint and FootprintName are both native instance metadata variants; newer imported component IDs may be UUIDs rather than ieNNN.',
        ],
    }
    (HERE/'native-audit.json').write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:audit[k] for k in ('status','capture_sha256','electronic_components','mechanical_components','native_pad_net_count','native_physical_pad_instances','category_results')}))
    print(json.dumps({'error_counts':{c:len(errors[c]) for c in categories},'placement_mismatches':mismatches,'audit':str(HERE/'native-audit.json')}))


if __name__=='__main__':
    main()
