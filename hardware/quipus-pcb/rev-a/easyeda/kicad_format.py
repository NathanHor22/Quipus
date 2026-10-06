"""Loss-preserving footprint downleveling for the Quipus EasyEDA import.

KiCad 5 board ``module`` syntax is used. Dimensions are millimetres. Source
quoted strings remain distinguishable from symbols/numbers after parse/dump.
Module angle is KiCad's counterclockwise angle in screen coordinates:
global=(x+px*cos(a)+py*sin(a), y-px*sin(a)+py*cos(a)). Pad/text angles in the
board file are absolute, so their source local angle is added to module angle.

Back placement uses a deliberately defined LOCAL X reflection, then the same
module rotation. Every point (including custom pad primitives) is reflected.
Local pad angle consequently becomes -phi. Using 180-phi *and* reflecting
custom primitives would rotate an asymmetric acoustic ring a second time.
For symmetric rect/oval pads, -phi and 180-phi have identical geometry.

Modern footprint keepout zones cannot be nested in a KiCad5 module. They are
reported and must be lifted using extract_keepouts() into board-level zones.
Models are omitted: their upstream environment-variable paths are unavailable.
No native CAD/ERC/DRC validation is asserted by this text-format utility.

Rotation/primitive behavior was checked against the official KiCad5.1 sources:
https://github.com/KiCad/kicad-source-mirror/blob/5.1/pcbnew/class_pad.cpp
https://github.com/KiCad/kicad-source-mirror/blob/5.1/pcbnew/class_module.cpp
Legacy arc sign was checked against the official KiCad5.1.10 Hirose footprint.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import re
import warnings


class Quoted(str):
    """An explicitly quoted KiCad string, including an empty string."""


def quote(value):
    return Quoted(str(value))


def parse(text):
    """Parse one complete S-expression; reject trailing tokens/unclosed lists."""
    tokens = re.findall(r';[^\r\n]*|"(?:\\.|[^"\\])*"|[()]|[^\s();]+', text)
    stack, result = [], None
    for token in tokens:
        if token.startswith(';'):
            continue
        if token == '(':
            expression = []
            if stack:
                stack[-1].append(expression)
            elif result is not None:
                raise ValueError('More than one root S-expression')
            stack.append(expression)
        elif token == ')':
            if not stack:
                raise ValueError('Unexpected closing parenthesis')
            expression = stack.pop()
            if not stack:
                result = expression
        else:
            if not stack:
                raise ValueError('Atom outside a root S-expression')
            if token.startswith('"'):
                try:
                    atom = Quoted(json.loads(token))
                except json.JSONDecodeError:
                    atom = Quoted(token[1:-1].replace('\\"', '"').replace('\\\\', '\\'))
            else:
                atom = token
            stack[-1].append(atom)
    if stack or result is None:
        raise ValueError('Unclosed or missing root S-expression')
    return result


def dumps(expression, indent=0):
    """Serialize a parsed tree. Bare strings stay bare; Quoted values stay quoted."""
    if not isinstance(expression, (list, tuple)):
        if isinstance(expression, Quoted):
            return json.dumps(str(expression), ensure_ascii=False)
        if isinstance(expression, bool):
            return 'yes' if expression else 'no'
        if isinstance(expression, float):
            return number(expression)
        atom = str(expression)
        if not atom or re.search(r'[\s()";]', atom):
            return json.dumps(atom, ensure_ascii=False)
        return atom
    if not expression:
        return '()'
    if all(not isinstance(x, (list, tuple)) for x in expression):
        return '(' + ' '.join(dumps(x) for x in expression) + ')'
    initial = []
    index = 0
    while index < len(expression) and not isinstance(expression[index], (list, tuple)):
        initial.append(dumps(expression[index]))
        index += 1
    pieces = ['(' + ' '.join(initial)]
    for element in expression[index:]:
        pieces.append('\n' + ' ' * (indent + 2) + dumps(element, indent + 2))
    return ''.join(pieces) + ')'


def children(node, name=None):
    """Return immediate list children, optionally with a given first atom."""
    return [x for x in node if isinstance(x, list) and x and (name is None or x[0] == name)]


def child(node, name, default=None):
    """Return the complete first child list, or default when absent."""
    return next(iter(children(node, name)), default)


def child_values(node, name, default=None):
    entry = child(node, name)
    return entry[1:] if entry is not None else default


def number(value):
    value = float(value)
    if abs(value) < 5e-10:
        value = 0.0
    return f'{value:.10f}'.rstrip('0').rstrip('.')


def _side_is_back(side):
    value = str(side).lower()
    if value in ('f', 'front', 'top', 'f.cu'):
        return False
    if value in ('b', 'back', 'bottom', 'b.cu'):
        return True
    raise ValueError(f'Unknown footprint side: {side!r}')


def _layer(layer, back):
    value = str(layer)
    if back and value.startswith(('F.', 'B.')):
        value = ('B.' if value.startswith('F.') else 'F.') + value[2:]
    return quote(value) if isinstance(layer, Quoted) else value


_DROP = {'uuid', 'version', 'generator', 'generator_version', 'embedded_fonts',
         'duplicate_pad_numbers_are_jumpers', 'private_layers', 'unlocked',
         'remove_unused_layers', 'keep_end_layers', 'property', 'pinfunction',
         'pintype', 'solder_mask_mode', 'net_tie_pad_groups', 'face', 'line_spacing',
         'knockout', 'render_cache', 'locked', 'tstamp', 'thermal_bridge_angle'}
_XY_KEYS = {'at', 'start', 'end', 'mid', 'center', 'xy', 'offset', 'rect_delta'}


def _clean(node, back=False):
    """Strip only unsupported metadata; preserve shapes and physical dimensions."""
    if not isinstance(node, list):
        return node
    if not node:
        return []
    key = node[0]
    if key in _DROP:
        return None
    if key == 'stroke':
        return copy.deepcopy(child(node, 'width', ['width', '0']))
    if key in ('layer', 'layers'):
        return [key, *[_layer(x, back) for x in node[1:]]]
    if key in _XY_KEYS and len(node) >= 3 and not isinstance(node[1], list):
        out = copy.deepcopy(node)
        if back:
            out[1] = number(-float(out[1]))
        return out
    if key == 'angle' and back:
        return [key, number(-float(node[1]))]
    result = []
    for entry in node:
        cleaned = _clean(entry, back) if isinstance(entry, list) else entry
        if cleaned is not None:
            result.append(cleaned)
    return result


def _replace_child(node, key, replacement):
    node[:] = [x for x in node if not (isinstance(x, list) and x and x[0] == key)]
    if replacement is not None:
        node.append(replacement)


def _arc_to_legacy(node):
    """Convert three-point arcs to center/start/signed sweep without tessellation."""
    if child(node, 'mid') is None:
        return node
    a = list(map(float, child(node, 'start')[1:3]))
    b = list(map(float, child(node, 'mid')[1:3]))
    c = list(map(float, child(node, 'end')[1:3]))
    determinant = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
    if abs(determinant) < 1e-12:
        raise ValueError('Cannot normalize a collinear three-point arc')
    squared = [p[0] ** 2 + p[1] ** 2 for p in (a, b, c)]
    cx = (squared[0] * (b[1] - c[1]) + squared[1] * (c[1] - a[1]) + squared[2] * (a[1] - b[1])) / determinant
    cy = (squared[0] * (c[0] - b[0]) + squared[1] * (a[0] - c[0]) + squared[2] * (b[0] - a[0])) / determinant
    theta = [math.atan2(p[1] - cy, p[0] - cx) for p in (a, b, c)]
    full = 2 * math.pi
    end_ccw = (theta[2] - theta[0]) % full
    mid_ccw = (theta[1] - theta[0]) % full
    sweep = end_ccw if mid_ccw <= end_ccw + 1e-10 else end_ccw - full
    extra = [x for x in node[1:] if not (isinstance(x, list) and x and x[0] in ('start', 'mid', 'end', 'angle'))]
    return [node[0], ['start', number(cx), number(cy)], ['end', number(a[0]), number(a[1])], ['angle', number(math.degrees(sweep))], *extra]


def _graphics(node, back):
    node = _clean(node, back)
    if node[0] in ('fp_arc', 'gr_arc'):
        node = _arc_to_legacy(node)
    if node[0] in ('fp_rect', 'gr_rect'):
        a, b = child(node, 'start')[1:3], child(node, 'end')[1:3]
        corners = [a, [b[0], a[1]], b, [a[0], b[1]]]
        extras = [x for x in node[1:] if not (isinstance(x, list) and x and x[0] in ('start', 'end', 'fill'))]
        if child_values(node, 'fill') not in (None, ['none'], ['no']):
            raise ValueError('Filled rectangles require an exact polygon conversion')
        kind = 'fp_line' if node[0] == 'fp_rect' else 'gr_line'
        return [[kind, ['start', *corners[i]], ['end', *corners[(i + 1) % 4]], *copy.deepcopy(extras)] for i in range(4)]
    if node[0] in ('fp_poly', 'gr_poly'):
        fill = child_values(node, 'fill')
        # KiCad5 parseEDGE_MODULE/parseDRAWSEGMENT polygons are implicitly
        # filled. Modern explicit solid/yes is redundant and is not a valid
        # legacy token. Preserve an explicitly unfilled polygon as its edges.
        if fill in (['none'], ['no']):
            vertices = [p[1:3] for p in children(child(node, 'pts', []), 'xy')]
            extras = [e for e in node[1:] if not (isinstance(e, list) and e and e[0] in ('pts', 'fill'))]
            kind = 'fp_line' if node[0] == 'fp_poly' else 'gr_line'
            return [[kind, ['start', *vertices[i]], ['end', *vertices[(i + 1) % len(vertices)]], *copy.deepcopy(extras)]
                    for i in range(len(vertices))]
        if fill not in (None, ['solid'], ['yes']):
            raise ValueError(f'Unsupported polygon fill mode: {fill!r}')
        _replace_child(node, 'fill', None)
    if str(node[0]).startswith('gr_'):
        # KiCad5 custom pad primitives reuse parseDRAWSEGMENT: it has no fill
        # token. A zero-width gr_circle represents a filled disk; a positive
        # width remains an annulus. Do not collapse the microphone's annulus.
        fill = child_values(node, 'fill')
        if node[0] == 'gr_circle' and fill in (['yes'], ['solid']):
            _replace_child(node, 'width', ['width', '0'])
        elif node[0] != 'gr_poly' and fill not in (None, ['none'], ['no']):
            raise ValueError(f'Unsupported primitive fill mode: {fill!r}')
        _replace_child(node, 'fill', None)
    if str(node[0]).startswith('fp_'):
        # KiCad5 footprint graphics are outlines unless they are polygons.
        fill = child_values(node, 'fill')
        if node[0] in ('fp_line', 'fp_arc', 'fp_circle'):
            if fill not in (None, ['none'], ['no']):
                raise ValueError(f'Filled {node[0]} requires an exact pad/polygon conversion')
            _replace_child(node, 'fill', None)
    return [node]


def _text(node, kind, text, angle, back):
    result = ['fp_text', kind, quote(text)]
    for entry in node[3:]:
        if isinstance(entry, list) and entry and entry[0] == 'hide':
            if len(entry) == 1 or entry[1] == 'yes':
                result.append('hide')
            continue
        cleaned = _clean(entry, back) if isinstance(entry, list) else entry
        if cleaned is not None:
            result.append(cleaned)
    at = child(result, 'at', ['at', '0', '0'])
    local_angle = float(at[3]) if len(at) > 3 else 0.0
    # KiCad5 parseTEXTE_MODULE requires the at expression immediately after
    # fp_text kind/content. Other fields can follow, but at cannot be appended.
    _replace_child(result, 'at', None)
    result.insert(3, ['at', at[1], at[2], number(angle + (-local_angle if back else local_angle))])
    if child(result, 'layer') is None:
        result.append(['layer', 'B.SilkS' if back else 'F.SilkS'])
    effects = child(result, 'effects')
    if effects is None:
        effects = ['effects', ['font', ['size', '1', '1'], ['thickness', '0.15']]]
        result.append(effects)
    if back:
        justify = child(effects, 'justify')
        if justify is None:
            effects.append(['justify', 'mirror'])
        elif 'mirror' not in justify:
            justify.append('mirror')
    return result


def _net_entry(value):
    if isinstance(value, dict):
        index = value.get('id', value.get('number', value.get('net_id')))
        name = value.get('name', value.get('net_name'))
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        index, name = value
    else:
        raise ValueError('pad_nets entries must be (net_id, net_name) or a dict with id/name')
    if index is None or name is None:
        raise ValueError(f'Incomplete pad net: {value!r}')
    return ['net', str(int(index)), quote(name)]


def load_footprint(path, ref, value, x, y, angle=0, side='F', pad_nets=None,
                   footprint_id=None, sheet_path=None):
    """Return one KiCad5 module expression, retaining every source physical pad.

    pad_nets is keyed by physical pad number; entries are (integer_id, name).
    Repeated pad numbers receive the same net. Unnumbered paste/NPTH pads are
    always retained and do not receive an electrical net.
    """
    source = parse(Path(path).read_text(encoding='utf-8-sig'))
    if source[0] not in ('footprint', 'module'):
        raise ValueError('Expected a KiCad footprint/module')
    back = _side_is_back(side)
    angle = float(angle)
    stamp = hashlib.sha256(str(ref).encode()).hexdigest()[:8].upper()
    result = ['module', quote(footprint_id or source[1]), ['layer', 'B.Cu' if back else 'F.Cu'],
              ['tedit', '0'], ['tstamp', stamp], ['at', number(x), number(y), number(angle)]]
    if sheet_path:
        result.append(['path', quote(sheet_path)])
    fields = set()
    for entry in source[2:]:
        if not isinstance(entry, list) or not entry:
            continue
        key = entry[0]
        if key in _DROP or key in ('layer', 'at', 'model', 'path'):
            if key != 'property':
                continue
        if key == 'zone':
            warnings.warn(f'{ref}: footprint keepout must be lifted into board-level zones with extract_keepouts()', stacklevel=2)
            continue
        if key == 'property':
            if entry[1] in ('Reference', 'Value'):
                kind = 'reference' if entry[1] == 'Reference' else 'value'
                result.append(_text(entry, kind, ref if kind == 'reference' else value, angle, back))
                fields.add(kind)
            continue
        if key == 'fp_text':
            kind = str(entry[1])
            content = ref if kind == 'reference' else value if kind == 'value' else str(entry[2]).replace('${REFERENCE}', '%R')
            result.append(_text(entry, kind, content, angle, back))
            fields.add(kind)
            continue
        if key == 'pad':
            pad = _clean(entry, back)
            pad[1] = quote(pad[1])
            at = child(pad, 'at', ['at', '0', '0'])
            local_angle = float(at[3]) if len(at) > 3 else 0.0
            _replace_child(pad, 'at', ['at', at[1], at[2], number(angle + (-local_angle if back else local_angle))])
            _replace_child(pad, 'net', None)
            primitives = child(pad, 'primitives')
            if primitives:
                normalized = []
                for primitive in primitives[1:]:
                    normalized.extend(_graphics(primitive, False))
                primitives[:] = ['primitives', *normalized]
            if pad[1] and pad_nets and str(pad[1]) in pad_nets:
                pad.append(_net_entry(pad_nets[str(pad[1])]))
            result.append(pad)
            continue
        if key == 'attr':
            attributes = [a for a in entry[1:] if a in ('smd', 'virtual')]
            if attributes:
                result.append(['attr', *attributes])
            continue
        if key.startswith('fp_'):
            result.extend(_graphics(entry, back))
            continue
        cleaned = _clean(entry, back)
        if cleaned is not None:
            result.append(cleaned)
    for kind, content, py in (('reference', ref, -2), ('value', value, 2)):
        if kind not in fields:
            result.append(_text(['fp_text', kind, quote(content), ['at', '0', str(py)],
                                 ['layer', 'F.SilkS' if kind == 'reference' else 'F.Fab']],
                                kind, content, angle, back))
    return dumps(result)


def transform_point(px, py, x, y, angle=0, side='F'):
    """Map a source footprint point to board coordinates using the defined flip."""
    if _side_is_back(side):
        px = -float(px)
    radians = math.radians(float(angle))
    return (float(x) + float(px) * math.cos(radians) + float(py) * math.sin(radians),
            float(y) - float(px) * math.sin(radians) + float(py) * math.cos(radians))


def extract_keepouts(path, x, y, angle=0, side='F'):
    """Return keepout dictionaries for parent board-level zone serialization.

    Preserve all polygons. The parent must expand an antenna keepout onto ALL
    copper layers as required by Espressif; source layers alone are insufficient.
    """
    source = parse(Path(path).read_text(encoding='utf-8-sig'))
    back = _side_is_back(side)
    output = []
    for zone in children(source, 'zone'):
        keepout = child(zone, 'keepout')
        if not keepout:
            raise ValueError('Non-keepout footprint zone cannot be silently discarded')
        layers = child_values(zone, 'layers') or child_values(zone, 'layer') or ['F.Cu']
        polygons = []
        for polygon in children(zone, 'polygon'):
            points = child(polygon, 'pts', [])
            polygons.append([transform_point(float(p[1]), float(p[2]), x, y, angle, side)
                             for p in children(points, 'xy')])
        output.append({'layers': [str(_layer(layer, back)) for layer in layers],
                       'polygons': polygons,
                       'rules': {str(r[0]): str(r[1]) for r in keepout[1:] if isinstance(r, list) and len(r) >= 2}})
    return output
