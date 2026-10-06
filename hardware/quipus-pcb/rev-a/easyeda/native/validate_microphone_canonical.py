"""Audit an actual native File Source capture against the v3 candidate."""
from __future__ import annotations
import json
import math
from pathlib import Path
import sys
from repair_microphone import records, hash_file, MM_PER_MIL
from repair_microphone_v2 import inside, distance_to_segment
from repair_microphone_v3 import AFTER as CANDIDATE
from render_microphone_repair import points


def difference(a, b, field=''):
    """Structural diff, reporting numeric path precision without dumping arrays."""
    if isinstance(a, (float, int)) and isinstance(b, (float, int)) and not isinstance(a, bool):
        return [] if a == b else [{'field': field, 'before': a, 'after': b, 'delta': b-a}]
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [v for i, (aa, bb) in enumerate(zip(a, b)) for v in difference(aa, bb, field+f'[{i}]')]
    if isinstance(a, dict) and isinstance(b, dict):
        return [v for k in a.keys()|b.keys() for v in difference(a.get(k), b.get(k), field+'.'+k)]
    return [] if a == b else [{'field': field, 'before': a, 'after': b}]


def main():
    capture = Path(sys.argv[1]) if len(sys.argv) > 1 else CANDIDATE.with_name('microphone-native-after-v3.esource')
    b, a = records(CANDIDATE), records(capture)
    before = {h['id']: (h, d) for _, h, d in b if 'id' in h}
    after = {h['id']: (h, d) for _, h, d in a if 'id' in h}
    assert set(before) == set(after) and len(a) == len(b)
    pads = [(h, d) for _, h, d in a if h['type'] == 'PAD']
    hole = next(d for h, d in pads if d['num'] == '')
    centre = (hole['centerX'], hole['centerY'])
    copper = []
    for h, d in pads:
        assert d['num'] == before[h['id']][1]['num']
        if d['num'] != '5':
            continue
        poly = points(d['defaultPad']['path'])
        if poly[0] == poly[-1]:
            poly.pop()
        assert not inside(centre, poly)
        assert inside((d['centerX'], d['centerY']), poly)
        spacing = min(distance_to_segment(centre, x, y) for x, y in zip(poly, poly[1:]+poly[:1]))*MM_PER_MIL-hole['hole']['width']*MM_PER_MIL/2
        assert spacing > .19247
        copper.append({'id': h['id'], 'num': d['num'], 'origin_mm': [d['centerX']*MM_PER_MIL, d['centerY']*MM_PER_MIL],
                       'origin_inside_copper': True, 'acoustic_center_outside_copper': True,
                       'minimum_copper_to_npth_mm': spacing, 'path_vertices': len(poly)})
    assert len(copper) == 4
    shape_diffs = []
    for ident, (bh, bd) in before.items():
        ah, ad = after[ident]
        if bh['type'] not in ('PAD', 'FILL', 'POLY'):
            continue
        changes = difference(bd, ad)
        if not changes:
            continue
        # Coordinates and dimensions canonically round to 4 decimal mil.
        winding_check = None
        if bh['type'] == 'PAD' and bd['num'] == '5':
            bp, ap = points(bd['defaultPad']['path']), points(ad['defaultPad']['path'])
            if bp[0] == bp[-1]: bp.pop()
            if ap[0] == ap[-1]: ap.pop()
            assert len(bp) == len(ap)
            trials = []
            for reverse in (False, True):
                contour = list(reversed(bp)) if reverse else bp
                offset = min(range(len(contour)), key=lambda i: math.dist(contour[i], ap[0]))
                rotated = contour[offset:]+contour[:offset]
                trials.append((max(math.dist(x, y) for x, y in zip(rotated, ap)), reverse, offset))
            error, reverse, offset = min(trials)
            assert error < .000071
            winding_check = {'native_winding_reversed': reverse, 'cyclic_start_offset': offset,
                             'max_contour_rounding_mil': error, 'max_contour_rounding_mm': error*MM_PER_MIL,
                             'same_closed_copper_geometry': True}
            changes = [c for c in changes if not c['field'].startswith('.defaultPad.path')]
        other = [c for c in changes if not isinstance(c.get('delta'), (int, float))]
        numeric = [c for c in changes if 'delta' in c]
        width = [c for c in numeric if c['field'] == '.width' and bh['type'] == 'FILL']
        rounding = [c for c in numeric if c not in width]
        assert not other
        assert all(abs(c['delta']) <= .0000500001 for c in rounding)
        assert all(c['before'] == 0 and c['after'] == .2 for c in width)
        shape_diffs.append({'id': ident, 'type': bh['type'], 'numeric_rounding_count': len(rounding),
                            'max_rounding_mil': max((abs(c['delta']) for c in rounding), default=0),
                            'paste_width_clamp': width, 'contour_winding_check': winding_check})
    assert all(d['topPasteExpansion'] == -1000 and d['bottomPasteExpansion'] == -1000 for h, d in pads if d['num'])
    all_copper = [p for h, d in pads if d['num'] == '5' for p in points(d['defaultPad']['path'])]
    copper_od = [(max(p[i] for p in all_copper)-min(p[i] for p in all_copper))*MM_PER_MIL for i in (0, 1)]
    mask = next(d for _, h, d in a if h.get('id') == 'ie19')
    mask_r = (mask['path'][0]-centre[0])*MM_PER_MIL
    mask_stroke = mask['width']*MM_PER_MIL
    paste_dimensions = []
    for _, h, d in a:
        if h['type'] != 'FILL': continue
        poly = points(d['path'][0])
        bounds = [(max(p[i] for p in poly)-min(p[i] for p in poly))*MM_PER_MIL for i in (0, 1)]
        stroke = d['width']*MM_PER_MIL
        entry = {'id': h['id'], 'contour_bounds_mm': bounds, 'boundary_stroke_mm': stroke,
                 'bounds_if_stroke_plotted_mm': [v+stroke for v in bounds]}
        if h['id'] in ('ie20', 'ie21', 'ie22'):
            radii = [math.dist(centre, p)*MM_PER_MIL for p in poly]
            entry['contour_radii_mm'] = [min(radii), max(radii)]
            entry['radii_if_stroke_plotted_mm'] = [min(radii)-stroke/2, max(radii)+stroke/2]
        paste_dimensions.append(entry)
    audit = {
        'status': 'NATIVE_V3_CAPTURE_HAS_COMPLETE_CORRECT_GEOMETRY_APPLY_DIALOG_AND_LIBRARY_DRC_NOT_YET_ACCEPTED',
        'capture': str(capture), 'capture_sha256': hash_file(capture), 'candidate_sha256': hash_file(CANDIDATE),
        'record_count': len(a), 'pad_count': len(pads), 'electrical_pin_numbers': ['1', '2', '3', '4', '5', '5', '5', '5'],
        'all_identifiers_present': True, 'no_added_or_removed_native_ids_vs_candidate': True,
        'quarter_checks': copper, 'canonical_shape_differences': shape_diffs,
        'all_explicit_paste_fills_present': len([1 for _, h, d in a if h['type'] == 'FILL']) == 7,
        'automatic_paste_suppression_retained': True,
        'native_fill_width_mil': .2, 'native_fill_width_mm': .00508,
        'native_fill_width_observation': 'Native canonicalizes width0 to0.2mil; stencil boundary effect needs actual Gerber inspection.',
        'actual_dimensions': {'copper_bounding_diameter_xy_mm': copper_od,
                              'npth_diameter_mm': hole['hole']['width']*MM_PER_MIL,
                              'mask_od_mm': 2*mask_r+mask_stroke, 'mask_id_mm': 2*mask_r-mask_stroke,
                              'paste_aperture_dimensions': paste_dimensions},
        'native_ticket_order': [h.get('ticket') for _, h, _ in a if h.get('ticket')],
        'v3_changes': {'path_coordinate_mode': 'absolute footprint coordinates'},
        'notes': ['Parent reports concentric native red copper, gray NPTH and purple mask after V3; Apply still reports Invalidformat.',
                  'Complete native canonical capture is evidence that all shapes parsed; it is not evidence of successful library Save or PCB instance update.',
                  'Do not describe V3 as accepted until normal native save/refresh and DRC validation succeeds.'],
    }
    verified_path = CANDIDATE.with_name('microphone-native-verification-status.json')
    verified = json.loads(verified_path.read_text(encoding='utf-8')) if verified_path.exists() else None
    if verified:
        assert verified['source_sha256'] == hash_file(capture)
        audit['status'] = 'NATIVE_MICROPHONE_GEOMETRY_PASS_ACCEPTED_SAVED_ROUTING_AND_RELEASE_INCOMPLETE'
        audit['native_verification_status'] = verified
        audit['notes'] = ['Canonical native Apply is accepted, library is saved and U20/U21 are refreshed, as confirmed by the parent.',
                          'The original two microphone copper-ring/NPTH clearance errors are resolved; final whole-board DRC count is recorded separately when supplied.',
                          'New-instance quarter GND assignment, routing and stencil review retain their explicit stages in native_verification_status.',
                          'Geometry PASS and successful native Save do not constitute complete routing or fabrication qualification.']
    out = capture.with_suffix('.audit.json')
    out.write_text(json.dumps(audit, indent=2)+'\n', encoding='utf-8')
    final = capture.with_name('microphone-footprint-final.esource')
    final.write_bytes(capture.read_bytes())
    final_audit = dict(audit)
    final_audit['final_artifact'] = str(final)
    final_audit['final_artifact_sha256'] = hash_file(final)
    final_audit['native_gui_apply'] = verified['native_gui_apply'] if verified else 'pending parent verification'
    final_audit['native_library_save'] = verified['native_library_save'] if verified else 'pending parent verification'
    final_audit['native_pcb_instance_refresh_and_drc'] = {
        'refresh': verified['native_pcb_instance_refresh'] if verified else 'pending parent verification',
        'microphone_clearance': verified['microphone_geometry_clearance'] if verified else 'pending parent verification',
        'whole_board_final_drc_count': verified['native_final_drc_count'] if verified else 'pending parent verification',
    }
    final_audit['manufacturing_release'] = False
    final.with_suffix('.audit.json').write_text(json.dumps(final_audit, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'audit': str(out), 'capture_sha256': audit['capture_sha256'], 'minimum_copper_to_npth_mm': min(c['minimum_copper_to_npth_mm'] for c in copper), 'all_shapes_retained': True}))


if __name__ == '__main__':
    main()
