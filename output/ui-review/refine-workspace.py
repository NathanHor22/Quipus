from pathlib import Path
import re

path = Path('components/workspace/Workspace.tsx')
source = path.read_text(encoding='utf-8-sig')
source = re.sub(r'import \{\n  ArrowRight,.*?\} from "lucide-react";', 'import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";', source, flags=re.S)
for name in ['ArrowRight', 'ArrowUpRight', 'CalendarDays', 'Check', 'CheckCheck', 'Clock3', 'Headphones', 'Home', 'LayoutGrid', 'List', 'LogIn', 'LogOut', 'MessageSquare', 'Radio', 'RotateCcw', 'Search', 'Settings2', 'ShieldCheck', 'Sparkles', 'Users']:
    source = re.sub(r'<' + name + r'\b[^>]*?/>', '{null}', source)
source = re.sub(r'<X\b[^>]*?/>', 'Close', source)
source = re.sub(r'<MoreHorizontal\b[^>]*?/>', 'Edit', source)
source = re.sub(r'<span className=\{styles.settingsIcon\}>\s*\{null\}\s*</span>', '', source)
source = source.replace(' : {null}}', ' : null}')
source = source.replace('{null}', '')
source = source.replace(' : }', ' : null}')
source = source.replace(' : (\n                                      \n                                    )}', ' : null}')
source = source.replace(') : (\n                                      \n                                    )}', ') : null}')
source = source.replace('"Back to calendar" : "Back to conversations"}', '"Back to calendar" : detailOrigin.current?.href === "/dashboard" || detailOrigin.current?.href.includes("view=overview") || detailOrigin.current?.href === "/" ? "Back to home" : "Back to conversations"}')
source = source.replace('<RecordingProgress key={meeting.id} meeting={meeting} mode={mode} onOpenAudio={() => openDetail(meeting.id, "Audio")} onRetryAccepted={() => workspace.loadLive(false, true)} />', '<div key={meeting.id} className={flow.progressEntry}><h3>{meeting.title}</h3><RecordingProgress meeting={meeting} mode={mode} onOpenAudio={() => openDetail(meeting.id, "Audio")} onRetryAccepted={() => workspace.loadLive(false, true)} /></div>')
path.write_text(source, encoding='utf-8')
