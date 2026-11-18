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
  let pendingSaveLine = null;
  let clockTimer = 0;
  let toastTimer = 0;
  let calendarCursor = new Date();
  let dialogResolve = null;
  let autosaveLogKey = '';
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
    return {version:3, settings, selectedKey, entries:copy};
  }
  function persistNow() {
    clearTimeout(persistTimer);
    if (!restored) return;
    const state = stateSnapshot();
    saveLocal(state);
    native('persist', state);
  }
  function schedulePersist() { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 450); }
  function flushSession() {
    clearTimeout(typingTimer);
    if (selectedKey && $('editor')) {
      commitCurrent();
      if (selectedKey === todayKey) {
        const saved = !!currentEntry().savedAt;
        $('saveState').className = saved ? 'save-state saved' : 'save-state';
        $('saveState').innerHTML = '<i class="status-dot"></i><span>' + (saved ? 'Saved' : 'Ready') + '</span>';
      }
    }
    persistNow();
  }

  function getEntry(key) {
    if (!entries[key] || typeof entries[key] !== 'object') entries[key] = {key, text:'', savedAt:'', updatedAt:'', saveLog:[]};
    return entries[key];
  }
  function validTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function localMinuteKey(value) {
    const date = new Date(value);
    return [date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes()].join(':');
  }
  function normalizeSaveLog(log) {
    const result = [];
    for (const item of log) {
      if (!item || !validTimestamp(item.at)) continue;
      const source = item.source === 'legacy' ? 'legacy' : 'autosave';
      const count = source === 'autosave' && Number.isSafeInteger(item.count) && item.count > 0 ? item.count : 1;
      const normalized = {at:item.at, source, line:Number.isSafeInteger(item.line) && item.line > 0 ? item.line : null, count};
      const previous = result[result.length - 1];
      if (source === 'autosave' && previous?.source === 'autosave' && localMinuteKey(previous.at) === localMinuteKey(item.at)) {
        previous.at = item.at;
        previous.line = normalized.line || previous.line;
        previous.count += count;
      } else result.push(normalized);
    }
    return result;
  }
  function migrateDocuments(state) {
    const result = {};
    if (state && state.entries && typeof state.entries === 'object') {
      for (const [key, value] of Object.entries(state.entries)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue;
        const savedAt = validTimestamp(value.savedAt) ? value.savedAt : validTimestamp(value.updatedAt) ? value.updatedAt : '';
        const saveLog = Array.isArray(value.saveLog) ? normalizeSaveLog(value.saveLog) : [];
        if (!saveLog.length && savedAt) saveLog.push({at:savedAt, source:'legacy', line:null, count:1});
        result[key] = {key, text:typeof value.text === 'string' ? value.text : '', savedAt,
          updatedAt:validTimestamp(value.updatedAt) ? value.updatedAt : savedAt, saveLog};
      }
    }
    // A workspace saved by the reference editor can still be opened as a diary.
    if (!Object.keys(result).length && Array.isArray(state && state.documents)) {
      for (const doc of state.documents) {
        const match = String(doc.name || '').match(/(\d{4}-\d{2}-\d{2})/);
        if (match) result[match[1]] = {key:match[1], text:doc.text || '', savedAt:'', updatedAt:'', saveLog:[]};
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
    updateMenuPreferences();
  }
  function updateMenuPreferences() {
    $('menuDarkMode').setAttribute('aria-pressed', String(!!settings.dark));
    $('darkModeValue').textContent = settings.dark ? 'On' : 'Off';
    $('clockFormatValue').textContent = settings.use24Hour ? '24-hour' : '12-hour';
  }
  function updateNavigation() {
    const calendarOpen = !$('calendarPage').hidden;
    $('bottomToday').classList.toggle('active', !calendarOpen && selectedKey === todayKey);
    $('bottomCalendar').classList.toggle('active', calendarOpen);
    for (const id of ['bottomToday', 'bottomCalendar']) {
      if ($(id).classList.contains('active')) $(id).setAttribute('aria-current', 'page');
      else $(id).removeAttribute('aria-current');
    }
  }
  function currentEntry() { return getEntry(selectedKey); }
  function editorLine() { return $('editor').value.slice(0, $('editor').selectionEnd).split('\n').length; }
  function commitCurrent() {
    if (!restored || selectedKey !== todayKey || !$('editor')) { pendingSaveLine = null; return false; }
    const entry = currentEntry();
    const text = $('editor').value;
    if (entry.text === text) { pendingSaveLine = null; return false; }
    const at = isoNow();
    entry.text = text; entry.updatedAt = at; entry.savedAt = at;
    const line = pendingSaveLine || editorLine();
    const latest = entry.saveLog[entry.saveLog.length - 1];
    if (latest?.source === 'autosave' && localMinuteKey(latest.at) === localMinuteKey(at)) {
      latest.at = at; latest.line = line; latest.count = (latest.count || 1) + 1;
    } else entry.saveLog.push({at, source:'autosave', line, count:1});
    pendingSaveLine = null;
    updateSavedAt(entry); refreshAutosaveLog();
    return true;
  }
  function scheduleAutosave() {
    if (isLocked(selectedKey)) return;
    pendingSaveLine = editorLine();
    clearTimeout(typingTimer);
    const state = $('saveState'); state.className = 'save-state saving'; state.innerHTML = '<i class="status-dot"></i><span>Typing…</span>';
    typingTimer = setTimeout(flushSession, 900);
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
    $('savedAt').textContent = entry.savedAt ? 'Saved at ' + nowTime(new Date(entry.savedAt)) : 'Not saved yet';
    $('savedAt').setAttribute('aria-label', 'Show autosave times for ' + longDate(fromKey(selectedKey)) + '. ' + $('savedAt').textContent);
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
    updateNavigation();
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
      clearTimeout(typingTimer); commitCurrent();
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
    commitCurrent();
    selectedKey = key; getEntry(key); renderDate(); closeMenu(); persistNow();
  }

  function textNode(tag, text, cls) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
  function dialog(title, body, buttons = [{label:'OK', value:'ok', className:'primary'}]) {
    $('dialogTitle').textContent = title; $('dialogBody').replaceChildren(body); const actions = $('dialogActions'); actions.replaceChildren();
    for (const button of buttons) { const el = textNode('button', button.label); if (button.className) el.className = button.className; el.addEventListener('click', () => finishDialog(typeof button.value === 'function' ? button.value() : button.value)); actions.append(el); }
    $('dialogBackdrop').hidden = false;
    return new Promise(resolve => { dialogResolve = resolve; });
  }
  function finishDialog(value) { $('dialogBackdrop').hidden = true; autosaveLogKey = ''; const resolve = dialogResolve; dialogResolve = null; if (resolve) resolve(value); }
  function closeMenu() {
    $('menuPopover').hidden = true;
    for (const button of document.querySelectorAll('[data-open-menu]')) button.setAttribute('aria-expanded', 'false');
  }

  function autosaveLogBody(key) {
    const body = textNode('div', '', 'autosave-log');
    const date = textNode('p', '', 'autosave-log-date');
    date.append(textNode('strong', new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(fromKey(key))), textNode('span', jalaliLabel(key)));
    body.append(date);
    const log = getEntry(key).saveLog;
    if (!log.length) {
      body.append(textNode('p', 'No autosave times have been recorded for this day yet.', 'hint'));
      return body;
    }
    const hasLegacy = log.some(item => item.source === 'legacy');
    const autoCount = log.reduce((sum,item) => sum + (item.source === 'autosave' ? item.count || 1 : 0), 0);
    const minuteCount = log.filter(item => item.source === 'autosave').length;
    const summary = [autoCount + (autoCount === 1 ? ' autosave' : ' autosaves'), minuteCount + (minuteCount === 1 ? ' minute' : ' minutes'), 'newest first'].join(' · ');
    body.append(textNode('p', summary + (hasLegacy ? ' · plus last known save' : ''), 'hint'));
    const list = textNode('ol', '', 'autosave-log-list');
    for (const item of [...log].reverse()) {
      const row = textNode('li', '', 'autosave-log-row');
      const at = new Date(item.at);
      const time = textNode('time', new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hour12:!settings.use24Hour}).format(at));
      time.dateTime = item.at;
      const details = textNode('span', '', 'autosave-log-details');
      const description = item.source === 'legacy' ? 'Last known save' : (item.count || 1) + ((item.count || 1) === 1 ? ' autosave this minute' : ' autosaves this minute');
      details.append(textNode('strong', item.line ? 'Line ' + item.line : 'Line not recorded', 'autosave-log-line'), textNode('small', description, 'hint'));
      row.append(time, details);
      if (dateKey(at) !== key) row.append(textNode('small', new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(at), 'hint'));
      list.append(row);
    }
    body.append(list);
    body.append(textNode('p', 'Autosaves are grouped by minute. The line shows where the last edit ended; each autosave saves the whole entry.', 'hint autosave-log-note'));
    if (hasLegacy) body.append(textNode('p', 'Earlier app versions kept only the last saved time. Older autosave times are unavailable.', 'hint autosave-legacy-note'));
    return body;
  }
  function refreshAutosaveLog() {
    if (autosaveLogKey && !$('dialogBackdrop').hidden) $('dialogBody').replaceChildren(autosaveLogBody(autosaveLogKey));
  }
  function showAutosaveLog() {
    closeMenu();
    autosaveLogKey = selectedKey;
    dialog('Autosave times', autosaveLogBody(selectedKey), [{label:'Close',value:null}]);
  }

  function closeCalendar() {
    closeMenu();
    $('calendarPage').hidden = true;
    $('app').hidden = false;
    updateNavigation();
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
    updateNavigation();
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
      row.append(main,textNode('span',isLocked(key) ? '▣' : '›','row-lock')); row.addEventListener('click', () => { selectDate(key); if (!$('calendarPage').hidden) closeCalendar(); finishDialog(true); }); body.append(row);
    }
    dialog('Entries',body,[{label:'Close',value:null}]);
  }
  function showClockFormat() {
    closeMenu(); const body = document.createElement('div');
    const choices = [];
    for (const [value, label] of [['24', '24-hour'], ['12', '12-hour']]) {
      const row = textNode('label', '', 'clock-format-row');
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'clock-format'; radio.value = value;
      radio.checked = value === (settings.use24Hour ? '24' : '12');
      row.append(radio, document.createTextNode(label)); body.append(row); choices.push(radio);
    }
    dialog('Clock format',body,[{label:'Cancel',value:false},{label:'Save',value:true,className:'primary'}]).then(ok => {
      if (!ok) return;
      settings.use24Hour = choices.find(input => input.checked).value === '24';
      renderClock();
      $('dateSubtitle').textContent = jalaliLabel(selectedKey) + ' · ' + nowTime();
      updateSavedAt(currentEntry()); updateMenuPreferences(); schedulePersist();
    });
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
      case 'previous': selectDate(addDays(selectedKey,-1)); if (!$('calendarPage').hidden) closeCalendar(); break;
      case 'next': selectDate(addDays(selectedKey,1)); if (!$('calendarPage').hidden) closeCalendar(); break;
      case 'today': selectDate(todayKey); if (!$('calendarPage').hidden) closeCalendar(); break;
      case 'calendar': if ($('calendarPage').hidden) showCalendar(); else closeMenu(); break;
      case 'entries': showEntries(); break;
      case 'darkMode': closeMenu(); settings.dark = !settings.dark; applyTheme(); schedulePersist(); break;
      case 'clockFormat': showClockFormat(); break;
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
    for (const button of document.querySelectorAll('[data-open-menu]')) button.addEventListener('click', e => {
      e.stopPropagation();
      if (!$('menuPopover').hidden) { closeMenu(); return; }
      updateMenuPreferences(); $('menuPopover').hidden = false; button.setAttribute('aria-expanded', 'true');
    });
    $('menuPopover').addEventListener('click', e => { const button = e.target.closest('[data-action]'); if (button) handleAction(button.dataset.action); });
    for (const button of document.querySelectorAll('.bottom-nav [data-action]')) button.addEventListener('click', () => handleAction(button.dataset.action));
    $('previousDay').addEventListener('click', () => handleAction('previous'));
    $('calendarBack').addEventListener('click', closeCalendar);
    $('savedAt').addEventListener('click', showAutosaveLog);
    $('editor').addEventListener('input', () => { updateMeta(); updateLineNumbers(); scheduleAutosave(); });
    $('editor').addEventListener('scroll', () => { $('lineNumbers').scrollTop = $('editor').scrollTop; });
    $('dialogClose').addEventListener('click', () => finishDialog(null));
    $('dialogBackdrop').addEventListener('click', e => { if (e.target === $('dialogBackdrop')) finishDialog(null); });
    document.addEventListener('click', e => { if (!e.target.closest('#menuPopover') && !e.target.closest('[data-open-menu]')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && handleBack()) e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSession(); }); window.addEventListener('pagehide', flushSession);
  }
  function handleBack() {
    if (!$('dialogBackdrop').hidden) { finishDialog(null); return true; }
    if (!$('menuPopover').hidden) { closeMenu(); return true; }
    if (!$('calendarPage').hidden) { closeCalendar(); return true; }
    return false;
  }
  bindEvents();
  setInterval(renderClock, 30000); clockTimer = setInterval(renderClock, 30000);
  window.App = {nativeEvent, flushSession, handleBack};
  native('ready');
}());
