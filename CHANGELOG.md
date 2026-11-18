# ADiaryT 1.6

- Show autosave history at minute-level precision, grouping saves within the same minute and displaying their count and last edited line.
- Keep saving entry text at each autosave and preserve the exact last save time internally; seconds no longer make duplicate visible rows.
- Merge existing same-minute log entries when loading older saved state.
- Android version 1.6 (version code 16), packaged as `ADiaryT-v1.6.apk`.

# ADiaryT 1.5

- Tap the saved time at the bottom right to open the selected day's autosave time log.
- Keep time logs on the device across restarts, with newest times first and the chosen 12-hour or 24-hour clock format.
- Include the line where the last edit ended with each new autosave; show “Line not recorded” for older saves that have no line metadata.
- Record saves when text actually changes, including clearing text and saving pending edits when leaving the day or backgrounding the app.
- Preserve the last known save time from older app versions, clearly noting that earlier times were not recorded.
- Android version 1.5 (version code 15), packaged as `ADiaryT-v1.5.apk`.

# ADiaryT 1.4

- Keep one shared bottom navigation bar visible on the diary and full-page calendar.
- Remove Settings from the navigation bar and three-dot menu.
- Add direct Dark mode and Clock format options to the three-dot menu on both pages.
- Persist both preferences without replacing or resetting diary text.
- Android version 1.4 (version code 14), packaged as `ADiaryT-v1.4.apk`.

# ADiaryT 1.3

- Open the calendar as a full page with a back button, instead of a popup window.
- Show the corresponding Solar Hijri month names in smaller text below the Gregorian month heading.
- Show both Solar months when a Gregorian month crosses their boundary, including both years at Nowruz.
- Keep future-date previews, two-row day numbers, and read-only past entries.
- Android version 1.3 (version code 13), packaged as `ADiaryT-v1.3.apk`.

# ADiaryT 1.2

- Browse future calendar months and years, and tap future dates to preview their Gregorian and Solar Hijri dates.
- Keep future previews inside the calendar; diary writing remains limited to today, and past entries stay read only.
- Preserve the two-row calendar layout with the smaller Solar Hijri day below the Gregorian day.
- Set the Android app version to 1.2 and version code to 12 for upgrades from earlier builds.
- Derive the APK filename from the app version and verify that the packaged version matches: `ADiaryT-v1.2.apk`.
- Add browser checks for calendar navigation, date previews, read-only history, offline loading, and phone/tablet layout.

## Upstream editor history: AnoteP 1.0

First Android release. Independent Notepad++ inspired editor with a black
adaptive launcher icon featuring a penguin, classic light and optional dark
themes, and two rows of menus and tool icons.

- Fully local editing, all language modes bundled, no Internet permission,
  no accounts or analytics, and Android cloud backup disabled.
- Tabs, local unsaved-work recovery, syntax highlighting, automatic language
  detection from filenames and contents, and per-document language overrides.
- Literal and regex find/replace, capture groups, search in open tabs and local
  folders, bookmarks, folding, split views, line transforms, and macros.
- Shift/Ctrl/Alt modifier buttons, an inverted T arrow cluster, shortcut keys,
  and symbols. Menus stay open when the Android keyboard dismisses.
- Local Android file/folder pickers, text encoding and line-ending controls,
  and a conflict prompt when a file changes outside AnoteP.

Android 8.0+ and a current Android System WebView. 8 MB per file, 30 tabs,
32 MB recovery workspace. Desktop Notepad++ plugins and full feature parity
are outside this release.
