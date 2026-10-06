"""Independent electrical and geometry audit of the EasyEDA import carrier.

Run after build_import.py. This does not import the generator or its geometry
normalizer. It reads the final PCB, flattened schematic, original physical
footprints, manifests and canonical connections.json. It is not native ERC/DRC.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'output/pcb/Quipus-A1-EasyEDA'


def sexp(text):
    tokens = re.findall(r';[^\r\n]*|"(?:\\.|[^"\\])*"|[()]|[^\s();]+', text)
    stack, root = [], None
    for token in tokens:
        if token.startswith(';'):
            continue
        if token == '(':
            node = []
            if stack:
                stack[-1].append(node)
            elif root is not None:
                raise ValueError('Multiple S-expression roots')
            stack.append(node)
        elif token == ')':
            if not stack:
                raise ValueError('Unmatched closing parenthesis')
            node = stack.pop()
            if not stack:
                root = node
        else:
            if not stack:
                raise ValueError('Atom outside S-expression')
            stack[-1].append(json.loads(token) if token.startswith('"') else token)
    if stack or root is None:
        raise ValueError('Unclosed or missing S-expression')
    return root


def kids(node, key=None):
    return [x for x in node if isinstance(x, list) and x and (key is None or x[0] == key)]


def one(node, key, default=None):
    return next(iter(kids(node, key)), default)


def values(node, key, default=None):
    result = one(node, key)
    return result[1:] if result is not None else default


def walk(node):
    if isinstance(node, list):
        yield node
        for item in node:
            yield from walk(item)


def same(a, b, tolerance=1e-7):
    if isinstance(a, list) or isinstance(b, list):
        return isinstance(a, list) and isinstance(b, list) and len(a) == len(b) and all(same(x, y, tolerance) for x, y in zip(a, b))
    if a is None or b is None:
        return a is b
    try:
        return abs(float(a) - float(b)) <= tolerance
    except (ValueError, TypeError):
        return a == b


def point(x, y, ox, oy, angle, back=False):
    if back:
        x = -x
    theta = math.radians(angle)
    return [ox + x * math.cos(theta) + y * math.sin(theta),
            oy - x * math.sin(theta) + y * math.cos(theta)]


def flip_layer(name, back):
    return ('B.' if name.startswith('F.') else 'F.') + name[2:] if back and name.startswith(('F.', 'B.')) else name


def pad_signature(pad):
    # Only physical geometry, so symbolic UUID and net metadata cannot mask
    # overwriting of lands that share a basename in different source folders.
    physical = ('at', 'size', 'drill', 'layers', 'roundrect_rratio', 'rect_delta',
                'solder_mask_margin', 'solder_paste_margin', 'solder_paste_margin_ratio',
                'options', 'primitives')
    return [pad[1:4], *[[key, values(pad, key)] for key in physical]]


def primitive_geometry(node):
    omit = {'uuid', 'tstamp', 'net', 'fill'}
    if not isinstance(node, list):
        return node
    if node and node[0] == 'stroke':
        return one(node, 'width', ['width', '0'])
    return [primitive_geometry(v) for v in node if not (isinstance(v, list) and v and isinstance(v[0], str) and v[0] in omit)]


def physical_inventory(tree):
    result = []
    for item in kids(tree):
        if item[0] == 'pad':
            sig = pad_signature(item)
            # Zero rotation may be explicitly written or omitted by KiCad.
            at = next(v[1] for v in sig[1:] if v[0] == 'at')
            if at is not None and len(at) == 2:
                at.append('0')
            result.append(primitive_geometry(sig))
        elif item[0].startswith('fp_') and any(layer.endswith(('.Cu', '.Mask', '.Paste')) for layer in values(item, 'layer', [])):
            result.append(primitive_geometry(item))
    return result


def graphic_expectations(node, back):
    """Describe source graphics independently, including exact outline edges.

    Modern three-point arcs are tested by their geometric invariants below,
    rather than by importing or duplicating the generator's circumcentre code.
    """
    kind = node[0]
    transform = lambda xy: [-float(xy[0]) if back else float(xy[0]), float(xy[1])]
    width = values(node, 'width')
    if width is None:
        width = values(one(node, 'stroke', []), 'width', ['0'])
    common = {'width': width}
    if one(node, 'layer') is not None:
        common['layer'] = [flip_layer(v, back) for v in values(node, 'layer')]
    fill = values(node, 'fill')
    if kind in ('fp_rect', 'gr_rect'):
        a, b = transform(values(node, 'start')), transform(values(node, 'end'))
        vertices = [a, [b[0], a[1]], b, [a[0], b[1]]]
        return [{'kind': kind[:3] + 'line', 'start': vertices[i], 'end': vertices[(i + 1) % 4], **common} for i in range(4)]
    if kind in ('fp_poly', 'gr_poly'):
        vertices = [transform(p[1:]) for p in kids(one(node, 'pts'), 'xy')]
        if fill in (['none'], ['no']):
            return [{'kind': kind[:3] + 'line', 'start': vertices[i], 'end': vertices[(i + 1) % len(vertices)], **common} for i in range(len(vertices))]
        return [{'kind': kind, 'pts': vertices, **common}]
    if kind in ('fp_arc', 'gr_arc') and one(node, 'mid') is not None:
        return [{'kind': kind, 'three_point': [transform(values(node, k)) for k in ('start', 'mid', 'end')], **common}]
    expected = {'kind': kind, **common}
    for key in ('start', 'end', 'center'):
        if one(node, key) is not None:
            expected[key] = transform(values(node, key))
    if one(node, 'angle') is not None:
        expected['angle'] = [-float(values(node, 'angle')[0]) if back else float(values(node, 'angle')[0])]
    if kind == 'gr_circle' and fill in (['yes'], ['solid']):
        expected['width'] = ['0']
    return [expected]


def check_graphics(before, after, back, require, tag, stats):
    expected = [graphic for item in before for graphic in graphic_expectations(item, back)]
    require(len(expected) == len(after), f'{tag}: converted graphic count differs')
    for index, (source, actual) in enumerate(zip(expected, after)):
        context = f'{tag}[{index}]'
        require(source['kind'] == actual[0], f'{context}: graphic type changed')
        for key in ('width', 'layer', 'start', 'end', 'center', 'angle'):
            if key in source:
                require(same(source[key], values(actual, key)), f'{context}: graphic {key} geometry changed')
        if 'pts' in source:
            actual_points = [p[1:] for p in kids(one(actual, 'pts'), 'xy')]
            require(same(source['pts'], actual_points), f'{context}: polygon vertices/reflection changed')
        if 'three_point' in source:
            a, mid, end = source['three_point']
            center = [float(v) for v in values(actual, 'start')]
            beginning = [float(v) for v in values(actual, 'end')]
            sweep = float(values(actual, 'angle')[0])
            require(same(beginning, a), f'{context}: legacy arc starts at wrong point')
            radius = math.dist(a, center)
            require(abs(math.dist(mid, center) - radius) < 1e-7 and abs(math.dist(end, center) - radius) < 1e-7,
                    f'{context}: converted arc is not on source circle')
            radians = math.radians(sweep)
            dx, dy = a[0] - center[0], a[1] - center[1]
            endpoint = [center[0] + dx * math.cos(radians) - dy * math.sin(radians),
                        center[1] + dx * math.sin(radians) + dy * math.cos(radians)]
            require(math.dist(endpoint, end) < 1e-7, f'{context}: arc sweep/sign ends at wrong point')
            a_angle = math.atan2(dy, dx)
            mid_angle = math.atan2(mid[1] - center[1], mid[0] - center[0])
            travel = math.degrees((mid_angle - a_angle if sweep >= 0 else a_angle - mid_angle) % (2 * math.pi))
            require(travel <= abs(sweep) + 1e-7, f'{context}: arc sweep does not pass source midpoint')
            stats['audited_three_point_arcs'] += 1
        stats['audited_graphic_primitives'] += 1


class Disjoint:
    def __init__(self):
        self.parent = {}

    def find(self, point):
        self.parent.setdefault(point, point)
        if self.parent[point] != point:
            self.parent[point] = self.find(self.parent[point])
        return self.parent[point]

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)


def coordinate(xy):
    return tuple(round(float(v), 5) for v in xy[:2])


def main():
    errors, notices = [], []
    stats = Counter()

    def require(condition, message):
        if not condition:
            errors.append(message)

    canonical = json.loads((ROOT / 'output/pcb/Quipus-A1/connections.json').read_text())
    parts = {c['ref']: c for c in canonical['components']}
    expected_nets = {p['net'] for c in parts.values() for p in c['pins'] if p['net'] is not None}
    assignments = {}
    for domain in ('power', 'controller', 'audio'):
        for comp in json.loads((HERE / f'footprints-{domain}.json').read_text())['components']:
            require(comp['ref'] not in assignments, f"Duplicate assignment {comp['ref']}")
            assignments[comp['ref']] = comp
    board = sexp((OUT / 'Quipus-A1.kicad_pcb').read_text())
    schematic = sexp((OUT / 'Quipus-A1.kicad_sch').read_text())
    manifest = json.loads((OUT / 'manifest.json').read_text())
    placement = json.loads((OUT / 'placement.json').read_text())
    require(set(parts) == set(assignments), 'Canonical components and footprint manifest references differ')
    nets = {int(n[1]): n[2] for n in kids(board, 'net')}
    require(nets.get(0) == '', 'Board net0 must be empty')
    require(set(nets.values()) - {''} == expected_nets, 'Board positive-net names differ from canonical netlist')
    require(len(nets) - 1 == 92 == len(expected_nets), 'Expected92 positive nets')
    require(manifest.get('nets') == len(expected_nets), 'Manifest net count differs')
    require(len(parts) == 144 == manifest.get('components'), 'Expected144 canonical components')
    modules = kids(board, 'module')
    by_ref = {}
    for module in modules:
        field = next((t for t in kids(module, 'fp_text') if t[1] == 'reference'), None)
        require(field is not None, 'PCB module lacks reference field')
        if field is not None:
            require(field[2] not in by_ref, f'Duplicate board module {field[2]}')
            by_ref[field[2]] = module
    require(len(modules) == 148, 'Expected148 modules including4 mounting holes')
    require(set(by_ref) == set(parts) | {'H1', 'H2', 'H3', 'H4'}, 'PCB references differ from components plus mounting holes')
    symbols = kids(schematic, 'symbol')
    by_symbol = {}
    for symbol in symbols:
        props = {p[1]: p[2] for p in kids(symbol, 'property')}
        require(props.get('Reference') not in by_symbol, f"Duplicate schematic symbol {props.get('Reference')}")
        by_symbol[props['Reference']] = (symbol, props)
    require(len(symbols) == 144 and set(by_symbol) == set(parts), 'Flat schematic does not contain exactly144 canonical references')
    require(not kids(schematic, 'global_label') and not kids(schematic, 'sheet'), 'Flat import must not contain global labels or hierarchical sheets')
    require(values(schematic, 'paper') == ['User', '1260', '891'], 'Flat sheet size differs from1260x891')
    labels = kids(schematic, 'label')
    require({l[1] for l in labels} == expected_nets, 'Flat local-label name set differs from92 canonical nets')
    expected_labeled_pins = sum(p['net'] is not None for c in parts.values() for p in c['pins'])
    require(len(labels) == expected_labeled_pins, 'Flat label occurrence count differs from connected pin count')

    original_trees = {}
    basename_inventory = defaultdict(list)
    for ref, comp in parts.items():
        assignment = assignments[ref]
        source_path = ROOT / assignment['footprint_file']
        original = original_trees.setdefault(str(source_path), sexp(source_path.read_text()))
        require(not assignment.get('sha256') or hashlib.sha256(source_path.read_bytes()).hexdigest() == assignment['sha256'], f'{ref}: source footprint checksum stale')
        basename_inventory[source_path.stem].append((ref, str(source_path), physical_inventory(original)))
        module = by_ref.get(ref)
        if module is None:
            continue
        x, y, angle, side = placement['placements'][ref]
        back = side.upper() == 'B'
        require(same(values(module, 'at'), [x, y, angle]), f'{ref}: placement coordinates/angle changed')
        require(values(module, 'layer') == ['B.Cu' if back else 'F.Cu'], f'{ref}: board side changed')
        require(module[1] == 'Quipus:' + source_path.stem, f'{ref}: board footprint ID differs from source basename')
        symbol, props = by_symbol[ref]
        root_id = values(schematic, 'uuid')[0]
        symbol_id = values(symbol, 'uuid')[0]
        require(values(module, 'path') == [f'/{root_id}/{symbol_id}'], f'{ref}: PCB path does not associate with flat schematic symbolUUID')
        require(props['Footprint'] == module[1], f'{ref}: schematic footprint ID differs from PCB module')
        instance = one(one(one(symbol, 'instances'), 'project'), 'path')
        require(instance[1] == '/' + root_id and values(instance, 'reference') == [ref], f'{ref}: flattened schematic instance path/reference invalid')
        original_pads, actual_pads = kids(original, 'pad'), kids(module, 'pad')
        require(len(original_pads) == len(actual_pads), f'{ref}: physical pad instances were lost/added')
        mapping = assignment.get('pad_mapping', assignment.get('padmap', {}))
        expected_pad_nets = {str(mapping.get(p['number'], p['number'])): p['net'] for p in comp['pins']}
        for index, (before, after) in enumerate(zip(original_pads, actual_pads)):
            tag = f'{ref}.pad[{index}]({before[1]})'
            require(before[1:4] == after[1:4], f'{tag}: pad number/type/shape changed')
            for key in ('size', 'drill', 'roundrect_rratio', 'solder_mask_margin', 'solder_paste_margin', 'solder_paste_margin_ratio', 'options'):
                require(same(values(before, key), values(after, key)), f'{tag}: {key} changed')
            at = [float(v) for v in values(before, 'at')]
            expected_at = [(-at[0] if back else at[0]), at[1], angle + (-at[2] if back else at[2]) if len(at) > 2 else angle]
            require(same(values(after, 'at'), expected_at), f'{tag}: local reflection or absolute pad rotation incorrect')
            require(values(after, 'layers') == [flip_layer(v, back) for v in values(before, 'layers')], f'{tag}: front/back pad layers incorrect')
            check_graphics(kids(one(before, 'primitives', [])), kids(one(after, 'primitives', [])), back, require, tag + '.primitives', stats)
            net = values(after, 'net')
            expected = expected_pad_nets.get(str(before[1]))
            if expected is None:
                require(net is None or int(net[0]) == 0, f'{tag}: unconnected/mechanical pad acquired a net')
            else:
                require(net is not None and nets.get(int(net[0])) == expected and net[1] == expected, f'{tag}: physical copper net differs from canonical net {expected}')
            stats['audited_pad_instances'] += 1
        original_graphics = [g for g in kids(original) if g[0].startswith('fp_') and g[0] != 'fp_text']
        actual_graphics = [g for g in kids(module) if g[0].startswith('fp_') and g[0] != 'fp_text']
        check_graphics(original_graphics, actual_graphics, back, require, ref + '.graphics', stats)
        stats['audited_components'] += 1

    # Detect same-basename overwrites and then verify the reusable library lands
    # match every source that references them, independent of board placement.
    for basename, entries in basename_inventory.items():
        first = entries[0][2]
        paths = {e[1] for e in entries}
        if len(paths) > 1:
            stats['coalesced_basename_groups'] += 1
        for ref, path, inventory in entries:
            require(same(first, inventory), f'{basename}: basename collision would overwrite different physical geometry for {ref}')
        libpath = OUT / 'Quipus.pretty' / (basename + '.kicad_mod')
        require(libpath.is_file(), f'{basename}: reusable footprint file absent')
        if libpath.is_file():
            actual = physical_inventory(sexp(libpath.read_text()))
            require(same(first, actual), f'{basename}: reusable library physical geometry differs from its source')
    require(manifest.get('physical_footprint_count') == len(list((OUT / 'Quipus.pretty').glob('*.kicad_mod'))), 'Manifest reusable-footprint count differs from directory')

    # Independently resolve each flattened schematic pin through its short
    # wire to local labels. This catches correct-looking label sets attached
    # to the wrong pin after flattening or coordinate translation.
    graph = Disjoint()
    for wire in kids(schematic, 'wire'):
        pts = [coordinate(p[1:]) for p in kids(one(wire, 'pts'), 'xy')]
        for a, b in zip(pts, pts[1:]):
            graph.union(a, b)
    names_at_root = defaultdict(set)
    for label in labels:
        names_at_root[graph.find(coordinate(values(label, 'at')))].add(label[1])
    for names in names_at_root.values():
        require(len(names) == 1, f'Wire component shorts multiple local labels: {sorted(names)}')
    nc_points = {coordinate(values(nc, 'at')) for nc in kids(schematic, 'no_connect')}
    libs = {s[1]: s for s in kids(one(schematic, 'lib_symbols'), 'symbol')}
    require(len(libs) == 144, 'Expected144 embedded library symbols')
    for ref, comp in parts.items():
        symbol, props = by_symbol[ref]
        lib = libs[values(symbol, 'lib_id')[0]]
        pin_nodes = [node for node in walk(lib) if node and node[0] == 'pin' and one(node, 'number')]
        pin_by_number = {values(p, 'number')[0]: p for p in pin_nodes}
        sx, sy, rotation = [float(v) for v in values(symbol, 'at')]
        require(one(symbol, 'mirror') is None, f'{ref}: unexpected schematic mirror requires separate coordinate audit')
        theta = math.radians(rotation)
        for pin in comp['pins']:
            number = str(pin['number'])
            require(number in pin_by_number, f'{ref}.{number}: embedded symbol pin absent')
            if number not in pin_by_number:
                continue
            px, py = [float(v) for v in values(pin_by_number[number], 'at')[:2]]
            loc = coordinate([sx + px * math.cos(theta) - py * math.sin(theta), sy - px * math.sin(theta) - py * math.cos(theta)])
            attached = names_at_root.get(graph.find(loc), set())
            if pin['net'] is None:
                require(not attached and loc in nc_points, f'{ref}.{number}: expected explicit unconnected marker')
            else:
                require(attached == {pin['net']}, f"{ref}.{number}: schematic wire/label resolves to {sorted(attached)}, expected {pin['net']}")
            stats['audited_schematic_pins'] += 1

    # Check the asymmetric custom mic annulus independently in global space.
    for ref in ('U20', 'U21'):
        module = by_ref[ref]
        ox, oy, rotation = [float(v) for v in values(module, 'at')]
        ring = next(p for p in kids(module, 'pad') if p[1] == '5')
        hole = next(p for p in kids(module, 'pad') if p[2] == 'np_thru_hole')
        circle = one(one(ring, 'primitives'), 'gr_circle')
        ax, ay, pad_angle = [float(v) for v in values(ring, 'at')]
        cx, cy = [float(v) for v in values(circle, 'center')]
        anchor_global = point(ax, ay, ox, oy, rotation)
        relative_global = point(cx, cy, 0, 0, pad_angle)
        ring_global = [anchor_global[i] + relative_global[i] for i in (0, 1)]
        hx, hy = [float(v) for v in values(hole, 'at')[:2]]
        hole_global = point(hx, hy, ox, oy, rotation)
        require(math.dist(ring_global, hole_global) < 1e-7, f'{ref}: reflected ring no longer concentric with acoustic hole')
        require(same(values(circle, 'width'), ['0.37']), f'{ref}: annular copper stroke was changed/filled')
        require(same(values(hole, 'drill'), ['0.6']), f'{ref}: acoustic NPTH diameter changed')
        require(values(ring, 'layers') == ['B.Cu'], f'{ref}: mic ground ring must be on back copper')
        require(len([n for n in kids(module, 'fp_poly') if values(n, 'layer') == ['B.Paste']]) == 3, f'{ref}: three separate paste sectors missing')
        stats['audited_microphone_rings'] += 1

    # Expected lifted keepout polygons come directly from source zones.
    actual_zones = kids(board, 'zone')
    expected_zone_polygons = []
    for ref in ('U1', 'J6'):
        x, y, angle, side = placement['placements'][ref]
        source = original_trees[str(ROOT / assignments[ref]['footprint_file'])]
        for zone in kids(source, 'zone'):
            require(one(zone, 'keepout') is not None, f'{ref}: unknown source zone type')
            layers = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] if ref == 'U1' else [flip_layer(v, side == 'B') for v in values(zone, 'layers', values(zone, 'layer', ['F.Cu']))]
            for polygon in kids(zone, 'polygon'):
                points = [point(float(p[1]), float(p[2]), x, y, angle, side == 'B') for p in kids(one(polygon, 'pts'), 'xy')]
                for layer in layers:
                    expected_zone_polygons.append((ref, layer, points))
    require(len(actual_zones) == len(expected_zone_polygons), 'Lifted keepout polygon/layer count differs from source')
    for ref, layer, points in expected_zone_polygons:
        matches = [z for z in actual_zones if values(z, 'layer') == [layer] and same([p[1:] for p in kids(one(one(z, 'polygon'), 'pts'), 'xy')], points, 1e-6)]
        require(len(matches) == 1, f'{ref}: expected keepout polygon on {layer} missing/duplicated')
        if matches:
            for rule in ('tracks', 'vias', 'copperpour'):
                require(values(one(matches[0], 'keepout'), rule) == ['not_allowed'], f'{ref}: {layer} keepout fails to block{rule}')
    stats['audited_keepout_zones'] = len(actual_zones)

    # Token checks are grounded in official KiCad5.1 pcb_parser.cpp rather than
    # modern documentation. They catch filled-polygon and smd/boolean mistakes
    # that a balanced S-expression check alone cannot detect.
    allowed_pad = {'at', 'size', 'drill', 'layers', 'net', 'rect_delta', 'die_length', 'solder_mask_margin', 'solder_paste_margin',
                   'solder_paste_margin_ratio', 'clearance', 'zone_connect', 'thermal_width', 'thermal_gap', 'roundrect_rratio', 'options', 'primitives'}
    allowed_module = {'layer', 'tedit', 'tstamp', 'at', 'descr', 'tags', 'path', 'autoplace_cost90', 'autoplace_cost180', 'solder_mask_margin',
                      'solder_paste_margin', 'solder_paste_ratio', 'clearance', 'zone_connect', 'thermal_width', 'thermal_gap', 'attr', 'fp_text',
                      'fp_arc', 'fp_circle', 'fp_curve', 'fp_line', 'fp_poly', 'pad', 'model'}
    legacy_graphic_fields = {'fp_line': {'start', 'end', 'layer', 'width', 'tstamp', 'status'},
                             'fp_arc': {'start', 'end', 'angle', 'layer', 'width', 'tstamp', 'status'},
                             'fp_circle': {'center', 'end', 'layer', 'width', 'tstamp', 'status'},
                             'fp_poly': {'pts', 'layer', 'width', 'tstamp', 'status'}}
    for module in modules:
        ref_field = next(t for t in kids(module, 'fp_text') if t[1] == 'reference')
        ref = ref_field[2]
        for item in kids(module):
            require(item[0] in allowed_module, f'{ref}: unsupported KiCad5 module token {item[0]}')
            if item[0] == 'attr':
                require(set(item[1:]) <= {'smd', 'virtual'}, f'{ref}: unsupported modern footprint attributes')
            if item[0] == 'fp_text':
                require(item[1] in ('reference', 'value', 'user'), f'{ref}: invalid legacy footprint text type')
                require(len(item) > 3 and isinstance(item[3], list) and item[3][0] == 'at', f'{ref}: legacy fp_text requires at before layer/effects')
                require({n[0] for n in kids(item)} <= {'at', 'layer', 'effects'}, f'{ref}: unsupported legacy footprint text field')
                effects = one(item, 'effects', [])
                require({n[0] for n in kids(effects)} <= {'font', 'justify'}, f'{ref}: unsupported legacy text effect')
                require({n[0] for n in kids(one(effects, 'font', []))} <= {'size', 'thickness'}, f'{ref}: unsupported legacy font field')
                require(set(values(effects, 'justify', [])) <= {'left', 'right', 'top', 'bottom', 'mirror'}, f'{ref}: unsupported legacy text justification')
            if item[0] in legacy_graphic_fields:
                require({n[0] for n in kids(item)} <= legacy_graphic_fields[item[0]], f'{ref}: unsupported legacy{item[0]} field')
            if item[0] == 'pad':
                require(item[2] in ('thru_hole', 'smd', 'connect', 'np_thru_hole'), f'{ref}: invalid pad type')
                require(item[3] in ('circle', 'rect', 'oval', 'trapezoid', 'roundrect', 'custom'), f'{ref}: invalid pad shape')
                require({n[0] for n in kids(item)} <= allowed_pad, f'{ref}: unsupported legacy pad field')
                for primitive in kids(one(item, 'primitives', [])):
                    require(primitive[0] in ('gr_line', 'gr_arc', 'gr_circle', 'gr_poly'), f'{ref}: unsupported legacy custom primitive')
                    require(one(primitive, 'fill') is None and one(primitive, 'stroke') is None and one(primitive, 'mid') is None,
                            f'{ref}: modern fill/stroke/mid remains in custom primitive')
    notices.append('Legacy keepouts enforce tracks/vias/copper pours; component/pad placement clearance still requires native mechanical/DRC review.')
    notices.append('The carrier is unrouted and has no fabrication approval. This audit does not certify native EasyEDA ERC/DRC or imported geometry.')
    report = {'status': 'pass' if not errors else 'fail', 'scope': 'Independent carrier net, label connectivity, pin association, pad geometry, basename collision and legacy token audit',
              'components': len(parts), 'pcb_modules': len(modules), 'schematic_symbols': len(symbols), 'positive_nets': len(nets) - 1,
              'unique_labels': len({l[1] for l in labels}), 'label_occurrences': len(labels), 'stats': dict(stats),
              'errors': errors, 'notices': notices, 'native_erc_drc': 'not performed',
              'pcb_sha256': hashlib.sha256((OUT / 'Quipus-A1.kicad_pcb').read_bytes()).hexdigest(),
              'schematic_sha256': hashlib.sha256((OUT / 'Quipus-A1.kicad_sch').read_bytes()).hexdigest(),
              'grammar_source': 'https://github.com/KiCad/kicad-source-mirror/blob/5.1/pcbnew/pcb_parser.cpp'}
    target = OUT / 'import-validation.json'
    target.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
