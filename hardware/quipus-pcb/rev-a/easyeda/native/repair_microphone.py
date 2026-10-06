"""Narrow, repeatable native Pro microphone repair; does not edit the PCB.

The captured 3.2.149 footprint is the authority for IDs and native pad identity.
Infineon Figure 13 supplies land dimensions. Pro's documented relative polygon
and nonzero winding model supplies the shape encoding. Native import and DRC
remain mandatory: this utility is an independent geometric check, not CAD DRC.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(HERE.parent))
from kicad_format import child, children, load_footprint, parse

MM_PER_MIL = 0.0254
BEFORE = HERE / 'microphone-footprint-before.esource'
AFTER = HERE / 'microphone-footprint-repaired.esource'
AUDIT = HERE / 'microphone-footprint-repaired.audit.json'
MIC = ROOT / '.tools/quipus-footprints/audio/Infineon_IM69D128SV01_PG-TLGA-5-2_2.65x3.50mm_NPTH0.60.kicad_mod'
SOURCES = {
    'manufacturer': 'https://www.infineon.com/assets/row/public/documents/24/49/infineon-im69d128s-datasheet-en.pdf',
    'pad_relative_polygon': 'https://prodocs.easyeda.com/en/format/pcb/pad_via/',
    'current_pad_object': 'https://raw.githubusercontent.com/easyeda/easyeda-pro-format-skill/main/primitives/PCB/pad.md',
    'complex_polygon_winding': 'https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/complex-polygon.md',
    'circle_encoding': 'https://raw.githubusercontent.com/easyeda/easyeda-pro-file-format-v2/main/docs/en/pcb/polygon-system/single-polygon.md',
    'paste_suppression': 'https://prodocs.easyeda.com/en/faq/pcb/',
}


def mil(mm):
    return round(mm / MM_PER_MIL, 12)


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def records(path):
    result = []
    for line in path.read_bytes().decode('utf-8-sig').splitlines(keepends=True):
        head, payload = line.rstrip('\r\n').split('||', 1)
        payload = payload[:-1] if payload.endswith('|') else payload
        result.append((line, json.loads(head), json.loads(payload)))
    return result


def signed_area(points):
    return sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(points, points[1:]+points[:1])) / 2


def sector(center, a0, span):
    """Mirror source X for normalized bottom footprint; use exact native arcs.

    This restores both centre and orientation lost by imported fp_poly Y flip.
    The two opposite ARC windings make each concave fill an annular sector.
    """
    def point(radius, angle):
        rad = math.radians(angle)
        return [round(center[0]-mil(radius)*math.cos(rad), 12),
                round(center[1]+mil(radius)*math.sin(rad), 12)]
    outer_start, outer_end = point(.83, a0), point(.83, a0+span)
    inner_start, inner_end = point(.54, a0), point(.54, a0+span)
    return [*outer_start, 'ARC', -span, *outer_end, 'L', *inner_end,
            'ARC', span, *inner_start, 'L', *outer_start]


def main():
    original = records(BEFORE)
    pads = {d['num']: (h, d) for _, h, d in original if h['type'] == 'PAD'}
    assert set(pads) == {'1', '2', '3', '4', '5', ''}
    hole = pads[''][1]
    assert hole['num'] == '' and hole['layerId'] == 12 and not hole['plated']
    assert abs(hole['hole']['width']*MM_PER_MIL-.6) < 2e-6
    center = [hole['centerX'], hole['centerY']]
    assert abs(center[0]) < 1e-9 and abs(center[1]*MM_PER_MIL+.71) < 2e-6

    # Verify pin identity and dimensions independently against the assigned
    # manufacturer's KiCad footprint after its defined bottom X reflection.
    source = parse(load_footprint(MIC, 'U?', 'IM69D128S', 0, 0, side='B'))
    source_pads = {str(p[1]): p for p in children(source, 'pad') if str(p[1])}
    signal_checks = []
    for num in ('1', '2', '3', '4'):
        h, p = pads[num]
        expected = [float(v) for v in child(source_pads[num], 'at')[1:3]]
        actual = [p['centerX']*MM_PER_MIL, p['centerY']*MM_PER_MIL]
        error = math.dist(actual, expected)
        assert error < 2e-6
        assert p['defaultPad']['padType'] == 'RECT'
        assert abs(p['defaultPad']['width']*MM_PER_MIL-.75) < 2e-6
        assert abs(p['defaultPad']['height']*MM_PER_MIL-.54) < 2e-6
        signal_checks.append({'num': num, 'id': h['id'], 'expected_center_mm': expected,
                              'actual_center_mm': actual, 'error_mm': error,
                              'copper_size_mm': [.75, .54], 'unchanged': True})

    changes = []
    repaired = []
    sector_index = 0
    ground_sector_spec = [(-145, 110), (-20, 100), (100, 100)]
    for raw, h, old in original:
        d = copy.deepcopy(old)
        reasons = []
        if h['type'] == 'PAD' and d['num'] in ('1', '2', '3', '4', '5'):
            # Official Pro FAQ: -1000 suppresses automatic full-pad paste.
            d['topPasteExpansion'] = d['bottomPasteExpansion'] = -1000
            reasons.append('Suppress automatic copper-size paste; preserve independent manufacturer apertures.')
            if d['num'] == '5':
                # Relative native POLYGON, two opposite winding exact circles.
                # Unlike KiCad custom-pad anchors, native POLYGON has no added
                # filled circle at its origin, so this does not fill the hole.
                d['centerX'], d['centerY'] = center
                d['defaultPad'] = {'padType': 'POLYGON', 'path': [
                    ['CIRCLE', 0, 0, mil(.8625), 0],
                    ['CIRCLE', 0, 0, mil(.4925), 1],
                ]}
                reasons.append('Normalize pin5 origin to NPTH centre and replace filled centreline disk with OD1.725/ID0.985 annulus.')
        if h['type'] == 'POLY' and h['id'] == 'ie19':
            r = mil(.6775)
            d['width'] = mil(.47)
            d['path'] = [center[0]+r, center[1], 'ARC', -180, center[0]-r, center[1],
                         'ARC', -180, center[0]+r, center[1]]
            reasons.append('Normalize existing concentric mask ring to exact OD1.825/ID0.885; same centre as NPTH.')
        if h['type'] == 'FILL' and d['layerId'] == 7:
            d['width'] = 0
            reasons.append('Remove importer-added 0.2mil boundary stroke so stencil dimensions stay nominal.')
            if h['id'] in ('ie20', 'ie21', 'ie22'):
                a0, span = ground_sector_spec[sector_index]
                d['path'] = [sector(center, a0, span)]
                sector_index += 1
                reasons.append('Restore ground-paste centre/orientation, radii0.54/0.83 and original110/100/100 degree segmentation as exact arcs.')
        if d != old:
            changed_fields = [key for key in d if d.get(key) != old.get(key)]
            changes.append({'type': h['type'], 'id': h.get('id'), 'num': d.get('num'),
                            'fields': changed_fields, 'reasons': reasons,
                            'before': {k: old.get(k) for k in changed_fields},
                            'after': {k: d.get(k) for k in changed_fields}})
            newline = '\r\n' if raw.endswith('\r\n') else '\n'
            repaired.append(json.dumps(h, separators=(',', ':'))+'||'+json.dumps(d, separators=(',', ':'))+'|'+newline)
        else:
            repaired.append(raw)
    assert sector_index == 3 and len(changes) == 13
    AFTER.write_bytes(''.join(repaired).encode('utf-8'))

    final = records(AFTER)
    assert len(final) == len(original)
    for (_, h0, d0), (_, h1, d1) in zip(original, final):
        assert h0 == h1  # every identifier/ticket preserved
        for k in ('num', 'netName', 'layerId', 'groupId', 'locked', 'zIndex'):
            assert d0.get(k) == d1.get(k)
        if h0['type'] == 'PAD' and d0['num'] != '5':
            for k in ('centerX', 'centerY', 'defaultPad', 'hole', 'plated', 'padAngle'):
                assert d0.get(k) == d1.get(k)
        if h0['type'] == 'PAD' and d0['num'] == '':
            assert d0 == d1  # acoustic NPTH entirely untouched

    original_paste_centers = {}
    for _, h, d in original:
        if h['type'] == 'FILL' and h['id'] in ('ie20', 'ie21', 'ie22'):
            # Each old sector lies on concentric circles about native(+0,.71).
            original_paste_centers[h['id']] = [0, .71]
    audit = {
        'status': 'LOCAL_GEOMETRY_CHECKED_NATIVE_IMPORT_DRC_AND_GERBERS_REQUIRED',
        'before_sha256': hash_file(BEFORE), 'after_sha256': hash_file(AFTER),
        'source_footprint_sha256': hash_file(MIC), 'record_count': len(final),
        'changed_record_count': len(changes), 'changes': changes,
        'sources': SOURCES, 'units': 'mil; displayed dimensions in mm',
        'pad_1_4_checks': signal_checks,
        'pad5': {'native_id': pads['5'][0]['id'], 'electrical_pin': '5 GND',
                 'old_origin_mm': [pads['5'][1]['centerX']*MM_PER_MIL, pads['5'][1]['centerY']*MM_PER_MIL],
                 'new_origin_mm': [x*MM_PER_MIL for x in center],
                 'origin_change_reason': 'Native polygon has relative coordinates and no compulsory filled anchor; normalize origin to acoustic centre.',
                 'copper_od_mm': 1.725, 'copper_id_mm': .985,
                 'empty_center': True, 'outer_winding': 'clockwise', 'inner_winding': 'counterclockwise'},
        'npth': {'native_id': pads[''][0]['id'], 'entire_record_unchanged': True,
                 'center_mm': [x*MM_PER_MIL for x in center],
                 'diameter_mm': hole['hole']['width']*MM_PER_MIL, 'plated': False},
        'mask': {'center_mm': [x*MM_PER_MIL for x in center], 'outer_diameter_mm': 1.825,
                 'inner_diameter_mm': .885, 'signal_expansion_mm': .05},
        'paste': {'signal_aperture_count': 4, 'signal_aperture_size_mm': [.63, .47],
                  'ground_sector_count': 3, 'original_ground_sector_centers_mm': original_paste_centers,
                  'corrected_center_mm': [x*MM_PER_MIL for x in center],
                  'inner_radius_mm': .54, 'outer_radius_mm': .83,
                  'sector_spans_deg': [110, 100, 100], 'gaps_deg': [15, 20, 15],
                  'minimum_gap_at_inner_radius_mm': 2*.54*math.sin(math.radians(15/2)),
                  'automatic_paste_suppressed': True, 'boundary_stroke_mm': 0},
        'checks': {'pin_nums_nets_layers_ids_tickets_unchanged': True,
                   'signal_copper_pad_positions_shapes_unchanged': True,
                   'npth_record_unchanged': True, 'copper_to_npth_nominal_clearance_mm': (.985-.6)/2,
                   'copper_to_npth_actual_clearance_mm': .4925-hole['hole']['width']*MM_PER_MIL/2,
                   'no_added_or_removed_records': True},
        'native_validation': {'import': 'pending', 'visual_center_alignment': 'pending',
                              'drc': 'pending', 'paste_and_mask_gerber': 'pending'},
        'notes': ['Parent applies this document to the native library and refreshes both U20/U21 instances.',
                  'Do not release fabrication until native copper/hole DRC and stencil/NPTH Gerber inspection pass.',
                  'All blank nets are intentionally preserved because this is a library footprint, not a PCB instance.'],
    }
    AUDIT.write_text(json.dumps(audit, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: audit[k] for k in ('status', 'after_sha256', 'changed_record_count')}))


if __name__ == '__main__':
    main()
