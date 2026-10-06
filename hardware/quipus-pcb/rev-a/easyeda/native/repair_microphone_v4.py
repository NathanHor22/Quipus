"""Native parse isolation candidate: implicit XY only in PAD/FILL paths."""
from __future__ import annotations
import copy
import json
from repair_microphone import records, hash_file
from repair_microphone_v3 import AFTER as V3, AUDIT as V3_AUDIT
from render_microphone_repair import points

AFTER = V3.with_name('microphone-footprint-repaired-v4.esource')
AUDIT = V3.with_name('microphone-footprint-repaired-v4.audit.json')


def main():
    original = records(V3)
    changes, output = [], []
    for raw, h, old in original:
        d = copy.deepcopy(old)
        if h['type'] == 'PAD' and d['defaultPad']['padType'] == 'POLYGON':
            d['defaultPad']['path'] = [v for v in d['defaultPad']['path'] if v != 'L']
            assert all(isinstance(v, (float, int)) for v in d['defaultPad']['path'])
            assert len(d['defaultPad']['path']) % 2 == 0
        elif h['type'] == 'FILL':
            contours = []
            for path in d['path']:
                polygon = points(path)
                if polygon[0] != polygon[-1]:
                    polygon.append(polygon[0])
                contours.append([round(v, 12) for xy in polygon for v in xy])
            d['path'] = contours
            assert all(all(isinstance(v, (float, int)) for v in path) and len(path) % 2 == 0 for path in contours)
        if d != old:
            changes.append({'type': h['type'], 'id': h['id'], 'num': d.get('num'),
                            'old_path': old.get('path', old.get('defaultPad', {}).get('path')),
                            'new_path_value_count': sum(map(len, d['path'])) if h['type'] == 'FILL' else len(d['defaultPad']['path'])})
            output.append(json.dumps(h, separators=(',', ':'))+'||'+json.dumps(d, separators=(',', ':'))+'|\r\n')
        else:
            output.append(raw)
    assert len(changes) == 11  #4 PADs +7 pasteFILLs
    AFTER.write_bytes(''.join(output).encode('utf-8'))
    result = records(AFTER)
    assert len(result) == len(original)
    for (_, bh, bd), (_, ah, ad) in zip(original, result):
        assert bh == ah
        for field in ('centerX', 'centerY', 'num', 'netName', 'layerId', 'groupId', 'width', 'topPasteExpansion', 'bottomPasteExpansion'):
            assert bd.get(field) == ad.get(field)
        if bh['type'] not in ('PAD', 'FILL'):
            assert bd == ad
    audit = json.loads(V3_AUDIT.read_text(encoding='utf-8'))
    audit['status'] = 'V4_IMPLICIT_XY_PARSE_ISOLATION_NATIVE_APPLY_DRC_PENDING'
    audit['v3_sha256'] = hash_file(V3)
    audit['after_sha256'] = hash_file(AFTER)
    audit['v4_changes'] = {
        'reason': 'Parent reported native Apply Invalidformat after v3; isolate all PAD/FILL L/ARC parsing using implicit numeric XY paths.',
        'record_changes': changes, 'all_pad_and_fill_paths_numeric_xy_only': True,
        'copper_geometry_and_anchors_identical_to_v3': True,
        'mask_and_npht_identical_to_v3': True,
        'ground_paste_arcs_sampled_deg': .5,
        'maximum_paste_outer_chord_error_mm': .83*(1-__import__('math').cos(__import__('math').radians(.25))),
        'signal_paste_geometry_preserved': True,
        'caveat': 'Captured original signal FILL uses L, so L is not universally invalid. If this still fails, test unchanged original Apply and isolate width0 next.',
    }
    AUDIT.write_text(json.dumps(audit, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'file': str(AFTER), 'sha256': hash_file(AFTER), 'changed_records': len(changes)}))


if __name__ == '__main__':
    main()
