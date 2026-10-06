"""Human-readable manufacturing/learning draft; never a fabrication release."""
from pathlib import Path
from collections import Counter, defaultdict
import csv, json, math, re, shutil, zipfile
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape, A3
from pypdf import PdfReader
from power_budget import calculate


def clean(s):
    return str(s).replace('\u03a9', 'ohm').replace('\u00b5', 'u').replace('\u2013', '-').replace('\u2014', '-').replace('\u00d7', 'x').replace('\u2265', '>=').replace('\u2264', '<=').replace('\u00b0', ' deg ').encode('ascii', 'replace').decode()


def build_review_outputs(root, out, cad, legacy, pdf, project, raw, parts, nets, sheets, aliases):
    byref = {p['ref']: p for p in parts}

    def dnp(p):
        return 'DNP' in p['value'].upper()

    def status(p):
        if dnp(p):
            return 'DNP - decision pending; do not buy for normal assembly'
        if p['ref'] in {'SW1', 'J3'}:
            return 'HOLD - exact MPN and footprint pending'
        if p['ref'].startswith(('R', 'C')):
            return 'HOLD - electrical specification selected; qualify exact MPN'
        return 'Selected design candidate; footprint and release review pending'

    def owner(p):
        if dnp(p):
            return 'Do not populate'
        if p['ref'] in {'J7', 'J8', 'J9'}:
            return 'Through-hole hand option after practice; factory also possible'
        return 'Factory reflow recommended'

    def mpn(p):
        if p['ref'].startswith(('R', 'C')) or p['ref'] in {'SW1', 'J3'}:
            return 'Not yet qualified'
        return p['value']

    bom_headers = ['Reference', 'Qty per device', 'Part or electrical specification', 'Manufacturer part candidate', 'Package', 'Assembly responsibility', 'Purchase status', 'Notes', 'Primary source']
    with (out/'bill-of-materials.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(bom_headers)
        for p in parts:
            writer.writerow([p['ref'], 0 if dnp(p) else 1, p['value'], mpn(p), p['package'], owner(p), status(p), p['note'], p.get('source', '')])

    grouped = defaultdict(list)
    for p in parts:
        grouped[(p['value'], p['package'], status(p), owner(p))].append(p)
    shopping = []
    with (out/'shopping-list.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(['References', 'Qty fitted per device', 'Qty fitted for two prototypes', 'Part or specification', 'Package', 'Assembly responsibility', 'Purchase status', 'Spare or attrition policy', 'Primary source'])
        for (value, package, state, assembly), group in grouped.items():
            count = sum(not dnp(p) for p in group)
            row = [', '.join(p['ref'] for p in group), count, count*2, value, package, assembly, state, 'Agree factory setup extras; these columns are fitted quantities only', group[0].get('source', '')]
            writer.writerow(row)
            shopping.append(row)

    # Narrow checks that can honestly run without a installed CAD application.
    checks = []
    def require(test, description):
        if not test:
            raise AssertionError(description)
        checks.append(description)

    require(len(byref) == len(parts), 'Unique component references across all domains')
    for p in parts:
        require(len({v['number'] for v in p['pins']}) == len(p['pins']), 'Unique physical pins: '+p['ref'])
        require(all(v['net'] is None or isinstance(v['net'], str) and v['net'] for v in p['pins']), 'Valid net labels: '+p['ref'])

    def net(ref, number):
        return next(v['net'] for v in byref[ref]['pins'] if v['number'] == str(number))

    require([net('U1', n) for n in ['4', '5', '6', '35']] == ['AUD_BCLK', 'AUD_FSYNC', 'AUD_SDOUT', 'ADC_SHDN_N'], 'Controller TDM timing/data/shutdown pin mapping')
    require(all(net('U1', n) is None for n in ['28', '29', '30']), 'N16R8 PSRAM pins remain reserved')
    require(all(p['ref'] not in {'J4', 'R205', 'R206'} for p in parts), 'Old external PDM accessory header removed')
    require([net('U23', n) for n in ['14', '17', '18']] == ['ADC_SHDN_N', 'I2C_SCL', 'I2C_SDA'], 'ADC shutdown and I2C mappings')
    require(net('R221', '1') == net('U1', '4') and net('R221', '2') == net('U23', '22'), 'ESP32 bit clock passes through R221 to ADC')
    require(net('R222', '1') == net('U1', '5') and net('R222', '2') == net('U23', '23'), 'ESP32 frame clock passes through R222 to ADC')
    require(net('R223', '1') == net('U23', '21') and net('R223', '2') == net('U1', '6'), 'ADC data passes through R223 to ESP32')
    require(net('U23', '15') == 'GND' and net('U23', '16') == 'GND', 'ADC I2C address straps select 0x4C')
    require(all(net(j, '1') == 'GND' and net(j, '3') is None for j in ['J8', 'J9']), 'SJ1-3533NG sleeves grounded; unused ring pads NC')
    require(net('J8', '2') != net('J9', '2'), 'External microphone tips remain independent')
    require(net('C233', '2') == net('U23', '6') and net('C238', '2') == net('U23', '8'), 'MIC A/B AC-coupled into ADC channels 1/2')
    require(net('C234', '2') == net('U23', '7') and net('C239', '2') == net('U23', '9'), 'ADC analog return inputs AC-coupled, not shorted to GND')
    require(net('U23', '10') == net('R201', '2') == net('R202', '2'), 'Both PDM data edges reach ADC GPI3')
    require(net('U23', '11') == net('U24', '2') and net('U24', '4') == net('R203', '1'), 'ADC PDM clock uses U24 buffer and R203 series termination')
    require(net('U23', '2') not in {'3V3_SYS', '3V3', 'GND'} and net('U23', '24') not in {'3V3_SYS', '3V3', 'GND'}, 'Internal ADC regulator outputs do not short to 3.3 V or GND')
    require(net('U20', '4') == 'GND' and net('U21', '4') != 'GND', 'Built-in digital mics use opposite L/R edge selection')
    require(net('J2', '1') == 'BAT_PACK_P' and net('J2', '2') == 'GND', 'Battery connector polarity explicit')
    require(net('J5', '1') != 'GND' and net('J5', '2') != 'GND', 'Both speaker outputs are driven, neither grounded')
    require(sum(p['ref'].startswith('SW') for p in parts) == 7, 'Five user controls plus BOOT and RESET')
    for path in cad.glob('*.kicad_sch'):
        stripped = re.sub(r'"(?:\\.|[^"\\])*"', '""', path.read_text(encoding='utf-8'))
        depth = 0
        for ch in stripped:
            depth += (ch == '(') - (ch == ')')
            require(depth >= 0, 'Schematic syntax nesting: '+path.name) if depth < 0 else None
        require(depth == 0, 'Balanced generated schematic syntax: '+path.name)

    # Complete connector tables are also available separately, without PDF zoom.
    with (out/'connector-pinout.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(['Connector', 'Selected part', 'Physical contact', 'Contact name', 'Net', 'Assembly note'])
        for p in parts:
            if p['ref'].startswith('J'):
                for pin in p['pins']:
                    writer.writerow([p['ref'], p['value'], pin['number'], pin['name'], pin['net'] or 'NC', p['note']])

    W, H = landscape(A3)
    MM = 72/25.4
    c = canvas.Canvas(str(pdf), pagesize=(W, H))
    c.setTitle('Quipus Rev B - schematic, components and assembly guide')
    c.setAuthor('Quipus engineering draft')
    GREEN, DARK, GREY, LIGHT, AMBER = '#135F4B', '#18352F', '#556961', '#EFF5F2', '#956127'
    page = 0
    index = []

    def text(x, y, s, size=12, color=DARK, bold=False):
        c.setFillColor(HexColor(color))
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
        c.drawString(x, y, clean(s))

    def lines(s, width, size=12, bold=False):
        font = 'Helvetica-Bold' if bold else 'Helvetica'
        output = []
        for para in clean(s).split('\n'):
            line = ''
            for word in para.split():
                trial = (line+' '+word).strip()
                if stringWidth(trial, font, size) > width and line:
                    output.append(line)
                    line = word
                else:
                    line = trial
            output.append(line)
        return output

    def wrap(x, y, s, width, size=12, leading=18, color=DARK, bold=False):
        for line in lines(s, width, size, bold):
            text(x, y, line, size, color, bold)
            y -= leading
        return y

    def begin(title, sub=''):
        nonlocal page
        page += 1
        index.append((page, title))
        c.bookmarkPage(str(page))
        c.addOutlineEntry(title, str(page), level=0)
        text(38, H-31, 'QUIPUS  /  REV B  /  ENGINEERING + ASSEMBLY', 11, GREEN, True)
        text(38, H-66, title, 26, DARK, True)
        wrap(38, H-89, sub, W-76, 11, 14, GREY)
        c.setStrokeColor(HexColor('#CBDBD2'))
        c.line(38, 38, W-38, 38)
        text(38, 22, 'B1 REVIEW DRAFT - NOT FOR FABRICATION  |  2 October 2026  |  voltages are DC unless stated', 9, GREY)
        c.setFillColor(HexColor(GREY))
        c.setFont('Helvetica', 9)
        c.drawRightString(W-38, 22, str(page))

    def end():
        c.showPage()

    def box(x, y, w, h, title, body='', color=LIGHT, size=12):
        c.setFillColor(HexColor(color))
        c.setStrokeColor(HexColor('#BDD2C7'))
        c.roundRect(x, y, w, h, 9, stroke=1, fill=1)
        wrap(x+14, y+h-24, title, w-28, 13, 17, GREEN, True)
        if body:
            wrap(x+14, y+h-52, body, w-28, size, 17)

    def arrow(x1, y1, x2, y2, label='', label_dx=0, label_dy=10):
        c.setStrokeColor(HexColor(GREEN))
        c.setFillColor(HexColor(GREEN))
        c.setLineWidth(1.5)
        c.line(x1, y1, x2, y2)
        angle = math.atan2(y2-y1, x2-x1)
        path = c.beginPath()
        path.moveTo(x2, y2)
        for offset in [-0.48, 0.48]:
            path.lineTo(x2-8*math.cos(angle+offset), y2-8*math.sin(angle+offset))
        path.close()
        c.drawPath(path, stroke=0, fill=1)
        if label:
            text((x1+x2)/2+label_dx, (y1+y2)/2+label_dy, label, 10, GREY)

    def table(x, y, widths, headers, rows, size=11, leading=14):
        header_h = max(len(lines(h, w-16, size, True)) for h, w in zip(headers, widths))*leading+16
        c.setFillColor(HexColor(GREEN))
        c.rect(x, y-header_h, sum(widths), header_h, fill=1, stroke=0)
        xx = x
        for h, w in zip(headers, widths):
            wrap(xx+8, y-14, h, w-16, size, leading, '#FFFFFF', True)
            xx += w
        y -= header_h
        for i, row in enumerate(rows):
            cell_lines = [lines(v, w-16, size) for v, w in zip(row, widths)]
            height = max(len(v) for v in cell_lines)*leading+14
            if y-height < 58:
                raise RuntimeError('PDF table overflow: '+str(row))
            c.setFillColor(HexColor(LIGHT if i % 2 == 0 else '#FFFFFF'))
            c.rect(x, y-height, sum(widths), height, fill=1, stroke=0)
            xx = x
            for value, w in zip(row, widths):
                wrap(xx+8, y-14, value, w-16, size, leading)
                xx += w
            y -= height
        return y

    def paragraphs(items, x=38, y=None, width=None, size=13, gap=22):
        y = H-136 if y is None else y
        width = W-76 if width is None else width
        for title, body in items:
            text(x, y, title, size+1, GREEN, True)
            y = wrap(x, y-25, body, width, size, size*1.42)-gap
            if y < 62:
                raise RuntimeError('PDF paragraph overflow: '+title)
        return y

    begin('Your first custom Quipus board', 'A readable circuit draft, complete component inventory and practical route from an empty PCB to a tested recorder.')
    box(38, 552, 350, 140, '1  Fabricate the PCB', 'Copper tracks, plated holes, solder mask and reference labels. No chips, battery or firmware are included.')
    box(420, 552, 350, 140, '2  Populate the board', 'Buy the exact BOM parts, or have the assembler procure them. Factory reflow handles the fine-pitch core.')
    box(802, 552, 350, 140, '3  Assemble and test', 'You build microphone leads and pucks, connect peripherals, load the new board firmware and test one block at a time.')
    arrow(388, 622, 420, 622)
    arrow(770, 622, 802, 622)
    box(38, 365, 1114, 142, 'Agreed hardware', 'ESP32-S3 | 2 built-in PDM mics + 2 wired analog mics | 1 speaker | compact SPI screen | 2000 mAh protected 1S battery | USB-C charging/service | microSD | 5 user buttons + BOOT/RESET', size=14)
    paragraphs([
        ('What this package supplies', 'Editable KiCad pin/net schematics, printable diagrams, main-board BOM, grouped purchase quantities, off-board microphone/tool lists and the assembly/change guides.'),
        ('What still separates this draft from a board order', 'Exact footprints, battery/NTC approval, final passive part numbers, PCB routing, native ERC/DRC, enclosure fit and first-article electrical measurements. No fabrication files are included.'),
        ('Best first build', 'Use selective factory assembly for the main SMD electronics. Learn soldering on practice boards and the two external microphone pucks, then assemble and diagnose your own recorder.')
    ], y=319, size=13, gap=18)
    end()

    begin('Four microphones, one synchronized capture path', 'Near microphones stay on the device. Wired pucks extend placement; each source keeps its own channel.')
    box(38, 612, 275, 82, 'U20 + U21  Built-in mics', 'IM69D128S / opposite PDM edges')
    box(38, 468, 275, 104, 'J8 + J9  Wired mic inputs', 'Two independent mono electret pucks. 3.5 mm sockets with bias, coupling and protection.')
    box(382, 492, 265, 170, 'U23  Audio frontend', 'TLV320ADC5140\n2 digital + 2 analog inputs\nIntegrated microphone gain\nI2C configuration / TDM output')
    box(734, 492, 310, 170, 'U1  ESP32-S3', 'I2S0 MASTER RX supplies BCLK/FSYNC; ADC follows.\nSD writes + offline meeting queue\nWi-Fi uploads when available')
    arrow(313, 649, 382, 615, 'PDM', -8)
    arrow(313, 520, 382, 534, 'analog', -12)
    arrow(647, 598, 734, 598, '4 slots', -20)
    arrow(734, 555, 647, 555, 'timing', -18)
    box(382, 283, 265, 112, 'J6  Local storage', 'Full four-channel source WAV. Keep until complete upload is acknowledged.')
    box(734, 283, 310, 112, 'U22 + J5  Voice speaker', 'MAX98357A on I2S1\nSeparate from capture\nTwo driven speaker terminals')
    arrow(830, 492, 647, 395, 'SD + file manifest', 3, -2)
    arrow(915, 492, 915, 395, 'I2S1', 10)
    wrap(38, 209, 'The ADC is a hardware choice, not a speaker-identification algorithm. Preserve the source channels for later alignment, diarization and transcription. Two mic pucks are not combined with a splitter. USB-C is charging and USB device/service, not a general USB microphone host in Rev B.', 1114, 14, 21)
    end()

    begin('Changes to the PCB and enclosure', 'Placement is conceptual. No pad coordinates, final outline or routing can be inferred from this drawing.')
    bx, by, bw, bh = 100, 115, 330, 585
    c.setStrokeColor(HexColor(GREEN)); c.setFillColor(HexColor('#F4F8F6'))
    c.roundRect(bx, by, bw, bh, 24, fill=1, stroke=1)
    box(165, 629, 135, 42, 'TOP MIC', size=10)
    box(120, 549, 90, 48, 'POWER')
    box(220, 549, 90, 48, 'START')
    box(320, 549, 90, 48, 'STOP')
    box(157, 375, 214, 134, 'SMALL SCREEN', 'SPI module / LVGL')
    box(157, 307, 102, 48, 'VOL -')
    box(269, 307, 102, 48, 'VOL +')
    box(175, 226, 175, 49, 'SPEAKER GRILLE')
    box(165, 160, 135, 42, 'BOTTOM MIC')
    box(41, 394, 57, 93, 'MIC A')
    box(432, 394, 57, 93, 'MIC B')
    text(112, 125, 'USB-C bottom edge', 10, GREY)
    text(368, 174, 'SD edge', 10, GREY)
    paragraphs([
        ('Audio change', 'Add U23 ADC and U24 PDM clock buffer. Replace the old short-wire PDM accessory header with J8/J9 analog mic sockets. Keep the two built-in mics and speaker amp.'),
        ('Controls', 'Five everyday controls: Power, Start/Enter, Stop/Back, Volume up/down. Two recessed service controls: BOOT and RESET. Current B3U switches are SMD; alternative hand-solder buttons require new footprints.'),
        ('Acoustics and layout', 'Bottom-port MEMS sensors need aligned unplated PCB holes and a short front acoustic passage. Separate the speaker chamber, analog inputs and switching-power loops. Preserve the module antenna keepout.'),
        ('Mechanics', 'One mic socket on each side, USB-C accessible below, and clear microSD ejection space. Battery dimensions, jack bodies, plugs, cable bends and button travel must fit a new 3D assembly.'),
        ('Neat engineering structure', 'Use functional schematic sheets, labeled nets and connector pin numbers. Use a reviewed four-layer stackup with a continuous ground reference, test pads and clear polarity/channel silkscreen.')
    ], x=538, width=610, size=13, gap=21)
    end()

    begin('Core parts to populate on the main PCB', 'These are selected candidates. The CSV includes every resistor, capacitor, switch and connector, with purchase holds.')
    core_rows = [
        ['U1', '1', 'ESP32-S3-WROOM-1-N16R8', 'Processor, Wi-Fi, 16 MB flash / 8 MB PSRAM'],
        ['U20 / U21', '2', 'IM69D128SV01XTMA1', 'Built-in digital MEMS microphones; factory reflow'],
        ['U23', '1', 'TLV320ADC5140IRTWR', 'Four-source audio frontend; WQFN / exposed pad'],
        ['U24', '1', byref['U24']['value'], 'PDM clock edge buffer; timing needs bench validation'],
        ['U22', '1', 'MAX98357AETE+', 'Digital speaker amplifier; speaker itself is off-board'],
        ['U2 / U3', '1 each', 'BQ24074RGTR / TUSB320LAIRWBR', 'USB power-path charging and Type-C current entitlement'],
        ['U9 / U10', '1 each', 'LTC2951ITS8-1#TRPBF / TPS22918DBVR', 'Power-button controller and main load switch'],
        ['U11 / L1', '1 each', 'TPS63802DLAR / XFL4015-471ME', '3.3 V buck-boost regulator and 0.47 uH inductor'],
        ['U12 / R19', '1 each', 'BQ27441DRZR-G1A / 10 mOhm shunt', 'Battery measurement; actual cell profile must be configured'],
        ['U30 / U31', '1 each', 'RV-3028-C7-TA-QC / PCA9536DR', 'Timekeeping and control input expander'],
        ['U4-U8', '5', 'TLV75533PDBVR + LVC logic (see BOM)', 'Always-on supply and safe charging control logic'],
        ['U13 / U34 / U35 / D1', '4', 'USB protection / TS3USB221A / ESD', 'USB protection and off-state isolation; see exact BOM variants']
    ]
    table(38, H-128, [135, 75, 410, 494], ['Reference', 'Quantity', 'Manufacturer part candidate', 'Purpose / assembly'], core_rows, size=12, leading=16)
    end()

    begin('Connectors, controls and parts outside the PCB', 'Do not buy by appearance. The part package and connector contact order determine whether it fits.')
    rows = [
        ['J1', '1', 'GCT USB4105-GF-A', 'USB-C charge + native USB; factory assembly'],
        ['J2', '1', 'JST S2B-PH-SM4-TB(LF)(SN)', 'Battery PH 2 mm / SMD; check pin 1 positive'],
        ['J3', '1', '3-position JST SH NTC connector - HOLD', 'Exact MPN/footprint and battery temperature window pending'],
        ['J5', '1', byref['J5']['value'], 'Speaker connector; SMD, not a breadboard part'],
        ['J6', '1', 'Hirose DM3AT-SF-PEJM5', 'Push-push microSD socket; factory soldering'],
        ['J7', '1', 'JST B8B-PH-K-S(LF)(SN)', '8-position display header; through-hole hand option'],
        ['J8 / J9', '2', 'Same Sky SJ1-3533NG', '3.5 mm TRS through-hole mic sockets; exact pad map specified'],
        ['SW1', '1', 'Momentary power switch - HOLD', 'Exact switch and footprint need release'],
        ['SW300-SW305', '6', 'Omron B3U-1000P', 'SMD: BOOT, Start, Stop, Up, Down, RESET'],
        ['Off-board', '2', 'PUI AOM-5024L-HD-R', 'External electret capsules, shielded leads and 3.5 mm plugs'],
        ['Off-board', '1 each', 'Protected 1S 2000 mAh LiPo + cell-mounted NTC', 'Exact pack, dimensions and charging window are HOLD'],
        ['Off-board', '1 each', 'Waveshare 1.3-inch display / 8 ohm 2 W speaker / SD', 'Verify display revision; exact speaker HOLD; genuine test card']
    ]
    table(38, H-128, [145, 70, 425, 474], ['Reference', 'Qty', 'Part / requirement', 'Fit and purchase notes'], rows, 11.5, 15)
    end()

    begin('Voltage domains and charging current', 'Raw battery and USB power never connect directly to 3.3 V GPIO, microphone, SD or display rails.')
    box(38, 576, 222, 105, 'USB-C + F1', '5 V input\n2 A candidate fuse\nType-C/USB entitlement')
    box(345, 561, 275, 135, 'U2  BQ24074 power path', '445 mA nominal charge\n394.6-492.4 mA setting range\nSYS_RAW: 4.4 V nominal on USB')
    box(38, 402, 222, 115, 'Protected battery + R19', '1S 3.7 V nominal\n4.2 V maximum charge\n2000 mAh / 7.4 Wh nominal')
    arrow(260, 628, 345, 628)
    arrow(260, 459, 345, 580, 'BAT_P', -15, -15)
    box(710, 576, 380, 105, 'Always-on branch', 'U4 / USB-C logic / U9 power button\nGauge + RTC backup stay alive while main electronics are off.')
    arrow(620, 628, 710, 628)
    box(345, 347, 275, 135, 'U10  Main load switch', 'U9 responds to Power\nFirmware closes SD files, then releases hold\n~6.54 s forced-off grace after interrupt')
    arrow(483, 561, 483, 482, 'SYS_RAW', 10)
    box(710, 397, 380, 85, 'U11  TPS63802 + L1', '3V3_SYS: 3.3077 V nominal\n3.220-3.398 V calculation before transients')
    arrow(620, 432, 710, 432, 'MAIN_RAW', -8, 13)
    box(710, 247, 380, 90, 'Speaker amplifier U22', 'MAIN_RAW follows battery or USB power path.\nCurrent bursts and thermal margin require measurement.')
    arrow(620, 393, 710, 292, '', 0)
    wrap(38, 277, 'Input limit is conservative USB100 by default, USB500 only after valid host entitlement, or nominal 1.298 A when the Type-C source advertises at least 1.5 A. Firmware must implement detach/reset/suspend policy.', 592, 13, 20)
    wrap(38, 156, 'Open approval: the proposed charger/thermistor combination has a nominal 0-50 deg C window. A battery rated for 0-45 deg C charging needs a tighter hardware window and tolerance review. Charger dissipation can be about 0.8 W at 5 V -> 3.2 V / 445 mA, before other heat.', 1114, 12, 18, AMBER)
    end()

    connectors = [p for p in parts if p['ref'].startswith('J')]
    for start in range(0, len(connectors), 3):
        begin('Connector contact definitions', 'Physical contacts from the exact selected part. Matching net names connect across all sheets; NC is left unconnected.')
        y = H-131
        for p in connectors[start:start+3]:
            text(38, y, p['ref']+'  /  '+p['value'], 14, GREEN, True); y -= 20
            desc = ' | '.join(pin['number']+': '+pin['name']+' -> '+(pin['net'] or 'NC') for pin in p['pins'])
            y = wrap(38, y, desc, 1114, 12, 17)-8
            y = wrap(38, y, p['note'], 1114, 11, 16, GREY)-28
        end()

    begin('Audio supply, gain and timing review', 'Nominal values and planning allowances are distinguished from absolute limits and measured behavior.')
    table(38, H-129, [271, 258, 585], ['Audio node / function', 'Voltage or allocation', 'Engineering requirement'], [
        ['U23 AVDD / pin 1', 'Filtered 3.3 V; permitted 3.0-3.6 V', 'FB220 supply bead + local bypass. Its 220 ohm high-frequency impedance is not its DC resistance.'],
        ['U23 IOVDD / pin 19', '3.3 V; permitted 3.0-3.6 V', 'Matches ESP32 digital levels. Bypass close to the ADC pin.'],
        ['AREG pin 2 / DREG pin 24', 'Internal 1.8 V / 1.5 V outputs', 'Their dedicated capacitors return to GND. Never tie these regulator outputs to 3.3 V.'],
        ['VREF pin 3 / MICBIAS pin 5', '~2.75 V reference / configured 3.014 V bias', 'Reference settling and effective capacitor value need verification. MICBIAS published limit is 20 mA.'],
        ['U20 / U21 / U24 supply', 'MIC_3V3, nominal 3.3 V', 'Two MEMS sensors plus buffer; local bypass; load/edge measurements required.'],
        ['Capture subsystem allowance', '37 mA x 3.3 V = 122.1 mW', 'Planning: ADC 30 mA + two mics 2 mA + buffer 2 mA + bias allowance 3 mA. Not measured or a guaranteed maximum.'],
        ['Gain and input range', 'Start at 0 dB / 20 kOhm; up to 42 dB PGA', 'ADC single-ended AC full scale is 1 Vrms at its specified conditions. Increase gain only after level/noise/clipping tests.']
    ], 12, 16)
    paragraphs([
        ('PDM timing is not closed yet', 'The sensor requires <=13 ns clock edges while the ADC allows up to 18 ns at its PDM output. U24 is an edge-restoring candidate; measure loaded duty cycle, edge, propagation and data setup/hold. Begin at 1.536 MHz if needed and qualify 3.072 MHz separately.'),
        ('External-input protection is a release hold', 'The candidate socket TVS pulse clamp exceeds the ADC absolute input maximum. The full series/coupling/protection network needs transient qualification or redesign before manufacturing release; a TVS symbol alone is not proof of protection.'),
        ('Whole-device power still needs measurement', 'The inherited 0.85 A 3.3 V peak envelope was not requalified for Rev B. New audio load, Wi-Fi, SD, display and speaker bursts must be measured together, including battery-path drop, switch margin and enclosure heating.')
    ], y=324, size=12, gap=17)
    end()

    begin('Wired microphone puck: how it is connected', 'One capsule per socket. This is our defined mono plug-in-power accessory, not universal compatibility with every headset.')
    box(38, 507, 288, 172, 'Inside each mic puck', 'PUI AOM-5024L-HD-R\nOmnidirectional electret condenser\nPositive pad -> signal conductor\nNegative pad -> shield / return\nOpen inlet + mesh + soft support')
    box(399, 507, 288, 172, 'Cable and plug', 'One-metre flexible shielded lead\nTRS tip = audio + bias\nSleeve = return\nRing = unused\nStrain relief carries cable force')
    box(760, 507, 392, 172, 'At the PCB socket', 'SJ1-3533NG pad 2 = tip\nPad 1 = sleeve / GND\nPad 3 = ring / NC\nDedicated bias, ESD and input network\nADC analog channel 1 or 2')
    arrow(326, 594, 399, 594)
    arrow(687, 594, 760, 594)
    paragraphs([
        ('Bias and gain', 'The board supplies approximately 3.014 V through each 2.2 kOhm bias resistor. The capsule has about 0.5 mA datasheet consumption at its stated test condition; the resistor drop is about 1.1 V. Exact operating current and signal level must be measured. The ADC provides input gain, so a separate puck preamplifier is not proposed for the first one-metre test.'),
        ('Clear audio is a system result', 'The capsule datasheet lists -24 +/-3 dBV/Pa sensitivity and 80 dB A-weighted SNR under its test conditions. These are not a guaranteed room pickup distance. Speech level, reverberation, placement, cable interference and ADC clipping still determine the recording.'),
        ('What you solder', 'Practice first. The published capsule drawing does not label the physical positive/negative pads: obtain manufacturer-confirmed polarity before soldering or applying power. Then tin the leads, briefly solder terminals and plug, and fit heat shrink/strain relief. PUI specifies 360 +/-10 deg C, <=2 s per terminal and an iron below 90 W. Never block the acoustic inlet.')
    ], y=445, size=13, gap=25)
    end()

    begin('Analog input circuit and digital channel map', 'Functional input schematic. Exact resistor/capacitor designators, all chip pads and their net names follow in the circuit appendix.')
    for n, ref in enumerate(['J8', 'J9']):
        yy = 582-n*198
        tipnet = net(ref, '2')
        # Locate actual bias and coupling elements through the machine-readable netlist.
        bias = next(p for p in parts if p['ref'].startswith('R') and len(p['pins']) == 2 and tipnet in [v['net'] for v in p['pins']] and '2.2' in p['value'])
        signal_series = next(p for p in parts if p['ref'].startswith('R') and len(p['pins']) == 2 and tipnet in [v['net'] for v in p['pins']] and p['ref'] != bias['ref'])
        afternet = next(v['net'] for v in signal_series['pins'] if v['net'] != tipnet)
        coupling = next(p for p in parts if p['ref'].startswith('C') and len(p['pins']) == 2 and afternet in [v['net'] for v in p['pins']] and all(v['net'] != 'GND' for v in p['pins']))
        inputnet = next(v['net'] for v in coupling['pins'] if v['net'] != afternet)
        adcpin = next(v for v in byref['U23']['pins'] if v['net'] == inputnet)
        text(38, yy+32, ref+' / MIC '+('A' if n == 0 else 'B'), 14, GREEN, True)
        text(38, yy+10, 'pad 2 / tip', 11)
        c.setStrokeColor(HexColor(GREEN)); c.setLineWidth(1.5)
        c.line(155, yy, 329, yy)
        c.rect(329, yy-7, 66, 14, fill=0, stroke=1)
        c.line(395, yy, 505, yy)
        c.line(505, yy-14, 505, yy+14); c.line(515, yy-14, 515, yy+14)
        c.line(515, yy, 674, yy)
        box(674, yy-45, 478, 102, 'U23  '+adcpin['name']+' / pad '+adcpin['number'], 'AC-coupled signal. Corresponding INxM returns through its own coupling capacitor; it is not shorted directly to GND.')
        text(315, yy+26, signal_series['ref']+' / '+signal_series['value'], 11)
        text(451, yy-36, coupling['ref']+' / '+coupling['value'], 10)
        c.line(239, yy, 239, yy+44)
        c.rect(232, yy+44, 14, 48, fill=0, stroke=1)
        c.line(239, yy+92, 239, yy+117)
        text(147, yy+125, 'MICBIAS ~3.014 V', 11, GREEN)
        text(261, yy+63, bias['ref']+' / 2.2 kOhm', 11)
        text(38, yy-27, 'pad 1 -> GND; pad 3 NC', 10, GREY)
        text(159, yy-27, tipnet, 10, GREY)
    table(38, 326, [280, 265, 275, 294], ['Source', 'ADC input / path', 'ESP32 / timing', 'Storage contract'], [
        ['Top + bottom digital MEMS', 'ADC channels 3/4; PDM data pair and buffered clock', 'GPIO4 BCLK output; GPIO5 FSYNC output', 'Two separate built-in source channels'],
        ['Analog MIC A + MIC B', 'Independent analog channels 1/2; bias + AC input', 'GPIO6 TDM input; GPIO42 ADC shutdown', 'Two separate external source channels'],
        ['Timing at 16 kHz', 'ADC slave PLL referenced to BCLK', '4 slots x 32 bits x 16000 = 2.048 MHz', 'Firmware must verify actual slot order before WAV mapping']
    ], 12, 16)
    end()

    begin('Order and assembly: the whole process', 'Do these stages in order. First learn on inexpensive parts; an empty custom PCB is not a soldering practice kit.')
    paragraphs([
        ('1  Lock the design', 'Approve the exact battery/NTC, speaker, power switch, connectors and passive MPNs. Review the schematic in CAD, assign exact footprints, finish placement/routing, and pass ERC/DRC plus mechanical/thermal review.'),
        ('2  Get two assembly quotes', 'Send reviewed Gerbers/drill files, stackup, BOM, CPL/pick-and-place and assembly drawings. Ask for two populated prototypes and a spare bare PCB, selective assembly scope, substitutions, inspection and extra parts for attrition. PCBWay or a Malaysian assembly shop can quote this; a bare-board order alone supplies no components.'),
        ('3  Obtain off-board parts and tools', 'The main-board shopping CSV is separate from battery, screen, speaker, SD and the two microphone accessories. Buy a temperature-controlled iron, solder/flux, stand, magnifier, multimeter, wire tools, heat shrink and a practice kit. Borrow a current-limited supply and scope for first-board checks.'),
        ('4  Let the factory assemble the fine-pitch core', 'Factory-populate the ADC, MEMS mics, hidden-pad power chips, USB-C and SD socket, preferably all SMD parts. You can manually install the through-hole mic sockets/display header if explicitly left unassembled and after practice.'),
        ('5  Build the pucks and connect harnesses', 'Solder one capsule/plug cable, verify continuity and shorts, test it, then make the second. Use precrimped JST harnesses and meter-check pin order before attaching screen, speaker or battery. Mount components without blocking acoustic ports.'),
        ('6  Bring up and validate', 'Inspect unpowered, test power from a current-limited supply, then boot/USB, I2C, controls, display, SD, each microphone and speaker. Fit the approved battery last. Load a Rev B firmware profile and test complete WAV retention/upload before daily-use trials.')
    ], size=13, gap=21)
    end()

    begin('First power and first recording checks', 'Record measurements per serial-numbered board. A structural netlist check is not evidence of safe operation.')
    table(38, H-129, [185, 430, 499], ['Stage', 'What to do', 'What to verify'], [
        ['Unpowered', 'Unplug battery/USB and inspect under magnification; meter-check polarity and stabilized rail resistance.', 'No solder bridges, blocked mic ports, swapped harnesses or hard shorts. Capacitors may cause a brief continuity beep.'],
        ['Power only', 'Use a reviewed J2 harness and current-limited 3.7 V bench supply, no LiPo/USB; hold processor reset and remove peripherals.', 'BAT_PACK_P/BAT_P, SYS_RAW, 3V3_AON, MAIN_RAW when switched, and regulated 3.3 V. Scope ripple/overshoot.'],
        ['Processor + USB + I2C', 'Use minimal custom-board diagnostics; verify BOOT/RESET, USB orientation/current policy and peripheral addresses.', 'RTC 0x52, gauge 0x55, expander 0x41, ADC 0x4C. USB current entitlement is implemented, not assumed.'],
        ['Screen / controls / SD', 'Attach one verified load at a time while powered off; write/read a card test file before audio.', 'Five user controls plus two service controls. Quipus J7 to display-module J2 signal order; SD detection, write integrity and unmount.'],
        ['Audio', 'Built-in mics separately, then MIC A, then MIC B, then all four; speaker at low level.', 'Actual channel identity, clipping/noise, PLL lock and PDM edges. Never ground a speaker output or scope clip.'],
        ['Daily-use behavior', 'Capture/upload with Wi-Fi and playback variations; test Stop, reboot, queue recovery and loss of network.', 'Full source audio duration and all channels, local retention until confirmed upload, responsive buttons and measured battery/thermal behavior.']
    ], 12, 16)
    wrap(38, 121, 'Battery charging begins only after exact cell/NTC approval and bench checks. A temporary 50 mA diagnostic limit with the MCU held in reset is not a usable operating current; do not raise it blindly to hide a fault.', 1114, 12, 18, AMBER)
    end()

    budget = calculate()
    begin('Battery, file size and latency: numbers to test', 'Transparent calculations. No week-long runtime, far-field quality or upload-speed promise is implied.')
    table(38, H-127, [352, 330, 432], ['Quantity', 'Calculation / value', 'Meaning'], [
        ['Nominal battery energy', '2.0 Ah x 3.7 V = 7.4 Wh', 'Usable energy depends on load, cell condition, cutoff and losses.'],
        ['Charging', '2000 / 445 = 4.49 h ideal', 'Lower bound only; CV tail, system load, source limit and thermal regulation extend this.'],
        ['Four-channel PCM16', '16000 x 4 x 2 = 128000 bytes/s', '7.68 MB/min; 460.8 MB/hour; 2.7648 GB for six hours.'],
        ['I2S DMA before PCM16 conversion', '16000 x 4 x 4 = 256000 bytes/s', '32-bit transport containers; bounded DMA buffers, not whole meetings in RAM.'],
        ['Single classic WAV/FAT32 file', '~4 GiB / 128000 = 9.32 h', 'Segment before the file limit and preserve a meeting manifest. Filesystem choice alone does not remove RIFF limits.'],
        ['35-42 h/week recording target', '1600 mAh usable / 35-42 h = 46-38 mA average', 'A stringent battery-side total including everything; not supported by a measured Quipus result.']
    ], 12, 16)
    y = 333
    rows = [[str(v['battery_ma'])+' mA', str(v['recording_hours'])+' hours', str(v['six_hour_days'])+' six-hour days'] for v in budget['runtime_scenarios']]
    table(38, y, [352, 330, 432], ['Assumed battery-side average', 'Runtime with 20% planning reserve', 'Recording days'], rows, 12, 16)
    wrap(38, 135, 'A one-metre analog cable adds only an estimated few nanoseconds of electrical propagation, negligible for speech. Acoustic placement, ADC filter delay, DMA, SD and cloud processing matter more. Analog and PDM paths share a sample rate but require measured delay alignment before phase-sensitive mixing.', 1114, 12, 18)
    end()

    begin('How to read the detailed schematic pages', 'A conventional signal flow is shown earlier. The following appendix gives every component and physical pad connection.')
    paragraphs([
        ('Reference labels', 'U = chip/module, R = resistor, C = capacitor, J = connector, L = inductor, D = protection device, SW = switch. Each reference appears exactly once in the editable schematic and BOM.'),
        ('Named nets', 'Every matching global name is the same electrical connection, even on another sheet. For example I2C_SDA connects the processor, RTC, gauge, control expander and ADC. GND is a common reference plane. NC is intentionally unconnected.'),
        ('Physical pins', 'Numbers identify the named manufacturer package contacts, not GPIO numbers or guessed community-library symbols. Follow the connector manufacturer drawing for its pad/contact mapping. Detailed pin-connections.csv is useful when checking a harness.'),
        ('DNP and holds', 'DNP means do not populate during the normal first build. Hold rows need an exact qualified MPN/footprint or electrical/mechanical approval. A draft candidate is not authorization to substitute a similar-looking chip.'),
        ('Validation actually performed', 'JSON parsing, unique references and physical pins, selected critical-net checks, source/export consistency and generated schematic syntax checks. Native KiCad/ERC and EasyEDA import have not been run here. Footprints, layout, DRC, electrical/thermal and acoustic tests remain required.'),
        ('CAD files', 'Open schematics/Quipus-B1.kicad_sch with its child sheets. Symbols are embedded draft pin boxes and footprints are deliberately unassigned. Legacy sources are provided for a CAD engineer to attempt conversion. This package does not update the saved EasyEDA board.')
    ], size=13, gap=20)
    end()

    # Pin boxes are scaled at A3; larger devices remain legible when zoomed/printed.
    for i, sheet in enumerate(sheets):
        label = re.sub(r'^\d+_', '', sheet['group']).replace('_', ' ')
        begin('Circuit %02d / %s' % (i+1, label), 'All physical pads shown. Global labels connect between pages. NC = intentionally unused. No production footprints assigned.')
        for v in sheet['placed']:
            p, x, y, h = v['part'], v['x'], v['y']+2, v['h']
            px, py = x*MM, H-y*MM
            c.setStrokeColor(HexColor(GREEN)); c.setFillColor(HexColor(LIGHT)); c.setLineWidth(.6)
            c.rect(px-19.05*MM, py-h*MM/2, 38.1*MM, h*MM, stroke=1, fill=1)
            text(px-19.05*MM, py+h*MM/2+15, p['ref'], 10, GREEN, True)
            value_size = min(8.1, 111/stringWidth(clean(p['value']), 'Helvetica', 1))
            text(px-19.05*MM, py+h*MM/2+4, p['value'], value_size, DARK)
            for n, pin in enumerate(p['pins']):
                yy = py+((len(p['pins'])-1)*1.27-n*2.54)*MM
                c.line(px-24.13*MM, yy, px-19.05*MM, yy)
                text(px-18.0*MM, yy-2, pin['name'], 6.4)
                text(px-23.8*MM, yy+2, pin['number'], 5.1, GREY)
                c.setFillColor(HexColor(GREEN)); c.setFont('Helvetica', 6.5)
                c.drawRightString(px-25.3*MM, yy-2, clean(pin['net'] or 'NC'))
        end()

    # Grouped BOM remains large enough to read at A3, splitting by actual height.
    pending = shopping[:]
    while pending:
        begin('Main-board shopping list / fitted quantities', 'Quantities are for one device and two prototypes. DNP = zero fitted. Factory setup/attrition extras are separate; all rows still require release review.')
        rows, used = [], 0
        widths = [159, 55, 60, 278, 258, 304]
        while pending:
            r = pending[0]
            cells = [r[0], str(r[1]), str(r[2]), r[3], r[4], r[6]]
            height = max(len(lines(v, w-16, 10)) for v, w in zip(cells, widths))*13+14
            if used+height > H-216:
                break
            rows.append(cells); used += height; pending.pop(0)
        table(38, H-131, widths, ['References', 'One', 'Two', 'Part / value / rating', 'Package', 'Selection status'], rows, 10, 13)
        end()

    sources = sorted({p.get('source', '') for p in parts if p.get('source', '').startswith('http')})
    sources.extend([
        'https://puiaudio.com/file/specs-AOM-5024L-HD-R.pdf',
        'https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/i2s.html',
        'https://www.pcbway.com/pcb-assembly.html',
        'https://www.silvtronics.com/',
        'https://files.waveshare.com/upload/0/0c/1.3inch_LCD_Module_Schematic.pdf'
    ])
    for start in range(0, len(sources), 18):
        begin('Primary references and release scope', 'Manufacturer datasheets control selected pins and limits. Source notes retain the calculations and assumptions.')
        y = H-134
        for n, source in enumerate(sources[start:start+18], start=start+1):
            y = wrap(38, y, '%02d  %s' % (n, source), 1114, 10, 14)-13
        end()

    c.save()
    reader = PdfReader(pdf)
    require(len(reader.pages) == page, 'Generated PDF page count verified')
    require(all(p.extract_text().strip() for p in reader.pages), 'All PDF pages contain readable text')

    copy_files = ['README.md', 'assembly-guide.md', 'pcb-change-list.md', 'learning-tools.csv', 'accessories.csv', 'power-design.md', 'audio-design.md', 'controller-design.md', 'audio-calculations.json', 'power-circuit.json', 'audio-circuit.json', 'controller-circuit.json', 'power_budget.py', 'build_package.py', 'review_outputs.py']
    for filename in copy_files:
        if (root/filename).exists():
            shutil.copy2(root/filename, out/filename)
    report = {
        'revision': 'B1 engineering review draft',
        'components_including_dnp': len(parts),
        'fitted_components': sum(not dnp(p) for p in parts),
        'grouped_bom_rows': len(shopping),
        'nets': len(nets), 'schematic_sheets': len(sheets), 'pdf_pages': page,
        'checks_passed': checks,
        'native_cad_open_and_erc': 'NOT RUN - CAD unavailable; syntax/net checks are narrower',
        'easyeda_import': 'NOT RUN; saved cloud project unchanged',
        'footprints': 'NOT ASSIGNED/RELEASED', 'pcb_routing': 'NOT PERFORMED', 'drc': 'NOT RUN',
        'fabrication_release': False, 'gerbers_included': False,
        'hardware_validation': 'NOT BUILT OR MEASURED',
        'firmware_support': 'New custom-board profile and four-channel backend handling still required',
        'single_contact_nets_for_review': {k: v for k, v in nets.items() if len(v) < 2},
        'pdf_visual_review': 'See visual-review.json after rendered-page inspection'
    }
    (out/'validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    (out/'document-index.csv').write_text('Page,Title\n'+'\n'.join(str(n)+','+json.dumps(title) for n, title in index), encoding='utf-8-sig')
    shutil.copy2(pdf, out/pdf.name)
    zpath = out.parent/'Quipus-B1-schematic-and-assembly-review.zip'
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.rglob('*')):
            if f.is_file():
                z.write(f, (Path(project)/f.relative_to(out)).as_posix())
    print(json.dumps({k: report[k] for k in ['components_including_dnp', 'fitted_components', 'grouped_bom_rows', 'nets', 'schematic_sheets', 'pdf_pages', 'fabrication_release']}, indent=2))
    print(str(pdf))
    print(str(zpath))
