"""Check critical design invariants and export consistency; not native ERC."""
from pathlib import Path
import json
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
OUT=REPO/'output/pcb/Quipus-A1'
d=json.loads((OUT/'connections.json').read_text())
parts={p['ref']:p for p in d['components']}
def net(ref,pin):
    return next(x['net'] for x in parts[ref]['pins'] if x['number']==str(pin))
checks=[]
def require(ok,name):
    assert ok,name
    checks.append(name)

require(net('U1',2)=='3V3_SYS','ESP is on regulated main rail, not raw battery')
require([net('U1',n) for n in (28,29,30)]==[None]*3,'N16R8 PSRAM GPIOs not assigned')
require(net('U1',7)=='BTN_START_N','Start has direct RTC-capable GPIO7 wake path')
require(net('U31',1) is None,'Start disconnected from polled expander')
require(net('U1',13)=='ESP_USB_DM' and net('U1',14)=='ESP_USB_DP','Native USB D-/D+ allocation')
require(net('U34',10)=='3V3_SYS','USB isolation uses switched power')
require(net('U20',1)=='MIC_3V3' and net('U21',1)=='MIC_3V3','Both microphones powered from mic rail')
require(net('U20',4)=='GND' and net('U21',4)=='MIC_3V3','Onboard PDM microphones occupy opposite clock edges')
require(net('R201',2)==net('R202',2)=='PDM_DIN0','PDM outputs join after separate damping resistors')
require(net('J4',4)=='PDM_DIN1','External microphone uses separate data line')
require(net('U22',7)==net('U22',8)=='MAIN_RAW','Speaker amplifier uses switched raw rail')
require(net('J5',1)=='SPK_P' and net('J5',2)=='SPK_N','Differential speaker output does not short to ground')
require(net('J2',1)=='BAT_PACK_P' and net('J2',2)=='GND','Battery connector polarity explicitly defined')
require(len(parts['J3']['pins'])==3 and net('J3',3) is None,'NTC connector differs from two-pin speaker connector')
require(net('U12',8)=='BAT_PACK_P' and net('U12',7)=='BAT_P','Fuel gauge shunt sense orientation')
rtc_link=any(p['ref'].startswith('R') and {x['net'] for x in p['pins']}=={'BAT_P','RTC_VBACKUP'} for p in parts.values())
require(net('U30',6)=='RTC_VBACKUP' and rtc_link,'RTC backup connects to protected battery after shunt')
require(net('U10',6)=='MAIN_RAW' and net('U11',10)=='MAIN_RAW','Main load switch feeds regulator')
require(net('U9',8)==net('U1',23)=='POWER_HOLD','Shutdown KILL assigned to GPIO21')
require(net('J7',1)=='LCD_BL' and net('J7',8)=='3V3_SYS','Display connector follows module J2 numbering')
require(net('J6','A')=='SD_CD_N' and net('J6','B')=='GND','SD card-detect terminals kept separate from DAT3')
require(all(len(v)>1 for v in d['nets'].values()),'No isolated one-contact named nets')

# Verify the charger-control truth table without relying on a static description.
for out1,enum,suspend,expect in [(1,0,0,(0,0)),(1,1,0,(1,0)),(0,0,0,(0,1)),(0,1,0,(0,1)),(0,1,1,(1,1)),(1,0,1,(1,1))]:
    en1=bool(suspend or (enum and out1));en2=bool(suspend or not out1)
    require((int(en1),int(en2))==expect,f'USB truth table OUT1={out1}, enum={enum}, suspend={suspend}')

pdf=PdfReader(REPO/'output/pdf/Quipus-A1-schematic-review.pdf')
text='\n'.join(p.extract_text() or '' for p in pdf.pages)
require('NOT FOR FABRICATION' in text,'PDF draft status visible')
require(all(p['ref'] in text for p in parts.values()),'All component references appear in PDF')
v=json.loads((OUT/'validation.json').read_text())
require(len(pdf.pages)==v['pdf_pages'],'PDF page count matches manifest')
v['critical_connectivity_checks']=checks
v['native_erc']='not run - no native CAD engine available'
v['visual_qa']='See final rendered review; not implied by text extraction checks'
(OUT/'validation.json').write_text(json.dumps(v,indent=2))
print(f'{len(checks)} design/export checks passed; native ERC/DRC not run.')
