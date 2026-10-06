"""Normalize captured EasyEDA Pro SCH_PAGE File Source without changing circuits.

Records use the documented ``JSON-header||JSON-body|`` line format. Current
v3 captures use x/y and LINE.lineGroup rather than older positionX/positionY
and WIRE.dots; both coordinate forms are supported. Component attributes bind
through parentId, and each wire must have its own ATTR NET.

Only whole physically connected islands are translated. No scaling, mirroring,
rotation, component identity, library links, pin numbering or net names change.
Frame attributes are preserved except the explicitly requested A3 page size.

Pin validation reconstructs imported symbol geometry from the source KiCad
embedded symbols (1 native unit = .254 mm; importer reverses local symbol Y).
It is an independent source-to-page check, not a native ERC/DRC certification.
Native library PIN records or a native exported netlist are still needed to
independently certify the editor's resolved library geometry and connectivity.

Official references:
https://prodocs.easyeda.com/en/format/schematic/component/
https://prodocs.easyeda.com/en/format/schematic/attr/
https://prodocs.easyeda.com/en/format/schematic/wire/
https://prodocs.easyeda.com/en/schematic/file-file-source/
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import copy
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kicad_format import child, children, parse

ROOT = Path(__file__).resolve().parents[5]
CANONICAL = ROOT / 'output/pcb/Quipus-A1/connections.json'
SYMBOLS = ROOT / 'output/pcb/Quipus-A1-EasyEDA/Quipus-A1.kicad_sch'
MM_PER_UNIT = .254
TOLERANCE = .001
COORD_PAIRS = [('x', 'y'), ('positionX', 'positionY'),
               ('startX', 'startY'), ('endX', 'endY'),
               ('centerX', 'centerY'), ('pointX', 'pointY')]
PAGE_TITLES = {
    '01': '01 - USB-C input, battery charging and power path',
    '02': '02 - USB power detection and charge control',
    '03': '03 - Power button and system load switch',
    '04': '04 - 3.3 V buck-boost regulator',
    '05': '05 - Battery fuel gauge and current sensing',
    '06': '06 - ESP32-S3, clock, display, microSD and USB',
    '07': '07 - Controller support and display passives',
    '08': '08 - Buttons and USB termination',
    '09': '09 - Digital microphones and speaker amplifier',
    'P1': '08 - Buttons and USB termination',
}


@dataclass
class Record:
    header: dict
    body: dict
    raw: str
    changed: bool = False

    @property
    def id(self):
        return self.header.get('id')

    @property
    def type(self):
        return self.header['type']

    def serialize(self):
        if not self.changed:
            return self.raw
        return (json.dumps(self.header, ensure_ascii=False, separators=(',', ':'))
                + '||' + json.dumps(self.body, ensure_ascii=False,
                                   separators=(',', ':')) + '|')


def read_records(path):
    result = []
    for index, line in enumerate(Path(path).read_text(encoding='utf-8-sig').splitlines(), 1):
        if not line.strip():
            continue
        try:
            head, body = line.rstrip().removesuffix('|').split('||', 1)
            result.append(Record(json.loads(head), json.loads(body), line))
        except (ValueError, json.JSONDecodeError) as exc:
            raise ValueError(f'{path}:{index}: invalid native source: {exc}') from exc
    if sum(r.type == 'DOCHEAD' for r in result) != 1:
        raise ValueError('Normalizer accepts exactly one SCH_PAGE document')
    if next(r.body for r in result if r.type == 'DOCHEAD')['docType'] != 'SCH_PAGE':
        raise ValueError('Expected SCH_PAGE, not a library or PCB document')
    return result


def index_records(records):
    ids, attrs = {}, defaultdict(dict)
    for r in records:
        if r.id is not None:
            if r.id in ids:
                raise ValueError(f'Duplicate native primitive ID {r.id}')
            ids[r.id] = r
        if r.type == 'ATTR':
            owner, key = r.body['parentId'], r.body['key']
            if key in attrs[owner]:
                raise ValueError(f'Duplicate {key} attribute on {owner}')
            attrs[owner][key] = r
    return ids, attrs


def value(attrs, owner, key, default=None):
    record = attrs.get(owner, {}).get(key)
    return default if record is None else record.body['value']


def xy(body):
    for x, y in COORD_PAIRS[:2]:
        if isinstance(body.get(x), (int, float)) and isinstance(body.get(y), (int, float)):
            return float(body[x]), float(body[y])
    raise ValueError(f'No numeric position: {body}')


def coordinate_points(body):
    result = []
    for x, y in COORD_PAIRS:
        if isinstance(body.get(x), (int, float)) and isinstance(body.get(y), (int, float)):
            result.append((float(body[x]), float(body[y])))
    for chain in body.get('dots', []):
        if len(chain) % 2:
            raise ValueError('Odd-length native coordinate chain')
        result.extend(zip(chain[::2], chain[1::2]))
    return result


def translate(record, dx, dy):
    changed = False
    for x, y in COORD_PAIRS:
        if isinstance(record.body.get(x), (int, float)) and isinstance(record.body.get(y), (int, float)):
            record.body[x] += dx
            record.body[y] += dy
            changed = True
    for chain in record.body.get('dots', []):
        for n in range(0, len(chain), 2):
            chain[n] += dx
            chain[n + 1] += dy
            changed = True
    record.changed |= changed


def wire_segments(record, records):
    segments = []
    for chain in record.body.get('dots', []):
        points = list(zip(chain[::2], chain[1::2]))
        segments.extend(zip(points, points[1:]))
    for line in records:
        if line.type == 'LINE' and line.body.get('lineGroup') == record.id:
            b = line.body
            segments.append(((b['startX'], b['startY']), (b['endX'], b['endY'])))
    if not segments:
        raise ValueError(f'Wire {record.id} has no actual line geometry')
    return segments


def touches(point, segment):
    (px, py), ((ax, ay), (bx, by)) = point, segment
    vx, vy = bx - ax, by - ay
    if vx == vy == 0:
        return math.hypot(px - ax, py - ay) <= TOLERANCE
    t = ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)
    return (-TOLERANCE <= t <= 1 + TOLERANCE
            and math.hypot(px - (ax + t * vx), py - (ay + t * vy)) <= TOLERANCE)


def source_symbols(path=SYMBOLS):
    sch = parse(Path(path).read_text(encoding='utf-8-sig'))
    libraries = children(child(sch, 'lib_symbols'), 'symbol')
    result = {}
    for library in libraries:
        ref = str(library[1]).split(':', 1)[-1]
        pins, outline = {}, []
        for unit in children(library, 'symbol'):
            for pin in children(unit, 'pin'):
                at, number = child(pin, 'at'), child(pin, 'number')
                pins[str(number[1])] = (float(at[1]) / MM_PER_UNIT,
                                       -float(at[2]) / MM_PER_UNIT)
            for rectangle in children(unit, 'rectangle'):
                for key in ('start', 'end'):
                    p = child(rectangle, key)
                    outline.append((float(p[1]) / MM_PER_UNIT,
                                    -float(p[2]) / MM_PER_UNIT))
        result[ref] = {'pins': pins, 'outline': outline}
    return result


def transformed(component, point):
    # Official EasyEDA transform order: rotate CCW, reflect X if mirrored,
    # then translate. Native page coordinates are the source's own coordinates.
    angle = math.radians(float(component.body.get('rotation', 0)))
    px, py = point
    px, py = px * math.cos(angle) - py * math.sin(angle), px * math.sin(angle) + py * math.cos(angle)
    if component.body.get('isMirror'):
        px = -px
    x, y = xy(component.body)
    return x + px, y + py


def circuit_signature(records):
    """Identity/electrical fields, deliberately independent of page coordinates."""
    signature = []
    _, attrs = index_records(records)
    non_electrical = {r.id for r in records if r.type == 'COMPONENT'
                      and not value(attrs, r.id, 'Designator')}
    for r in records:
        if r.type not in ('COMPONENT', 'WIRE', 'ATTR', 'LINE'):
            continue
        if r.id in non_electrical or r.body.get('parentId') in non_electrical:
            continue
        b = copy.deepcopy(r.body)
        for x, y in COORD_PAIRS:
            b.pop(x, None)
            b.pop(y, None)
        if 'dots' in b:
            b['dots'] = [len(chain) for chain in b['dots']]
        if r.type == 'ATTR' and b.get('key') in ('Page Size', 'Width', 'Height'):
            b.pop('value', None)
        signature.append((r.header, b))
    return hashlib.sha256(json.dumps(signature, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def replace_imported_frame(records, template, page_name):
    """Replace only the fixed huge imported paper with an existing native frame.

    This is explicit layout authorization, not an electrical edit. Library
    UUIDs stay exactly those of the already-present native frame. Fresh local
    primitive UUIDs avoid cross-page frame identity collisions.
    """
    _, attrs = index_records(records)
    if any(r.type == 'COMPONENT' and value(attrs, r.id, 'Width') is not None for r in records):
        return False
    old = [r for r in records if r.type == 'COMPONENT'
           and not value(attrs, r.id, 'Designator')
           and str(value(attrs, r.id, 'Name', '')).startswith('default1260x891')]
    if len(old) != 1:
        raise ValueError('Unrecognized non-native frame; refusing to replace any electronic item')
    template_records = read_records(template)
    _, template_attrs = index_records(template_records)
    frames = [r for r in template_records if r.type == 'COMPONENT'
              and value(template_attrs, r.id, 'Width') is not None]
    if len(frames) != 1:
        raise ValueError('Frame template must have exactly one native drawing frame')
    frame = frames[0]
    clones = copy.deepcopy([r for r in template_records if r.id == frame.id
                            or r.body.get('parentId') == frame.id])
    original_signature = circuit_signature(records)
    old_ids = {old[0].id, *(r.id for r in attrs[old[0].id].values())}
    records[:] = [r for r in records if r.id not in old_ids]
    new_ids = {r.id: uuid.uuid4().hex[:16] for r in clones}
    ticket = max(r.header.get('ticket', 0) for r in records) + 1
    for r in clones:
        r.header['id'] = new_ids[r.id]
        r.header['ticket'] = ticket
        ticket += 1
        if r.body.get('parentId') in new_ids:
            r.body['parentId'] = new_ids[r.body['parentId']]
        if r.type == 'ATTR' and r.body.get('key') == '@Page Name':
            r.body['value'] = page_name
        if r.type == 'ATTR' and r.body.get('key') == '@Page No':
            r.body['value'] = '1'
        if r.type == 'ATTR' and r.body.get('key') == '@Page Count':
            r.body['value'] = '9'
        r.changed = True
    records.extend(clones)
    if original_signature != circuit_signature(records):
        raise ValueError('Electrical signature changed while replacing the paper frame')
    return True


def analyze(records, canonical, symbols, require_full=False):
    ids, attrs = index_records(records)
    expected = {c['ref']: c for c in canonical['components']}
    aliases = canonical.get('net_aliases', {})
    known_nets = {p['net'] for c in expected.values() for p in c['pins'] if p.get('net')}
    frames = [r for r in records if r.type == 'COMPONENT' and value(attrs, r.id, 'Width') is not None]
    if len(frames) != 1:
        raise ValueError('Expected exactly one native drawing frame')
    components = [r for r in records if r.type == 'COMPONENT' and value(attrs, r.id, 'Designator')]
    wires = [r for r in records if r.type == 'WIRE']
    errors, refs, uniques = [], {}, {}
    for component in components:
        ref = value(attrs, component.id, 'Designator')
        if ref in refs:
            errors.append(f'Duplicate component reference {ref}')
        refs[ref] = component
        if ref not in expected:
            errors.append(f'Unknown component reference {ref}')
            continue
        for key in ('Unique ID', 'Symbol', 'Device', 'Footprint'):
            if not value(attrs, component.id, key):
                errors.append(f'{ref}: missing {key}')
        uid = value(attrs, component.id, 'Unique ID')
        if uid in uniques:
            errors.append(f'Duplicate component Unique ID: {ref}/{uniques[uid]}')
        uniques[uid] = ref
        if str(component.body.get('partId', '')) not in ('', '1'):
            errors.append(f'{ref}: multi-part symbols require a native library audit')
    if require_full and set(refs) != set(expected):
        errors.append(f'Whole-project reference mismatch: missing={sorted(set(expected)-set(refs))}; extra={sorted(set(refs)-set(expected))}')
    segments, wire_nets = {}, {}
    for wire in wires:
        name = value(attrs, wire.id, 'NET')
        if not name:
            errors.append(f'Wire {wire.id}: missing NET')
        name = aliases.get(name, name)
        if name not in known_nets:
            errors.append(f'Wire {wire.id}: unknown net {name}')
        wire_nets[wire.id] = name
        segments[wire.id] = wire_segments(wire, records)
    for r in records:
        if r.type == 'ATTR' and r.body.get('parentId') not in ids:
            owner = r.body.get('parentId', '')
            if not any(owner.startswith(c.id) for c in components):
                errors.append(f'Orphan attribute {r.id}: parent {owner}')
        if r.type == 'LINE' and r.body.get('lineGroup') not in ids:
            errors.append(f'Orphan line {r.id}')
    pin_rows, wire_owners = [], defaultdict(set)
    for ref, component in refs.items():
        if ref not in expected or ref not in symbols:
            errors.append(f'{ref}: source pin geometry unavailable')
            continue
        source_pins = symbols[ref]['pins']
        expected_pins = {str(p['number']): p for p in expected[ref]['pins']}
        if set(source_pins) != set(expected_pins):
            errors.append(f'{ref}: source symbol/canonical pin-number mismatch')
        for number, pin in expected_pins.items():
            if number not in source_pins:
                continue
            point = transformed(component, source_pins[number])
            matches = [w for w, lines in segments.items() if any(touches(point, s) for s in lines)]
            names = {wire_nets[w] for w in matches}
            no_connect = [r.id for r in records if r.type == 'ATTR'
                          and r.body.get('key') == 'NO_CONNECT'
                          and str(r.body.get('value')).lower() in ('yes', 'true', '1')
                          and r.body.get('parentId', '').startswith(component.id + '-')
                          and any(math.hypot(point[0] - p[0], point[1] - p[1]) <= TOLERANCE
                                  for p in coordinate_points(r.body))]
            correct = (names == {pin['net']} if pin.get('net') else not names)
            if pin.get('net') and no_connect:
                correct = False
            if not pin.get('net') and not no_connect:
                correct = False
            if not correct:
                errors.append(f'{ref}.{number}: expected {pin.get("net")}, found {sorted(names)}, NC={no_connect} at {point}')
            for w in matches:
                wire_owners[w].add(component.id)
            pin_rows.append({'ref': ref, 'number': number, 'x': point[0], 'y': point[1],
                             'expected_net': pin.get('net'), 'actual_page_wire_nets': sorted(names),
                             'wire_ids': matches, 'no_connect_attr_ids': no_connect,
                             'match': correct})
    for wire in wires:
        if not wire_owners[wire.id]:
            errors.append(f'Wire {wire.id}: no source component pin touches its geometry')
    return {'errors': errors, 'components': components, 'wires': wires, 'frames': frames,
            'attrs': attrs, 'refs': refs, 'wire_owners': wire_owners,
            'segments': segments, 'pin_rows': pin_rows,
            'wire_nets': wire_nets, 'unique_ids': uniques}


def text_bounds(record):
    b = record.body
    if record.type == 'ATTR' and not (b.get('valueVisible') or b.get('keyVisible')):
        return []
    points = coordinate_points(b)
    if not points:
        return []
    x, y = points[0]
    size = float(b.get('fontSize') or 5)
    text = str(b.get('value', ''))
    if b.get('keyVisible'):
        text = str(b.get('key', '')) + ' ' + text
    # Conservative bounds, not a font renderer: .72-em width plus 2-unit margin.
    width = max(1, len(text)) * size * .72 + 4
    align = b.get('align', 'LEFT_MIDDLE')
    low_x = x - width if align.startswith('RIGHT') else x - width / 2 if align.startswith('CENTER') else x
    return [(low_x - 2, y - size - 2), (low_x + width + 2, y + size + 2)]


def bounds(records, components, attrs, symbols):
    points = []
    for r in records:
        if r.type in ('TEXT', 'ATTR'):
            points.extend(text_bounds(r))
        else:
            points.extend(coordinate_points(r.body))
    for component in components:
        ref = value(attrs, component.id, 'Designator')
        points.extend(transformed(component, p) for p in symbols[ref]['outline'])
    if not points:
        raise ValueError('No electronic geometry to place')
    return [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points)]


def normalize(records, canonical, symbols, title=None, sheet='A3', gap=20):
    before = analyze(records, canonical, symbols)
    if before['errors']:
        raise ValueError('Refusing to move an invalid native page:\n' + '\n'.join(before['errors']))
    signature = circuit_signature(records)
    frame, attrs = before['frames'][0], before['attrs']
    protected = {frame.id, *(r.id for r in attrs[frame.id].values())}
    immutable = {r.id: r.serialize() for r in records if r.id in protected}
    if sheet == 'A3':
        for key, v in [('Page Size', 'A3'), ('Width', '1654'), ('Height', '1170')]:
            record = attrs[frame.id][key]
            record.body['value'] = v
            record.changed = True
    width, height = float(value(attrs, frame.id, 'Width')), float(value(attrs, frame.id, 'Height'))
    fx, fy = xy(frame.body)
    # The native frame extends upward from bottom-left (0,0). Reserve its
    # entire bottom 210 units for title/revision information and connectors.
    usable = [fx + 55, fy - height + 110, fx + width - 55, fy - 210]
    parent = {c.id: c.id for c in before['components']}

    def find(key):
        if parent[key] != key:
            parent[key] = find(parent[key])
        return parent[key]

    def merge(a, b):
        parent[find(b)] = find(a)

    for owners in before['wire_owners'].values():
        owners = sorted(owners)
        for owner in owners[1:]:
            merge(owners[0], owner)
    # Wires sharing actual contact geometry must be moved together, even if
    # each touches a different component; named but disjoint nets stay apart.
    wires = before['wires']
    for i, a in enumerate(wires):
        for b in wires[i + 1:]:
            sa, sb = before['segments'][a.id], before['segments'][b.id]
            if any(touches(p, other) for segment in sa for p in segment for other in sb):
                if before['wire_nets'][a.id] != before['wire_nets'][b.id]:
                    raise ValueError(f'Conflicting touching nets {a.id}/{b.id}')
                merge(next(iter(before['wire_owners'][a.id])), next(iter(before['wire_owners'][b.id])))
    roots = defaultdict(list)
    for component in before['components']:
        roots[find(component.id)].append(component)
    islands = []
    assigned = set(protected)
    for root, components in roots.items():
        owners = {c.id for c in components}
        wire_ids = {w.id for w in wires if any(find(c) == root for c in before['wire_owners'][w.id])}
        own = owners | wire_ids
        selected = [r for r in records if r.id in own or
                    (r.type == 'ATTR' and (r.body.get('parentId') in own or
                     any(r.body.get('parentId', '').startswith(owner + '-') for owner in owners))) or
                    (r.type == 'LINE' and r.body.get('lineGroup') in wire_ids)]
        assigned.update(r.id for r in selected)
        islands.append({'components': components, 'records': selected,
                        'bounds': bounds(selected, components, attrs, symbols)})
    islands.sort(key=lambda island: (round(min(xy(c.body)[0] for c in island['components']), 3),
                                     min(xy(c.body)[1] for c in island['components'])))
    # Greedy column layout preserves every island's original internal geometry.
    # Try fewer columns first; no shrinking of printed text is allowed.
    layout = None
    for columns in range(1, 7):
        col_width = (usable[2] - usable[0] - (columns - 1) * gap) / columns
        positions, column, cursor = [], 0, usable[1]
        for island in islands:
            x0, y0, x1, y1 = island['bounds']
            box_w, box_h = x1 - x0, y1 - y0
            if box_w > col_width:
                break
            if cursor + box_h > usable[3]:
                column += 1
                cursor = usable[1]
            if column >= columns:
                break
            positions.append((usable[0] + column * (col_width + gap) - x0, cursor - y0))
            cursor += box_h + gap
        if len(positions) == len(islands):
            layout = (columns, positions)
            break
    if layout is None:
        raise ValueError('Page will not fit without scaling; use a larger drawing frame or split this panel')
    translations = []
    for island, (dx, dy) in zip(islands, layout[1]):
        for record in island['records']:
            translate(record, dx, dy)
        translations.append({'refs': [value(attrs, c.id, 'Designator') for c in island['components']],
                             'dx': dx, 'dy': dy})
    notes = [r for r in records if r.type == 'TEXT' and r.id not in assigned]
    for note in notes:
        # Captured cut blocks can include notes for their old neighboring
        # panels. Replace them with one truthful native page heading.
        assigned.add(note.id)
    unknown = [r for r in records if r.id not in assigned and r.type not in ('DOCHEAD', 'CANVAS')]
    if unknown:
        raise ValueError('Refusing partial translation of unowned records: ' + ', '.join(f'{r.type}:{r.id}' for r in unknown))
    records[:] = [r for r in records if r not in notes]
    if title:
        ticket = max(r.header.get('ticket', 0) for r in records) + 1
        records.append(Record({'type': 'TEXT', 'ticket': ticket, 'id': uuid.uuid4().hex[:16]},
                              {'x': fx + 55, 'y': fy - height + 50, 'rotation': 0,
                               'fontSize': 16, 'align': 'LEFT_MIDDLE', 'value': title,
                               'fontWeight': True, 'color': None, 'zIndex': ticket,
                               'locked': False}, '', True))
    if signature != circuit_signature(records):
        raise ValueError('Electrical/identity signature changed during normalization')
    after = analyze(records, canonical, symbols)
    if after['errors']:
        raise ValueError('Post-layout pin/net verification failed:\n' + '\n'.join(after['errors']))
    allowed_frame = {attrs[frame.id][k].id for k in ('Page Size', 'Width', 'Height')} if sheet == 'A3' else set()
    for r in records:
        if r.id in immutable and r.id not in allowed_frame and r.serialize() != immutable[r.id]:
            raise ValueError(f'Unexpected drawing/title modification: {r.id}')
    return {'status': 'pass', 'native_component_refs': sorted(after['refs']),
            'components': len(after['components']), 'wire_count': len(after['wires']),
            'pin_count': len(after['pin_rows']), 'net_count': len(set(after['wire_nets'].values())),
            'columns': layout[0], 'sheet': sheet, 'usable_bounds': usable,
            'translations': translations, 'all_pin_nets_match_source': True,
            'source_electrical_signature_sha256': signature,
            'component_unique_ids': {ref: uid for uid, ref in after['unique_ids'].items()},
            'pins': after['pin_rows'], 'errors': [],
            'limitations': ['Pin locations are reconstructed from imported KiCad symbol geometry; native library PIN records were not captured.',
                            'Native project export must independently verify all 144 refs, 92 nets and 471 pins after all pages are moved.',
                            'Unrouted engineering draft; no native ERC, DRC or fabrication approval.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', nargs='+', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--sheet', choices=['A3', 'keep'], default='A3')
    parser.add_argument('--title')
    parser.add_argument('--frame-template', type=Path, default=Path(__file__).parent / 'P1-before.esource')
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--full-project', action='store_true')
    args = parser.parse_args()
    canonical = json.loads(CANONICAL.read_text(encoding='utf-8-sig'))
    symbols = source_symbols()
    if args.full_project:
        # Combine ordinary page records; DOCHEAD/CANVAS/frame identities are
        # page-local, so cross-page validation must retain page namespaces.
        all_refs, all_uids, pin_rows, errors, pages = {}, {}, [], [], []
        for path in args.inputs:
            analysis = analyze(read_records(path), canonical, symbols)
            pages.append({'path': str(path), 'components': len(analysis['components']),
                          'wires': len(analysis['wires']), 'pins': len(analysis['pin_rows'])})
            errors.extend(f'{path.name}: {e}' for e in analysis['errors'])
            for ref, component in analysis['refs'].items():
                if ref in all_refs:
                    errors.append(f'Ref {ref} is present on both {all_refs[ref]} and {path.name}')
                all_refs[ref] = path.name
                uid = value(analysis['attrs'], component.id, 'Unique ID')
                if uid in all_uids:
                    errors.append(f'Unique ID {uid} duplicated between {all_uids[uid]} and {ref}')
                all_uids[uid] = ref
            pin_rows.extend(analysis['pin_rows'])
        expected = {c['ref'] for c in canonical['components']}
        missing = sorted(expected - set(all_refs))
        if missing:
            errors.append(f'Missing components: {missing}')
        report = {'status': 'pass' if not errors else 'fail', 'components': len(all_refs),
                  'nets': len({p['expected_net'] for p in pin_rows if p['expected_net']}),
                  'pin_count': len(pin_rows), 'connected_pins': sum(bool(p['expected_net']) for p in pin_rows),
                  'unconnected_pins': sum(not p['expected_net'] for p in pin_rows),
                  'pages': pages, 'errors': errors,
                  'native_resolved_netlist_verified': False,
                  'pins': pin_rows}
        target = args.output or Path(__file__).parent / 'native-project-validation.json'
        target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print(json.dumps({k: v for k, v in report.items() if k != 'pins'}, indent=2))
        return 0 if not errors else 1
    if args.output and len(args.inputs) != 1:
        parser.error('--output accepts exactly one input')
    for path in args.inputs:
        records = read_records(path)
        if args.validate_only:
            analysis = analyze(records, canonical, symbols)
            report = {'status': 'pass' if not analysis['errors'] else 'fail',
                      'refs': sorted(analysis['refs']), 'pin_count': len(analysis['pin_rows']),
                      'wire_count': len(analysis['wires']), 'errors': analysis['errors']}
            print(json.dumps(report, indent=2))
            if analysis['errors']:
                return 1
            continue
        frame_replaced = replace_imported_frame(records, args.frame_template, path.stem.replace('-before', ''))
        title = args.title or PAGE_TITLES.get(path.name.split('-')[0])
        report = normalize(records, canonical, symbols, title=title, sheet=args.sheet)
        report['imported_non_electrical_frame_replaced'] = frame_replaced
        target = args.output or path.with_name(path.name.replace('-before.esource', '-neat.esource'))
        if target == path:
            raise ValueError('Refusing to overwrite captured source; use --output')
        target.write_text('\n'.join(r.serialize() for r in records) + '\n', encoding='utf-8', newline='\n')
        report['source_file'] = str(path.resolve())
        report['output_file'] = str(target.resolve())
        report['source_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        report['output_sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
        target.with_suffix('.validation.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print(f'{target.name}: PASS {report["components"]} refs, {report["wire_count"]} wires, {report["pin_count"]} pin mappings, {report["columns"]} columns, {report["sheet"]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
