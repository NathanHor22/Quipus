"""Flat-polygon native fallback: 4 connected quarters, shared GND pin5.

Nested CIRCLE compound pads were not rendered by the current editor. This
candidate uses the exact flat L-path syntax captured from native File Source.
No PCB/application edits are made. Native acceptance remains necessary.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
from pathlib import Path
from repair_microphone import AFTER as V1, AUDIT as V1_AUDIT, records, mil, hash_file, MM_PER_MIL

AFTER = V1.with_name('microphone-footprint-repaired-v2.esource')
AUDIT = V1.with_name('microphone-footprint-repaired-v2.audit.json')


def quarter(angle, steps=90):
    angles = [math.radians(angle-45+i*90/steps) for i in range(steps+1)]
    outer = [(mil(.8625)*math.cos(a), mil(.8625)*math.sin(a)) for a in angles]
    inner = [(mil(.4925)*math.cos(a), mil(.4925)*math.sin(a)) for a in reversed(angles)]
    return [(round(x, 12), round(y, 12)) for x, y in outer+inner]


def distance_to_segment(point, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = max(0, min(1, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(point[0]-a[0]-t*dx, point[1]-a[1]-t*dy)


def inside(point, polygon):
    result = False
    for a, b in zip(polygon, polygon[1:]+polygon[:1]):
        if (a[1] > point[1]) != (b[1] > point[1]):
            cross = (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]
            if point[0] < cross:
                result = not result
    return result


def main():
    original = records(V1)
    old_header, old_pad = next((h, d) for _, h, d in original if h['type'] == 'PAD' and d['num'] == '5')
    hole = next(d for _, h, d in original if h['type'] == 'PAD' and d['num'] == '')
    assert (old_pad['centerX'], old_pad['centerY']) == (hole['centerX'], hole['centerY'])
    max_ticket = max(h.get('ticket', 0) for _, h, _ in original)
    max_z = max((d.get('zIndex') or 0) for _, _, d in original)
    existing_ids = {h.get('id') for _, h, _ in original}
    replacements = []
    checks = []
    for index, angle in enumerate((0, 90, 180, 270)):
        polygon = quarter(angle)
        assert not inside((0, 0), polygon)
        min_edge = min(distance_to_segment((0, 0), a, b) for a, b in zip(polygon, polygon[1:]+polygon[:1]))
        clearance = min_edge*MM_PER_MIL-hole['hole']['width']*MM_PER_MIL/2
        assert clearance > .19247
        # Every chosen circle sample belongs to exactly one intended quadrant;
        # shared edges at +/-45 degrees are geometrically adjacent, not gaps.
        assert inside((mil(.6775)*math.cos(math.radians(angle)),
                       mil(.6775)*math.sin(math.radians(angle))), polygon)
        h, d = copy.deepcopy(old_header), copy.deepcopy(old_pad)
        if index:
            h['id'] = 'e'+hashlib.sha256(('quipus-native-mic-annulus-quarter-'+str(index)).encode()).hexdigest()[:16]
            assert h['id'] not in existing_ids
            h['ticket'] = max_ticket+index
            d['zIndex'] = max_z+index
        flat = [polygon[0][0], polygon[0][1], 'L']
        for x, y in polygon[1:]+polygon[:1]:
            flat.extend((x, y))
        d['defaultPad'] = {'padType': 'POLYGON', 'path': flat}
        replacements.append((h, d))
        checks.append({'id': h['id'], 'num': d['num'], 'angle_deg': angle,
                       'center_mm': [d['centerX']*MM_PER_MIL, d['centerY']*MM_PER_MIL],
                       'points': len(polygon), 'center_is_copper': False,
                       'minimum_actual_copper_to_npth_mm': clearance})
    output = []
    for raw, h, d in original:
        if h == old_header:
            for nh, nd in replacements:
                output.append(json.dumps(nh, separators=(',', ':'))+'||'+json.dumps(nd, separators=(',', ':'))+'|\r\n')
        else:
            output.append(raw)
    AFTER.write_bytes(''.join(output).encode('utf-8'))
    result = records(AFTER)
    assert len(result) == len(original)+3
    assert len([1 for _, h, d in result if h['type'] == 'PAD' and d['num'] == '5']) == 4
    after_hole = next(d for _, h, d in result if h['type'] == 'PAD' and d['num'] == '')
    assert after_hole == hole
    for num in ('1', '2', '3', '4'):
        before = next((h, d) for _, h, d in original if h['type'] == 'PAD' and d['num'] == num)
        after = next((h, d) for _, h, d in result if h['type'] == 'PAD' and d['num'] == num)
        assert before == after
    audit = json.loads(V1_AUDIT.read_text(encoding='utf-8'))
    audit['status'] = 'V2_FLAT_QUARTER_CANDIDATE_NATIVE_IMPORT_DRC_AND_GERBERS_PENDING'
    audit['v1_sha256'] = hash_file(V1)
    audit['after_sha256'] = hash_file(AFTER)
    audit['record_count'] = len(result)
    audit['v1_baseline_changes'] = audit.pop('changes')
    audit['checks']['no_added_or_removed_records'] = False
    audit['checks']['existing_record_identity_preserved'] = True
    audit['checks']['added_ground_quarter_pad_records'] = 3
    audit['pad5']['native_ids'] = [h['id'] for h, _ in replacements]
    audit['pad5']['encoding'] = 'Four concave quarter polygon pads sharing num5 and a concentric native origin.'
    audit['pad5'].pop('outer_winding', None)
    audit['pad5'].pop('inner_winding', None)
    audit['checks']['copper_to_npth_actual_clearance_mm'] = min(c['minimum_actual_copper_to_npth_mm'] for c in checks)
    audit['v2_changes'] = {
        'reason': 'Current native editor did not render nested CIRCLE contours in PAD.defaultPad.path.',
        'encoding': 'Four ordinary flat concave L-path POLYGON pads, all electrical num5.',
        'existing_pin5_id_preserved': old_header['id'], 'new_pad_ids': [h['id'] for h, _ in replacements[1:]],
        'added_pad_record_count': 3, 'quarter_checks': checks,
        'nominal_outer_radius_mm': .8625, 'nominal_inner_radius_mm': .4925,
        'degrees_per_chord': 1,
        'maximum_outer_arc_chord_error_mm': .8625*(1-math.cos(math.radians(.5))),
        'maximum_inner_arc_chord_error_mm': .4925*(1-math.cos(math.radians(.5))),
        'centre_clear_of_copper': True, 'no_hidden_filled_anchor': True,
        'same_pad_number_and_blank_library_net_for_all_quarters': True,
        'shared_quarter_edges': 'Adjacent polygons share identical radial edge vertices at ±45/±135 degrees.',
        'all_prior_mask_paste_and_signal_corrections_retained': True,
        'native_path_coordinate_assumption': 'Relative to pad/hole origin, following official persisted format; native render must confirm.',
    }
    audit['notes'].append('Four native pads with num5 deliberately represent one connected electrical ground land; PCB refresh must bind all four to GND.')
    audit['notes'].append('The shared pad origin is inside the acoustic clearance; route onto actual quarter copper, not the origin in the hole. After native coordinate proof, quarter origins may be rebased onto their copper walls without changing physical land geometry.')
    AUDIT.write_text(json.dumps(audit, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'file': str(AFTER), 'sha256': hash_file(AFTER), 'quarter_checks': checks}))


if __name__ == '__main__':
    main()
