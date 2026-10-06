"""Restore the four proven mounting NPTHs as standalone native PCB pads.

Uses the actual original imported mounting-hole PAD schema. A standalone
mechanical PAD has no COMPONENT/DEVICE/schematic association, so a schematic
component refresh does not treat it as an obsolete unschematized component.
All existing live board JSON records remain unchanged. A missing terminal
record separator is added before appending new records. No browser
operation, account write or fabrication release is performed by this script.
"""
from __future__ import annotations
import argparse
import copy
import json
import math
import re
from pathlib import Path
import audit_native as audit


def main():
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument('live_source',nargs='?',type=Path,default=audit.HERE/'pcb-editor-before-restore.esource')
    args.add_argument('--output',type=Path,default=audit.HERE/'pcb-mounting-holes-fixed.esource')
    options=args.parse_args()
    documents=audit.packed(options.live_source)
    if len(documents)!=1 or documents[0]['head']['docType']!='PCB':
        raise ValueError('Expected complete live File Source for one native PCB')
    live=documents[0]
    if live['head']['uuid']!='52caa9452ee66dee':
        raise ValueError('Unexpected target native board UUID')
    canvas=audit.rows(live,'CANVAS')
    if len(canvas)!=1 or canvas[0][1].get('unit')!='mil':
        raise ValueError('Native world coordinates must be verified mils')
    original_path=audit.HERE/'pcb-imported-before-fix.esource'
    original=audit.packed(original_path)
    footprint=next(d for d in original if d['head']['uuid']=='b83a27709d77ecd1' and d['head']['docType']=='FOOTPRINT')
    native_holes=audit.rows(footprint,'PAD')
    if len(native_holes)!=1:
        raise ValueError('Original mounting footprint does not have exactly one physical pad')
    template=native_holes[0][1]
    if template['plated'] or template['num'] or template['layerId']!=12 or template['hole']['holeType']!='ROUND':
        raise ValueError('Original native PAD is not a verified multi-layer circular NPTH')
    if abs(template['hole']['width']*audit.MM-2.8)>audit.TOL or template['centerX'] or template['centerY']:
        raise ValueError('Original mounting NPTH diameter/origin is not canonical')
    placement=json.loads((audit.EASYEDA/'placement.json').read_text(encoding='utf-8'))
    required=placement['mounting_holes']
    if required!=[[5,19],[60,19],[5,119],[60,119]]:
        raise ValueError('Mounting-hole plan changed; review before restoring')
    existing=[]
    for h,d in audit.rows(live,'PAD'):
        hole=d.get('hole') or {}
        if not d.get('plated') and hole.get('width') and abs(hole['width']*audit.MM-2.8)<audit.TOL:
            existing.append((h,d))
    # Reentrant for a fresh capture after native Apply: never double the holes.
    if existing and len(existing)!=4:
        raise ValueError('Partial mounting-hole restoration requires manual review')
    if existing and not all(any(math.dist([d['centerX']*audit.MM,-d['centerY']*audit.MM],xy)<.0026 for h,d in existing) for xy in required):
        raise ValueError('Existing physical mounting-hole centers differ from plan')
    raw=live['raw_rows']
    maximum_id=max((int(h['id'][2:]) for line,h,d in raw if re.fullmatch(r'ie\d+',h.get('id',''))),default=-1)
    maximum_ticket=max((h.get('ticket',-1) for line,h,d in raw),default=-1)
    maximum_z=max((d.get('zIndex',0) for line,h,d in raw if isinstance(d,dict)),default=0)
    lines=[line for line,h,d in raw]
    separator_added=False
    additions=[]
    if not existing:
        # File Source permits the very last record without a terminal pipe.
        # It becomes an interior record when we append, so its delimiter is
        # required by native Apply even though line-oriented JSON still parses.
        if lines and not lines[-1].endswith('|'):
            lines[-1]+='|'
            separator_added=True
        for index,(x,y) in enumerate(required,1):
            h={'type':'PAD','ticket':maximum_ticket+index,'id':f'ie{maximum_id+index}'}
            d=copy.deepcopy(template)
            d.update(centerX=x/audit.MM,centerY=-y/audit.MM,locked=True,zIndex=maximum_z+index)
            # No pin number, net, DEVICE, COMPONENT, BOM or schematic-link
            # fields are invented. This is the existing proven hole schema.
            lines.append(json.dumps(h,separators=(',',':'))+'||'+json.dumps(d,separators=(',',':'))+'|')
            additions.append({'id':h['id'],'reference_for_documentation':f'H{index}',
                              'center_mm':[x,y],'diameter_mm':d['hole']['width']*audit.MM,
                              'plated':False,'net':None,'representation':'standalone native board PAD'})
    options.output.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    fixed=audit.packed(options.output)[0]
    assert fixed['head']==live['head']
    assert [(h,d) for line,h,d in fixed['raw_rows'][:len(raw)]]==[(h,d) for line,h,d in raw]
    assert len(fixed['raw_rows'])==len(raw)+len(additions)
    assert len(audit.rows(fixed,'COMPONENT'))==len(audit.rows(live,'COMPONENT'))==180
    assert len(audit.rows(fixed,'PAD'))==4
    report={'status':'CANDIDATE_NATIVE_APPLY_SAVE_AND_EXPORTED_GEOMETRY_NOT_YET_VERIFIED',
            'live_source':str(options.live_source.resolve()),'live_source_sha256':audit.sha(options.live_source),
            'original_capture_sha256':audit.sha(original_path),'native_template_footprint_uuid':footprint['head']['uuid'],
            'output':str(options.output.resolve()),'output_sha256':audit.sha(options.output),
            'existing_records_unchanged':True,'electronic_component_count_preserved':180,
            'existing_json_records_unchanged':True,'terminal_separator_added_to_previous_last_record':separator_added,
            'native_dochead_and_canvas_unchanged':True,'original_records':len(raw),'output_records':len(lines),
            'new_standalone_npths':additions,'already_restored':bool(existing),
            'no_external_footprint_dependency_added':True,'manufacturing_release':False,
            'notes':['Four2.8mm NPTH PADs copy the actual original native hole geometry and use native world-mil coordinates.',
                     'Free NPTH pads are mechanical geometry rather than COMPONENT records; no unsupported exclusion property is added.',
                     'The restored holes have no electrical net and do not change113 canonical nets or180 electronic component references.',
                     'Native Apply/Save, whole-board DRC and a new packed source export are required before marking restoration verified.']}
    options.output.with_suffix('.repair.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['output','output_sha256','original_records','output_records','new_standalone_npths','already_restored']}))


if __name__=='__main__':
    main()
