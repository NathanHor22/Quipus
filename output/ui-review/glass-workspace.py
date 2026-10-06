from pathlib import Path

q = Path('components/workspace/quipus.module.css')
source = q.read_text(encoding='utf-8-sig')
for old in ['12px', '10px', '9px', '8px', '7px', '6px', '5px']:
    source = source.replace('border-radius: '+old+';', 'border-radius: 3px;')
source += '''

/* Quipus workspace: angular glass and a continuous crimson frame. */
.header { max-width: none; padding: 18px max(32px, calc((100vw - 1272px) / 2)); gap: 24px; background: var(--q-glass); backdrop-filter: blur(var(--q-glass-blur)); box-shadow: inset 0 1px var(--q-edge-highlight), 0 1px 0 var(--q-line); border-bottom: 0; }
.header::after { content: ''; position: absolute; height: 2px; width: 64px; bottom: -1px; left: max(32px, calc((100vw - 1272px) / 2)); background: linear-gradient(90deg,var(--q-red-deep),var(--q-red-bright)); }
.brand > span { font-size: 23px; letter-spacing: .08em; }
.brand small { letter-spacing: .16em; font-size: 7px; }
.navigation { gap: 2px; border-radius: 3px; padding: 3px; border-color: var(--q-line-strong); background: var(--q-glass); box-shadow: inset 0 1px var(--q-edge-highlight); }
.navLink { min-height: 40px; border-radius: 2px; padding: 11px 19px; font-size: 11px; letter-spacing: .025em; }
.navHighlight { background: var(--q-text); box-shadow: none; }
.navSelected, .navSelected:hover { color: var(--q-on-accent); }
.navHighlight::after { left: 0; right: auto; width: 27px; bottom: -4px; height: 2px; background: var(--q-red-bright); }
.themeButton { min-height: 36px; width: auto; padding: 8px 11px; border: 1px solid var(--q-line-strong); border-radius: 3px; background: var(--q-glass); color: var(--q-text); font-size: 10px; }
.headerActions { gap: 10px; }
.signIn { min-height: 36px; border-radius: 3px; padding: 10px 13px; font-size: 10px; }
.profileTrigger { min-height: 36px; border: 1px solid var(--q-line-strong); padding: 4px 10px 4px 4px; border-radius: 3px; background: var(--q-glass); }
.profileAvatar { border-radius: 2px; width: 27px; height: 27px; background: var(--q-text); color: var(--q-on-accent); }
.profileCaret { display: block; width: 5px; height: 5px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: rotate(45deg); margin: -3px 2px 0; }
.profileMenu { border-radius: 3px; background: var(--q-glass-strong); backdrop-filter: blur(var(--q-glass-blur)); gap: 7px; padding: 17px; }
.profileMenu button, .profileMenu a { border: 1px solid var(--q-line-strong); background: var(--q-glass); padding: 11px 12px; border-radius: 3px; font-size: 11px; }
.welcome { padding: 40px 0 34px; }
.welcome h1 { font-size: clamp(34px,4vw,51px); letter-spacing: -.045em; }
.welcome p { margin-top: 15px; font-size: 12px; }
.dateLine { margin-bottom: 18px; }
.welcomeMetrics { gap: 0; padding: 0; border: 1px solid var(--q-line); background: var(--q-panel-gradient); box-shadow: inset 0 1px var(--q-edge-highlight); border-radius: 3px; }
.welcomeMetrics > div { padding: 18px 24px; min-width: 118px; }
.welcomeMetrics > div + div { border-left: 1px solid var(--q-line); }
.welcomeMetrics strong { font-size: 28px; }
.dailyBrief { gap: 0; margin-bottom: 30px; background: var(--q-panel-gradient); border: 1px solid var(--q-line-strong); border-radius: 3px; box-shadow: var(--q-shadow), inset 0 1px var(--q-edge-highlight); backdrop-filter: blur(var(--q-glass-blur)); position: relative; }
.dailyBrief::before { content: ''; position: absolute; z-index: 2; left: -1px; top: -1px; width: 45px; height: 3px; background: linear-gradient(90deg,var(--q-red-deep),var(--q-red-bright)); }
.dailyBrief::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 32px; height: 2px; background: var(--q-red); }
.nextAction, .nextMeeting { padding: 24px 27px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.nextAction { border-right: 1px solid var(--q-line); }
.nextAction::before { display: none; }
.briefHeading { margin-bottom: 19px; }
.kicker { color: var(--q-muted-strong); font-size: 9px; letter-spacing: .18em; }
.approvalCount { border: 1px solid var(--q-line); background: var(--q-glass); border-radius: 2px; padding: 5px 8px; font-size: 9px; }
.nextAction h2, .nextMeeting h2 { font-size: 21px; letter-spacing: -.025em; line-height: 1.3; }
.nextAction p, .nextMeeting p { font-size: 11px; }
.smallPeople > span:first-child:empty { display: none; }
.actionButton, .textLink, .clearFilter, .sampleNote button, .deviceStatus { display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; min-height: 36px; gap: 8px; padding: 9px 14px; font-size: 10px !important; line-height: 1.4; font-weight: 550; text-decoration: none; transition: background .18s,border-color .18s,box-shadow .18s; }
.actionButton { position: relative; background: var(--q-button-bg); border: 1px solid var(--q-button-bg); color: var(--q-button-text); }
.actionButton::before { content: ''; position: absolute; left: -1px; top: -1px; height: 2px; width: 23px; background: var(--q-red-bright); }
.actionButton:hover { transform: none; opacity: 1; box-shadow: 0 3px 10px #0b223915; }
.textLink, .clearFilter, .sampleNote button, .deviceStatus { border: 1px solid var(--q-line-strong); background: var(--q-glass); color: var(--q-text); }
.textLink:hover, .clearFilter:hover, .sampleNote button:hover, .deviceStatus:hover { background: var(--q-glass-strong); border-color: var(--q-text); text-decoration: none; }
.search { border-radius: 3px; background: var(--q-glass); min-height: 38px; padding: 11px 13px; }
.search input { font-size: 11px; }
.dateFilter input { border-radius: 3px; min-height: 38px; background: var(--q-glass); }
.journalFilters { gap: 10px; margin-bottom: 12px; }
.sectionHeading h2 { font-size: 18px; }
.journalSurface { border-radius: 3px; background: var(--q-panel-gradient); border-color: var(--q-line-strong); box-shadow: var(--q-shadow), inset 0 1px var(--q-edge-highlight); backdrop-filter: blur(var(--q-glass-blur)); }
.journalColumns, .journalRow { grid-template-columns: 69px minmax(155px,1fr) minmax(160px,1.3fr) 100px 135px 35px; gap: 13px; }
.journalColumns { padding: 13px 20px; background: var(--q-glass); font-size: 8px; letter-spacing: .09em; text-transform: uppercase; }
.dayGroup h3 { font-size: 9px; letter-spacing: .02em; padding: 9px 20px; background: color-mix(in srgb,var(--q-text) 3%,transparent); }
.journalRow { position: relative; background: transparent; min-height: 64px; }
.journalRow::before { content: ''; position: absolute; width: 2px; background: var(--q-red); left: -1px; top: 10px; bottom: 10px; opacity: 0; transition: opacity .18s; }
.journalRow:hover { background: var(--q-glass-strong); }
.journalRow:hover::before, .journalRow:focus-visible::before { opacity: 1; }
.journalRow:hover .rowArrow { transform: none; }
.rowArrow { width: auto !important; height: auto !important; font-size: 9px; color: var(--q-muted-strong); }
.journalAvatar { background: var(--q-glass); border: 1px solid var(--q-line); border-radius: 2px; }
.journalStatus { border: 1px solid var(--q-line); border-radius: 2px; font-size: 8px; padding: 5px 7px; }
.journalStatus[data-approval='true'] { border-color: color-mix(in srgb,var(--q-red) 25%,transparent); background: var(--q-danger-soft); color: var(--q-danger); }
.sampleNote { padding-top: 17px; align-items: center; }
.sampleBadge { border-radius: 2px; background: var(--q-glass); padding: 4px 6px; }
.workspaceNote { margin-top: 20px; }
.profileForm input, .profileForm select { border-radius: 3px; background: var(--q-glass); }
.connectionPrompt { border-radius: 3px; background: var(--q-panel-gradient); backdrop-filter: blur(var(--q-glass-blur)); box-shadow: var(--q-shadow); border-left: 2px solid var(--q-red); }
.skeletonBrief i { border-radius: 3px; }
@media (max-width:1100px) {
  .header { padding: 17px 28px; gap: 16px; } .header::after { left: 28px; }
  .navLink { padding: 11px 13px; } .welcomeMetrics > div { padding: 17px 18px; min-width: 96px; }
  .journalColumns,.journalRow { grid-template-columns: 62px minmax(145px,1fr) minmax(130px,1fr) 131px 33px; gap: 11px; }
}
@media (max-width:760px) {
  .header { padding: 15px 20px 14px; gap: 14px; } .header::after { left: 20px; }
  .headerActions { gap: 7px; } .themeButton { padding: 8px 9px; }
  .navigation { min-width: 0; } .navLink { padding: 10px 7px; min-height: 38px; font-size: 10px; }
  .brand > span { font-size: 21px; } .welcome { padding: 30px 0 25px; }
  .welcome h1 { font-size: 35px; } .dailyBrief { grid-template-columns: 1fr; gap: 0; margin-bottom: 25px; }
  .nextAction,.nextMeeting { padding: 21px; } .nextAction { border-right: 0; border-bottom: 1px solid var(--q-line); }
  .nextAction h2,.nextMeeting h2 { font-size: 20px; } .briefBottom { gap: 12px; }
  .journalColumns,.journalRow { grid-template-columns: 56px minmax(90px,1fr) 114px; gap: 10px; padding-inline: 14px; }
  .rowArrow { display: none; } .journalCopy strong { font-size: 11px; } .journalCopy > span { font-size: 9px; }
  .journalStatus { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .workspaceNote { gap: 12px; } .workspaceNote > span { max-width: 45%; line-height: 1.6; }
  .deviceStatus { white-space: normal; font-size: 9px !important; text-align: left; padding: 9px 10px; }
}
@media (max-width:380px) {
  .header { padding-inline: 16px; } .header::after { left: 16px; }
  .brand > span { font-size: 19px; } .brand svg { width: 28px !important; height: 30px !important; }
  .headerActions { gap: 6px; } .signIn { padding: 9px 10px; } .themeButton { padding-inline: 8px; }
  .journalColumns,.journalRow { grid-template-columns: 49px minmax(80px,1fr) 101px; gap: 7px; padding-inline: 11px; }
  .journalStatus { font-size: 7.5px; padding-inline: 5px; } .nextAction,.nextMeeting { padding: 18px; }
  .briefBottom { flex-wrap: wrap; } .smallPeople { font-size: 9px; }
  .sampleNote { gap: 10px; } .sampleNote > span { flex-wrap: wrap; gap: 5px; }
}
@media (prefers-reduced-motion:reduce) { .actionButton,.textLink,.clearFilter,.sampleNote button,.deviceStatus,.journalRow::before { transition: none; } }
'''
q.write_text(source, encoding='utf-8')

w = Path('components/workspace/workspace.module.css')
source = w.read_text(encoding='utf-8-sig')
source += '''

/* Shared workspace controls, calendar and confirmation surfaces. */
.content { max-width: 1272px; padding-inline: 44px; }
.shell button:focus-visible,.shell a:focus-visible,.approvalDialog button:focus-visible { outline: 2px solid var(--q-text); outline-offset: 3px; }
.primaryButton,.secondaryButton,.signInButton,.signOutButton,.iconButton,.textButton,.todayButton,.sourceLink,.dismissButton,.moreEvents,.compactAction,.modeButton { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; border: 1px solid var(--q-line-strong); border-radius: 3px; gap: 8px; padding: 9px 13px; background: var(--q-glass); color: var(--q-text); font-size: 11px; font-weight: 550; line-height: 1.4; text-decoration: none; transition: border-color .18s,background .18s; }
.primaryButton,.signInButton { background: var(--q-button-bg); border-color: var(--q-button-bg); color: var(--q-button-text); }
.primaryButton:hover,.signInButton:hover { opacity: .9; }
.secondaryButton:hover,.signOutButton:hover,.iconButton:hover,.textButton:hover,.todayButton:hover,.sourceLink:hover,.dismissButton:hover,.moreEvents:hover { background: var(--q-glass-strong); border-color: var(--q-text); }
.iconButton { width: auto; height: auto; min-width: 36px; padding: 8px 11px; }
.calendarSurface,.approvalRail,.settingsCard,.collection,.personCard { border-radius: 3px; background: var(--q-panel-gradient); backdrop-filter: blur(var(--q-glass-blur)); box-shadow: var(--q-shadow),inset 0 1px var(--q-edge-highlight); border: 1px solid var(--q-line-strong); }
.calendarSurface { overflow: hidden; position: relative; }
.calendarSurface::before,.settingsCard::before { content: ''; position: absolute; top: -1px; left: -1px; width: 35px; height: 2px; background: var(--q-red); }
.calendarLayout { gap: 18px; grid-template-columns: minmax(0,1fr) 290px; }
.calendarToolbar { padding: 21px 20px; border-bottom: 1px solid var(--q-line); background: transparent; gap: 16px; }
.calendarToolbar h2 { font-size: 21px; font-weight: 500; letter-spacing: -.03em; }
.monthControls { gap: 7px; } .monthControls h2 { margin-right: 11px; }
.monthControls .iconButton { width: 34px; min-width: 34px; height: 34px; min-height: 34px; padding: 8px; }
.todayButton { font-size: 10px; min-height: 34px; padding: 8px 11px; }
.viewToggle { background: var(--q-glass); border: 1px solid var(--q-line-strong); border-radius: 3px; padding: 3px; gap: 3px; }
.viewToggle button { border: 1px solid transparent; border-radius: 2px; min-height: 30px; padding: 6px 10px; font-size: 10px; }
.viewToggle .toggleActive { background: var(--q-text); color: var(--q-on-accent); }
.weekdays { background: var(--q-glass); padding: 12px 0; } .weekdays span { font-size: 9px; letter-spacing: .08em; }
.day { min-height: 100px; background: transparent; padding: 7px; border-color: var(--q-line); }
.day.selectedDay { background: color-mix(in srgb,var(--q-red) 5%,transparent); box-shadow: inset 0 2px var(--q-red); }
.day.otherMonth { background: color-mix(in srgb,var(--q-text) 2%,transparent); }
.dayNumber { width: 27px; height: 27px; border: 1px solid transparent; border-radius: 2px; font-size: 10px; }
.dayNumber.todayNumber { border-color: var(--q-red); color: var(--q-danger); background: var(--q-danger-soft); }
.eventChip { border: 1px solid var(--q-line); border-left: 2px solid var(--q-text); border-radius: 2px; background: var(--q-glass); padding: 6px; margin-top: 4px; }
.scheduledChip { border-left-color: var(--q-red); background: var(--q-danger-soft); }
.conversationChip { color: var(--q-text); background: var(--q-glass); }
.eventChip strong { font-size: 9px; line-height: 1.4; } .eventTime { font-size: 8px; color: var(--q-muted-strong); }
.moreEvents { width: 100%; min-height: 24px; padding: 3px; margin-top: 3px; font-size: 8px; }
.calendarLegend { background: var(--q-glass); border-top: 1px solid var(--q-line); padding: 14px 18px; font-size: 9px; }
.agendaRow { background: transparent; border-color: var(--q-line); padding: 18px 20px; }
.agendaRow:hover { background: var(--q-glass-strong); } .typePill { border-radius: 2px; border: 1px solid var(--q-line); }
.approvalRail { padding: 21px 18px; } .approvalRail h2 { font-size: 22px; font-weight: 500; letter-spacing: -.03em; }
.count { border-radius: 2px; border: 1px solid var(--q-line); color: var(--q-muted-strong); background: var(--q-glass); }
.railIntro { font-size: 11px; line-height: 1.65; margin-bottom: 23px; }
.approvalCard { padding: 16px 0 20px; border: 0; border-top: 1px solid var(--q-line); border-radius: 0; background: transparent; margin: 0; }
.approvalCard h3 { font-size: 16px; } .approvalIdentity strong { font-size: 11px; } .approvalIdentity small { font-size: 10px; }
.smallAvatar,.avatar { border-radius: 3px; border: 1px solid var(--q-line); background: var(--q-glass); }
.approvalIdentity .iconButton { padding: 6px 9px; min-width: auto; min-height: 30px; font-size: 9px; }
.approvalCard blockquote { border-left: 2px solid var(--q-red); background: var(--q-glass); color: var(--q-muted-strong); border-radius: 0; padding: 11px 13px; font-size: 11px; }
.approvalTime { gap: 7px; font-size: 10px; } .attendee { font-size: 10px; overflow-wrap: anywhere; }
.sourceLink { font-size: 10px; width: 100%; margin: 12px 0; } .approvalActions { gap: 7px; }
.approvalActions .primaryButton { padding: 10px; min-height: 38px; font-size: 10px; } .dismissButton { font-size: 10px; padding: 9px; }
.railFilters button { border: 1px solid var(--q-line-strong); border-radius: 3px; background: var(--q-glass); padding: 8px 11px; font-size: 10px; }
.railFilters .activeFilter { background: var(--q-text); color: var(--q-on-accent); }
.railFootnote { font-size: 9px; line-height: 1.65; padding-top: 18px; }
.peopleGrid { gap: 15px; } .personCard { position: relative; padding: 21px; text-align: left; color: var(--q-text); }
.personCard:hover { border-color: var(--q-text); background: var(--q-glass-strong); }
.personCard h2 { font-size: 17px; } .personCard p { font-size: 11px; } .personCard footer { padding-top: 17px; font-size: 10px; }
.search { background: var(--q-glass); border-radius: 3px; } .search input { font-size: 11px; }
.settingsCard { padding: 24px; position: relative; } .settingsCard h2 { font-size: 19px; } .settingsCard p { font-size: 12px; line-height: 1.65; }
.settingsGrid { gap: 16px; } .settingsCard .textButton { margin-top: 12px; }
.connectionState { border-radius: 2px; background: var(--q-glass); padding: 8px 11px; font-size: 10px; border: 1px solid var(--q-line); }
.region { border-radius: 3px; background: var(--q-glass); font-size: 11px; }
.toast,.errorBanner { border-radius: 3px; background: var(--q-glass-strong); backdrop-filter: blur(var(--q-glass-blur)); box-shadow: var(--q-shadow); border: 1px solid var(--q-line-strong); }
.errorBanner { border-left: 2px solid var(--q-red); font-size: 12px; padding: 12px 14px; gap: 12px; }
.toast { font-size: 12px; } .toast button { border: 1px solid var(--q-line-strong); min-height: 32px; border-radius: 3px; padding: 7px 10px; background: var(--q-glass); color: var(--q-text); font-size: 10px; }
.approvalDialog { max-height: calc(100dvh - 40px); border-radius: 3px; border: 1px solid var(--q-line-strong); background: var(--q-glass-strong); backdrop-filter: blur(var(--q-glass-blur)); box-shadow: var(--q-shadow-modal); padding: 28px; }
.approvalDialog header { padding-bottom: 18px; border-bottom: 1px solid var(--q-line); margin-bottom: 20px; gap: 15px; }
.approvalDialog h2 { font-size: 25px; font-weight: 500; letter-spacing: -.03em; }
.approvalDialog input { border-radius: 3px; border-color: var(--q-line-strong); background: var(--q-glass); color: var(--q-text); font-size: 12px; }
.approvalDialog label { font-size: 11px; } .approvalDialog .evidence { border-radius: 0; border-left: 2px solid var(--q-red); background: var(--q-glass); font-size: 12px; }
.approvalDialog .privateNote { background: transparent; padding: 0; font-size: 11px; }
.approvalDialog footer { border-top: 1px solid var(--q-line); padding-top: 20px; }
.approvalDialog header .iconButton { font-size: 10px; }
.pageFooter { font-size: 9px; margin-top: 38px; } .footerBrand { font-size: 11px; }
.footerLinks a { display: inline-flex; border: 1px solid var(--q-line); background: var(--q-glass); padding: 6px 9px; border-radius: 3px; text-decoration: none; }
@media (max-width:1150px) { .calendarLayout { grid-template-columns: minmax(0,1fr); } .approvalRail { max-height: none; } .content { padding-inline: 28px; } }
@media (max-width:760px) {
  .content { padding: 8px 20px 26px; } .calendarToolbar { flex-wrap: wrap; padding: 17px 14px; gap: 12px; }
  .calendarToolbar h2 { font-size: 19px; } .monthControls { flex-wrap: wrap; gap: 6px; } .monthControls h2 { margin-right: 8px; }
  .viewToggle { margin-left: auto; } .day { min-height: 83px; padding: 5px 3px; } .dayNumber { width: 25px; height: 25px; }
  .eventChip { padding: 4px 3px; } .eventChip strong { font-size: 8px; } .eventTime { font-size: 7px; }
  .calendarSurface { border-radius: 3px; } .calendarLegend { flex-wrap: wrap; gap: 10px; font-size: 8px; padding: 12px; }
  .settingsGrid { grid-template-columns: 1fr; } .peopleGrid { grid-template-columns: 1fr; } .settingsCard { padding: 21px; }
  .approvalDialog { width: calc(100vw - 28px); max-width: none; max-height: calc(100dvh - 28px); padding: 20px; }
  .approvalDialog h2 { font-size: 22px; } .formRow { grid-template-columns: 1fr; } .approvalDialog footer { flex-wrap: wrap; }
  .approvalDialog footer > button { flex: 1 1 auto; } .approvalDialog header .iconButton { min-width: 48px; }
}
@media (max-width:380px) { .content { padding-inline: 16px; } .calendarToolbar h2 { font-size: 18px; } .todayButton { padding-inline: 8px; } }
@media (prefers-reduced-motion:reduce) { .primaryButton,.secondaryButton,.iconButton,.textButton,.todayButton,.sourceLink,.dismissButton,.moreEvents { transition: none; } }
'''
w.write_text(source, encoding='utf-8')
