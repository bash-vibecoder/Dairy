# ADiaryT

ADiaryT is a private, fully offline Android diary with a Notepad++-inspired writing surface.

- App name: **ADiaryT**
- Android package: **`app.adiaryt`**
- Android 8.0+ / ARM64 compatible
- No accounts, ads, analytics, network permission, or cloud sync
- Automatic recovery to private on-device storage
- Uses the device clock and date
- Shows how many days a selected date is from today or how many days before today it was
- Shows Gregorian dates alongside Iranian Solar Hijri months
- The current entry autosaves after typing pauses and records the save time
- Separate Diary and Notes tabs keep independent writing and autosave history for each date; both save offline after typing pauses
- Diary is editable only today; Notes are editable today and on future dates, and both sections are read-only for past dates
- Selecting any date on the calendar opens that date's Notes tab; future Diary entries remain read only
- Export complete Diary and Notes backups in password-protected `.adiary` files using AES-256-GCM encryption; restore them offline with the password. Import replaces matching dates after confirmation and keeps other dates already on the device
- Tap the saved time at the bottom right to see that day's autosaves grouped into five-minute blocks (for example, 18:30–18:34), with a save count, the last edited line, and your chosen clock format
- Tap a block in the autosave log to see the words added during those five minutes; the log closes and new words highlight green in the diary for five seconds, including additions to earlier lines
- Text still autosaves after typing pauses; existing one-minute logs combine into five-minute blocks when loaded
- Uses locally bundled Lora and Noto Naskh Arabic fonts for readable English and Persian diary text
- Autosave time logs stay on the device and survive restarts; older entries can show only the last time recorded by earlier app versions
- Past Diary and Notes entries become read-only after the day changes
- Automatically opens a fresh, editable entry for today after midnight or after reopening the app
- Calendar and entry browser are available from the bottom navigation
- Calendar can browse future months; selecting a date opens Notes, which can also be written ahead. Diary writing remains available only for today
- Calendar opens as a full page, with smaller Solar Hijri month names below the Gregorian month heading
- The bottom navigation remains available on the calendar page; Dark mode and Clock format are direct three-dot menu options
- Diary export uses Android’s local document picker

## Build

The build is offline and uses the Android tools already configured in this workspace:

```sh
bash scripts/build.sh
```

The current release is **1.12** (Android version code **22**), written to `dist/ADiaryT-v1.12.apk`.

For the next release, use **1.13** with a higher Android version code (for example, **23**), then **1.14**, and so on. Set `android:versionName` and `android:versionCode` in `app/src/main/AndroidManifest.xml`. The build derives the APK filename from that version and verifies the packaged version and filename match. GitHub release tags and assets use the same version, such as `v1.12` and `ADiaryT-v1.12.apk`.

Calendar integration checks use a separately installed Playwright browser:

```sh
ADIARYT_PLAYWRIGHT=/path/to/node_modules/playwright node scripts/diary-browser-test.cjs
```
