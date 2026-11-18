(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'diary-offline-v1';
  const MONTHS = ['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'];
  const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const defaults = {dark:false, use24Hour:true};
  let settings = {...defaults};
  let entries = {};
  let selectedKey = '';
  let todayKey = '';
  let loading = true;
  let restored = false;
  let persistTimer = 0;
  let typingTimer = 0;
  let clockTimer = 0;
  let toastTimer = 0;
  let calendarCursor = new Date();
  let dialogResolve = null;
  let requestCounter = 0;
  const pending = new Map();

  const pad = n => String(n).padStart(2, '0');
  function dateKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function fromKey(key) { const [y,m,d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0, 0); }
  function addDays(key, amount) { const date = fromKey(key); date.setDate(date.getDate() + amount); return dateKey(date); }
  function sameDay(a,b) { return dateKey(a) === dateKey(b); }
  function isLocked(key) { return key < todayKey; }
  function nowTime(date = new Date()) {
    return new Intl.DateTimeFormat(undefined, {hour:'2-digit', minute:'2-digit', hour12:!settings.use24Hour}).format(date);
  }
  function shortDate(date) {
    return new Intl.DateTimeFormat(undefined, {weekday:'short', month:'short', day:'numeric'}).format(date);
  }
  function longDate(date) {
    return new Intl.DateTimeFormat(undefined, {weekday:'long', month:'long', day:'numeric'}).format(date);
  }
  function isoNow() { return new Date().toISOString(); }

  // Integer-only conversion from the device's Gregorian date to the Solar Hijri calendar.
  function gregorianToJalali(gy, gm, gd) {
    const gdm = [0,31,59,90,120,151,181,212,243,273,304,334];
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
    let jy = -1595 + 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return {year:jy, month:jm, day:jd, monthName:MONTHS[jm - 1]};
  }
  function jalaliForKey(key) { const d = fromKey(key); return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function jalaliLabel(key) { const j = jalaliForKey(key); return j.day + ' ' + j.monthName + ' ' + j.year; }

  function native(type, payload = {}, requestId = '') {
    if (window.ADiaryTNative) window.ADiaryTNative.dispatch(JSON.stringify({type, payload, requestId}));
    else if (type === 'ready') setTimeout(() => bootstrap(loadLocal()), 0);
  }
  function showToast(text, duration = 3000) {
    $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').hidden = true, duration);
  }
  function saveLocal(state) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {} }
  function loadLocal() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) { return {}; } }
  function stateSnapshot() {
    const copy = {};
    for (const [key, entry] of Object.entries(entries)) copy[key] = {...entry};
    return {version:2, settings, selectedKey, entries:copy};
  }
  function persistNow() {
    clearTimeout(persistTimer);
    if (!restored) return;
    const state = stateSnapshot();
    saveLocal(state);
    native('persist', state);
  }
  function schedulePersist() { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 450); }
  function flushSession() { if (selectedKey && $('editor')) commitCurrent(false); persistNow(); }

  function getEntry(key) {
    if (!entries[key] || typeof entries[key] !== 'object') entries[key] = {key, text:'', savedAt:'', updatedAt:''};
    return entries[key];
  }
  function migrateDocuments(state) {
    const result = {};
    if (state && state.entries && typeof state.entries === 'object') {
      for (const [key, value] of Object.entries(state.entries)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key) && value && typeof value === 'object') result[key] = {
          key, text:typeof value.text === 'string' ? value.text : '', savedAt:value.savedAt || value.updatedAt || '', updatedAt:value.updatedAt || value.savedAt || ''
        };
      }
    }
    // A workspace saved by the reference editor can still be opened as a diary.
    if (!Object.keys(result).length && Array.isArray(state && state.documents)) {
      for (const doc of state.documents) {
        const match = String(doc.name || '').match(/(\d{4}-\d{2}-\d{2})/);
        if (match) result[match[1]] = {key:match[1], text:doc.text || '', savedAt:'', updatedAt:''};
      }
    }
    return result;
  }
  function bootstrap(state) {
    if (restored) return;
    const now = new Date(); todayKey = dateKey(now);
    settings = {...defaults, ...(state && state.settings || {})};
    settings.use24Hour = settings.use24Hour !== false;
    entries = migrateDocuments(state || {});
    // The current entry is created on first launch; older entries are permanently read-only.
    getEntry(todayKey);
    selectedKey = state && state.selectedKey && state.selectedKey <= todayKey ? state.selectedKey : todayKey;
    for (const key of Object.keys(entries)) if (isLocked(key)) entries[key].locked = true;
    restored = true; loading = false;
    applyTheme(); renderDate(); renderClock(); schedulePersist();
  }

  function applyTheme() {
    document.body.classList.toggle('dark', !!settings.dark);
    native('theme', {dark:!!settings.dark});
  }
  function currentEntry() { return getEntry(selectedKey); }
  function commitCurrent(stamp) {
    if (!selectedKey || !$('editor')) return;
    const entry = currentEntry();
    const text = $('editor').value;
    if (entry.text !== text) { entry.text = text; entry.updatedAt = isoNow(); }
    if (stamp && !isLocked(selectedKey) && text.trim()) entry.savedAt = isoNow();
  }
  function scheduleAutosave() {
    if (isLocked(selectedKey)) return;
    clearTimeout(typingTimer);
    const state = $('saveState'); state.className = 'save-state saving'; state.innerHTML = '<i class="status-dot"></i><span>Typing…</span>';
    typingTimer = setTimeout(() => {
      commitCurrent(true);
      const entry = currentEntry();
      state.className = 'save-state saved'; state.innerHTML = '<i class="status-dot"></i><span>Saved</span>';
      updateSavedAt(entry); updateMeta(); schedulePersist();
    }, 900);
    schedulePersist();
  }
  function updateLineNumbers() {
    const lines = Math.max(1, $('editor').value.split('\n').length);
    $('lineNumbers').textContent = Array.from({length:lines}, (_,i) => i + 1).join('\n');
    $('lineNumbers').scrollTop = $('editor').scrollTop;
  }
  function updateMeta() {
    const text = $('editor').value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    $('entryMeta').textContent = words + ' word' + (words === 1 ? '' : 's') + ' · ' + text.length.toLocaleString() + ' character' + (text.length === 1 ? '' : 's');
  }
  function updateSavedAt(entry) {
    if (!entry.savedAt) { $('savedAt').textContent = 'Not saved yet'; return; }
    const saved = new Date(entry.savedAt);
    $('savedAt').textContent = 'Saved at ' + nowTime(saved);
  }
  function renderDate() {
    const date = fromKey(selectedKey), entry = currentEntry(), locked = isLocked(selectedKey);
    const today = selectedKey === todayKey;
    const jalali = jalaliForKey(selectedKey);
    $('dateKicker').textContent = today ? 'TODAY' : locked ? 'PAST ENTRY' : 'DIARY ENTRY';
    $('dateTitle').textContent = longDate(date);
    $('dateSubtitle').textContent = jalali.day + ' ' + jalali.monthName + ' ' + jalali.year + ' · ' + nowTime();
    $('topDate').textContent = shortDate(new Date()) + ' · ' + nowTime();
    $('entryLabel').textContent = today ? "TODAY'S ENTRY" : locked ? 'READ-ONLY ENTRY' : 'DIARY ENTRY';
    $('dateStateText').textContent = locked ? 'Read only' : 'Editable';
    $('lockIcon').textContent = locked ? '▣' : '●';
    $('date-state');
    $('dateStateText').parentElement.classList.toggle('locked', locked);
    $('editor').readOnly = locked;
    $('editor').value = entry.text || '';
    $('editor').placeholder = locked ? 'This entry is locked after the day ended.' : 'Write about your day…';
    $('previousDay').disabled = false;
    $('bottomToday').classList.toggle('active', today);
    const state = $('saveState'); state.className = locked ? 'save-state locked' : entry.savedAt ? 'save-state saved' : 'save-state';
    state.innerHTML = '<i class="status-dot"></i><span>' + (locked ? 'Locked' : entry.savedAt ? 'Saved' : 'Ready') + '</span>';
    updateSavedAt(entry); updateMeta(); updateLineNumbers();
    $('editor').scrollTop = 0;
  }
  function renderClock() {
    if (!restored) return;
    const now = new Date(), key = dateKey(now);
    $('topDate').textContent = shortDate(now) + ' · ' + nowTime(now);
    if (key !== todayKey) {
      // Re-evaluate the lock boundary whenever the app remains open over midnight.
      todayKey = key;
      for (const date of Object.keys(entries)) if (isLocked(date)) entries[date].locked = true;
      if (selectedKey > todayKey) selectedKey = todayKey;
      getEntry(todayKey); renderDate(); schedulePersist();
    } else if (selectedKey === todayKey) {
      const j = jalaliForKey(selectedKey);
      $('dateSubtitle').textContent = j.day + ' ' + j.monthName + ' ' + j.year + ' · ' + nowTime(now);
    }
  }
  function selectDate(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key > todayKey) return;
    clearTimeout(typingTimer);
    if (selectedKey && !isLocked(selectedKey)) commitCurrent(true);
    selectedKey = key; getEntry(key); renderDate(); closeMenu(); schedulePersist();
  }

  function textNode(tag, text, cls) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
  function dialog(title, body, buttons = [{label:'OK', value:'ok', className:'primary'}]) {
    $('dialogTitle').textContent = title; $('dialogBody').replaceChildren(body); const actions = $('dialogActions'); actions.replaceChildren();
    for (const button of buttons) { const el = textNode('button', button.label); if (button.className) el.className = button.className; el.addEventListener('click', () => finishDialog(typeof button.value === 'function' ? button.value() : button.value)); actions.append(el); }
    $('dialogBackdrop').hidden = false;
    return new Promise(resolve => { dialogResolve = resolve; });
  }
  function finishDialog(value) { $('dialogBackdrop').hidden = true; const resolve = dialogResolve; dialogResolve = null; if (resolve) resolve(value); }
  function closeMenu() { $('menuPopover').hidden = true; }

  function closeCalendar() {
    $('calendarPage').hidden = true;
    $('app').hidden = false;
    $('bottomCalendar').focus({preventScroll:true});
  }
  function showCalendar() {
    closeMenu();
    document.activeElement?.blur();
    calendarCursor = fromKey(selectedKey); calendarCursor.setDate(1);
    let focusedKey = selectedKey;
    const body = textNode('div', '', 'calendar-view');
    const head = document.createElement('div'); head.className = 'calendar-head';
    const back = textNode('button','‹'); const forward = textNode('button','›'); const title = textNode('strong','');
    back.setAttribute('aria-label', 'Previous month'); forward.setAttribute('aria-label', 'Next month');
    const monthTitle = textNode('div', '', 'calendar-month-title');
    const solarTitle = textNode('small', '', 'calendar-solar-month');
    monthTitle.setAttribute('aria-live', 'polite'); monthTitle.append(title, solarTitle);
    head.append(back,monthTitle,forward); body.append(head);
    const grid = document.createElement('div'); grid.className = 'calendar-grid'; body.append(grid);
    body.append(textNode('p', 'Gregorian day above · Solar Hijri day below', 'hint calendar-legend'));
    const preview = textNode('div', '', 'calendar-preview'); preview.setAttribute('aria-live', 'polite'); body.append(preview);
    const draw = () => {
      const month = calendarCursor.getMonth(), year = calendarCursor.getFullYear();
      title.textContent = new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(calendarCursor);
      const firstSolar = jalaliForKey(dateKey(calendarCursor));
      const lastSolar = jalaliForKey(dateKey(new Date(year, month + 1, 0, 12)));
      solarTitle.textContent = firstSolar.year === lastSolar.year
        ? (firstSolar.month === lastSolar.month ? firstSolar.monthName : firstSolar.monthName + ' – ' + lastSolar.monthName) + ' ' + firstSolar.year
        : firstSolar.monthName + ' ' + firstSolar.year + ' – ' + lastSolar.monthName + ' ' + lastSolar.year;
      grid.replaceChildren(); for (const weekday of WEEKDAYS) grid.append(textNode('div',weekday,'weekday'));
      const offset = (calendarCursor.getDay() + 6) % 7, days = new Date(year, month + 1, 0).getDate();
      for (let i = 0; i < offset; i++) grid.append(textNode('div','','calendar-cell blank'));
      for (let day = 1; day <= days; day++) {
        const date = new Date(year,month,day,12), key = dateKey(date), cell = textNode('button','','calendar-cell');
        const jalali = jalaliForKey(key); cell.title = String(day) + ' ' + new Intl.DateTimeFormat(undefined,{month:'long'}).format(date) + ' · ' + jalaliLabel(key);
        cell.setAttribute('aria-label', cell.title);
        cell.dataset.date = key;
        cell.append(textNode('span',String(day),'calendar-gregorian'), textNode('span',String(jalali.day),'calendar-jalali'));
        if (key === focusedKey) cell.classList.add('selected'); if (key === todayKey) cell.classList.add('today'); if (isLocked(key)) cell.classList.add('locked');
        if (key > todayKey) cell.classList.add('future');
        if (entries[key] && entries[key].text) cell.append(textNode('i','','entry-dot'));
        cell.addEventListener('click', () => {
          if (key > todayKey) { focusedKey = key; draw(); return; }
          selectDate(key); closeCalendar();
        }); grid.append(cell);
      }
      const future = focusedKey > todayKey;
      preview.replaceChildren(
        textNode('strong', new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(fromKey(focusedKey))),
        textNode('span', jalaliLabel(focusedKey)),
        textNode('small', future ? 'Future date · writing opens on this day' : focusedKey === todayKey ? 'Today · open your diary entry' : 'Past entry · read only')
      );
    };
    const changeMonth = amount => { calendarCursor.setMonth(calendarCursor.getMonth() + amount); focusedKey = dateKey(calendarCursor); draw(); };
    back.addEventListener('click', () => changeMonth(-1));
    forward.addEventListener('click', () => changeMonth(1));
    draw();
    $('calendarContent').replaceChildren(body);
    $('app').hidden = true;
    $('calendarPage').hidden = false;
    $('calendarContent').scrollTop = 0;
    $('calendarBack').focus({preventScroll:true});
  }
  function showEntries() {
    closeMenu(); const body = document.createElement('div'); body.className = 'entry-list';
    const keys = Object.keys(entries).filter(key => entries[key].text || key === todayKey).sort().reverse();
    if (!keys.length) body.append(textNode('p','Your diary entries will appear here after you write and pause.','hint'));
    for (const key of keys) {
      const entry = entries[key], row = document.createElement('button'); row.className = 'entry-row';
      const main = textNode('span','','entry-row-main'); main.append(textNode('strong',longDate(fromKey(key))));
      main.append(textNode('small',jalaliLabel(key) + (entry.savedAt ? ' · saved ' + nowTime(new Date(entry.savedAt)) : '')));
      row.append(main,textNode('span',isLocked(key) ? '▣' : '›','row-lock')); row.addEventListener('click', () => { selectDate(key); finishDialog(true); }); body.append(row);
    }
    dialog('Entries',body,[{label:'Close',value:null}]);
  }
  function showSettings() {
    closeMenu(); const body = document.createElement('div');
    const themeRow = document.createElement('div'); themeRow.className = 'settings-row'; themeRow.append(textNode('label','Dark theme'));
    const theme = document.createElement('input'); theme.type = 'checkbox'; theme.checked = !!settings.dark; themeRow.append(theme); body.append(themeRow);
    const clockRow = document.createElement('div'); clockRow.className = 'settings-row'; clockRow.append(textNode('label','Clock format'));
    const clock = document.createElement('select'); clock.innerHTML = '<option value="24">24-hour</option><option value="12">12-hour</option>'; clock.value = settings.use24Hour ? '24' : '12'; clockRow.append(clock); body.append(clockRow);
    body.append(textNode('p','Diary entries are saved automatically to private on-device storage. At the next date, yesterday becomes read only.','hint'));
    dialog('Settings',body,[{label:'Cancel',value:false},{label:'Save',value:true,className:'primary'}]).then(ok => { if (!ok) return; settings.dark = theme.checked; settings.use24Hour = clock.value === '24'; applyTheme(); renderDate(); schedulePersist(); showToast('Settings saved'); });
  }
  function showAbout() {
    closeMenu(); const body = document.createElement('div'); body.append(textNode('p','Diary keeps your writing on this device and works without an account or network connection.'),textNode('p','Dates use your device clock and show both the Gregorian calendar and the Iranian Solar Hijri month.'),textNode('p','When you stop typing, Diary records the current time and saves the entry automatically.')); dialog('About Diary',body);
  }
  function exportDiary() {
    closeMenu(); const keys = Object.keys(entries).filter(key => entries[key].text).sort();
    if (!keys.length) { showToast('Write an entry before exporting.'); return; }
    const text = keys.map(key => '===== ' + longDate(fromKey(key)) + ' · ' + jalaliLabel(key) + ' =====\n' + entries[key].text.trim() + '\n').join('\n');
    const requestId = 'export' + (++requestCounter); pending.set(requestId, true);
    native('save', {id:'diary-export',name:'diary-' + todayKey + '.txt',uri:'',text,encoding:'UTF-8',eol:'LF',saveAs:true,force:true}, requestId);
  }
  function handleAction(action) {
    switch (action) {
      case 'previous': selectDate(addDays(selectedKey,-1)); break;
      case 'next': selectDate(addDays(selectedKey,1)); break;
      case 'today': selectDate(todayKey); break;
      case 'calendar': showCalendar(); break;
      case 'entries': showEntries(); break;
      case 'settings': showSettings(); break;
      case 'about': showAbout(); break;
      case 'export': exportDiary(); break;
    }
  }
  function nativeEvent(event) {
    const p = event.payload || {}, requestId = event.requestId;
    if (pending.has(requestId)) {
      pending.delete(requestId);
      if (event.type === 'saved') showToast('Diary exported');
      else if (event.type === 'error') showToast(p.message || 'Export failed', 5000);
      else if (event.type === 'cancelled') showToast('Export cancelled');
    }
    if (event.type === 'bootstrap') bootstrap(p);
  }
  function bindEvents() {
    $('menuButton').addEventListener('click', e => { e.stopPropagation(); $('menuPopover').hidden = !$('menuPopover').hidden; });
    $('menuPopover').addEventListener('click', e => { const button = e.target.closest('[data-action]'); if (button) handleAction(button.dataset.action); });
    for (const button of document.querySelectorAll('.bottom-nav [data-action]')) button.addEventListener('click', () => handleAction(button.dataset.action));
    $('previousDay').addEventListener('click', () => handleAction('previous'));
    $('calendarBack').addEventListener('click', closeCalendar);
    $('editor').addEventListener('input', () => { updateMeta(); updateLineNumbers(); scheduleAutosave(); });
    $('editor').addEventListener('scroll', () => { $('lineNumbers').scrollTop = $('editor').scrollTop; });
    $('dialogClose').addEventListener('click', () => finishDialog(null));
    $('dialogBackdrop').addEventListener('click', e => { if (e.target === $('dialogBackdrop')) finishDialog(null); });
    document.addEventListener('click', e => { if (!e.target.closest('#menuPopover') && !e.target.closest('#menuButton')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && handleBack()) e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSession(); }); window.addEventListener('pagehide', flushSession);
  }
  function handleBack() {
    if (!$('dialogBackdrop').hidden) { finishDialog(null); return true; }
    if (!$('calendarPage').hidden) { closeCalendar(); return true; }
    if (!$('menuPopover').hidden) { closeMenu(); return true; }
    return false;
  }
  bindEvents();
  setInterval(renderClock, 30000); clockTimer = setInterval(renderClock, 30000);
  window.App = {nativeEvent, flushSession, handleBack};
  native('ready');
}());
