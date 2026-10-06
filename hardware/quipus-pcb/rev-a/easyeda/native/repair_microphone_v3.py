"""Native-proven absolute paths; copper-contained quarter routing anchors.

Actual Pro 3.2.149 rendering showed v2 flat polygon contours at footprint(0,0)
despite nonzero PAD origins. Therefore current native defaultPad.path is stored
in absolute FOOTPRINT coordinates, superseding the legacy relative format.
This correction shifts geometry to the acoustic centre and independently puts
all four num5 anchors on their actual copper wall. No application/PCB edits.
"""
from __future__ import annotations
import copy
import json
import math
from repair_microphone import records, mil, hash_file, MM_PER_MIL
from repair_microphone_v2 import AFTER as V2, AUDIT as V2_AUDIT, inside, distance_to_segment

AFTER = V2.with_name('microphone-footprint-repaired-v3.esource')
AUDIT = V2.with_name('microphone-footprint-repaired-v3.audit.json')


def main():
    source = records(V2)
    hole = next(d for _, h, d in source if h['type'] == 'PAD' and d['num'] == '')
    center = (hole['centerX'], hole['centerY'])
    checks, output, pad_index = [], [], 0
    for raw, h, old in source:
        if h['type'] != 'PAD' or old['num'] != '5':
            output.append(raw)
            continue
        d = copy.deepcopy(old)
        path = d['defaultPad']['path']
        assert path[2] == 'L' and all(isinstance(v, (float, int)) for v in path[:2]+path[3:])
        flat = path[:2]+path[3:]
        assert len(flat) % 2 == 0
        polygon = [(round(flat[i]+center[0], 12), round(flat[i+1]+center[1], 12)) for i in range(0, len(flat), 2)]
        assert polygon[0] == polygon[-1]
        polygon.pop()
        assert not inside(center, polygon)
        angle = math.radians(pad_index*90)
        anchor = (round(center[0]+mil(.6775)*math.cos(angle), 12),
                  round(center[1]+mil(.6775)*math.sin(angle), 12))
        assert inside(anchor, polygon)
        min_dist = min(distance_to_segment(center, a, b) for a, b in zip(polygon, polygon[1:]+polygon[:1]))
        gap = min_dist*MM_PER_MIL-hole['hole']['width']*MM_PER_MIL/2
        anchor_edge = min(distance_to_segment(anchor, a, b) for a, b in zip(polygon, polygon[1:]+polygon[:1]))*MM_PER_MIL
        assert gap > .19247 and anchor_edge > .1849
        d['centerX'], d['centerY'] = anchor
        new_path = [polygon[0][0], polygon[0][1], 'L']
        for x, y in polygon[1:]+polygon[:1]:
            new_path.extend((x, y))
        d['defaultPad'] = {'padType': 'POLYGON', 'path': new_path}
        output.append(json.dumps(h, separators=(',', ':'))+'||'+json.dumps(d, separators=(',', ':'))+'|\r\n')
        checks.append({'id': h['id'], 'num': d['num'], 'quarter_angle_deg': pad_index*90,
                       'anchor_mm': [p*MM_PER_MIL for p in anchor], 'anchor_inside_copper': True,
                       'minimum_anchor_to_copper_boundary_mm': anchor_edge,
                       'acoustic_center_mm': [p*MM_PER_MIL for p in center],
                       'minimum_copper_to_npth_mm': gap, 'center_is_copper': False,
                       'path_coordinate_mode': 'absolute footprint coordinates'})
        pad_index += 1
    assert pad_index == 4
    AFTER.write_bytes(''.join(output).encode('utf-8'))
    result = records(AFTER)
    assert len(result) == len(source)
    changes = 0
    for (_, bh, bd), (_, ah, ad) in zip(source, result):
        assert bh == ah
        for key in ('num', 'netName', 'layerId', 'groupId', 'locked', 'zIndex', 'topPasteExpansion', 'bottomPasteExpansion'):
            assert bd.get(key) == ad.get(key)
        if bd != ad:
            assert bh['type'] == 'PAD' and bd['num'] == '5'
            changed_keys = {k for k in bd if bd[k] != ad[k]}
            assert 'defaultPad' in changed_keys and changed_keys <= {'centerX', 'centerY', 'defaultPad'}
            changes += 1
    assert changes == 4
    audit = json.loads(V2_AUDIT.read_text(encoding='utf-8'))
    audit['status'] = 'V3_ABSOLUTE_QUARTER_PATH_CANDIDATE_NATIVE_RENDER_DRC_AND_GERBERS_PENDING'
    audit['v2_sha256'] = hash_file(V2)
    audit['after_sha256'] = hash_file(AFTER)
    audit['v3_changes'] = {
        'native_evidence': 'Parent observed v2 copper ring at footprint(0,0) while NPTH/mask were at(0,−27.9528mil); native PAD.defaultPad.path ignores pad-origin translation.',
        'path_coordinate_mode': 'absolute footprint coordinates',
        'path_translation_mil': list(center),
        'all_four_origins_moved_onto_their_own_copper_wall': True,
        'anchor_radius_mm': .6775,
        'quarter_checks': checks,
        'four_changed_records_only_vs_v2': True,
        'all_ids_tickets_num5_nets_layers_preserved_vs_v2': True,
        'signal_npth_mask_paste_records_identical_to_v2': True,
    }
    audit['pad5']['new_origin_mm'] = [c['anchor_mm'] for c in checks]
    audit['pad5']['origin_change_reason'] = 'Current native polygon paths are absolute; each independent routing anchor is placed inside its own ground quarter copper.'
    audit['pad5']['encoding'] = 'Four absolute flat concave polygon paths, one shared acoustic centre, four copper-contained origins, shared electrical num5.'
    audit['checks']['copper_to_npth_actual_clearance_mm'] = min(c['minimum_copper_to_npth_mm'] for c in checks)
    audit['notes'] = [note for note in audit['notes'] if 'origin is inside' not in note]
    audit['v2_changes']['native_path_coordinate_assumption'] = 'REJECTED: actual3.2.149 native rendering proved flat PAD.path uses absolute footprint coordinates; see v3_changes.'
    audit['notes'].append('V1 was rejected because nested CIRCLE paths did not render; v2 was rejected because its relative path coordinates rendered at(0,0). V3 uses the native-observed absolute encoding with copper-contained origins.')
    AUDIT.write_text(json.dumps(audit, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'file': str(AFTER), 'sha256': hash_file(AFTER), 'checks': checks}))


if __name__ == '__main__':
    main()
