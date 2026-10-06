"""Prepare a minimally corrected live EasyEDA footprint File Source.

This writes a candidate for ordinary native Apply/Save; it never controls the
browser or changes the project. Live DOCHEAD/CANVAS/META and every primitive
identifier are retained. Test with a fresh File Source capture after Save.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import audit_native as audit

LIBRARIES={
    '99bab940c4f22b22':('U20','mic-library-fixed.esource',None),
    '029edec69c75e6d9':('U23','adc-library-fixed.esource',None),
    '530feb5bd26552e7':('U1','u1-library-fixed.esource',{'41'}),
    '0053beec1f9b605e':('U2','u2-library-fixed.esource',{'17'}),
    'b6a370204b09708a':('U11','u11-library-fixed.esource',{'8'}),
    'bba72ce0ed319fc5':('U12','u12-library-fixed.esource',{'13'}),
    'c5c3dbc7f1f36107':('U22','u22-library-fixed.esource',{'17'}),
}


def main():
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument('live_source',type=Path)
    args.add_argument('--output',type=Path)
    options=args.parse_args()
    documents=audit.packed(options.live_source)
    if len(documents)!=1 or documents[0]['head']['uuid'] not in LIBRARIES:
        raise ValueError('Expected one recognized live footprint document UUID')
    document=documents[0]
    ref,filename,numbers=LIBRARIES[document['head']['uuid']]
    parse=audit.parser()
    carrier_path=audit.ROOT/'output/pcb/Quipus-B1-EasyEDA/Quipus-B1.kicad_pcb'
    tree=parse.sexp(carrier_path.read_text(encoding='utf-8'))
    module=next(m for m in parse.kids(tree,'module')
                if any(x[1]=='reference' and x[2]==ref for x in parse.kids(m,'fp_text')))
    target=options.output or audit.HERE/filename
    source_paste=audit.source_paste_contours(module,parse) if ref=='U20' else None
    before=audit.paste_geometry_audit(document,module,parse)
    result=audit.repair_library(document,target,microphone=ref=='U20',suppress_numbers=numbers,source_paste=source_paste)
    fixed=audit.packed(target)[0]
    after=audit.paste_geometry_audit(fixed,module,parse)
    # A malformed aperture must be reviewed, never silently released because
    # its automatic paste field was fixed.
    result.update(live_source=str(options.live_source.resolve()),live_source_sha256=audit.sha(options.live_source),
                  native_doc_type_preserved=fixed['head']['docType']==document['head']['docType'],
                  live_doc_type=document['head']['docType'],reference=ref,
                  explicit_paste_before=before,explicit_paste_after=after,manufacturing_release=False)
    target.with_suffix('.repair.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'reference':ref,'output':str(target),'records':result['record_count'],
                      'native_doc_type_preserved':result['native_doc_type_preserved'],
                      'changed_pad_count':len(result['changed_pads']),'changed_paste_geometry_count':len(result['geometry_repairs']),
                      'all_explicit_paste_contours_match_source':after['pass'],
                      'aperture_count':after['native_count'],'sha256':result['sha256']}))
    if not after['pass']:
        print(json.dumps({'unverified_geometry':after}))


if __name__=='__main__':
    main()
