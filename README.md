# ADiaryT

ADiaryT is a private, fully offline Android diary with a Notepad++-inspired writing surface.

- App name: **ADiaryT**
- Android package: **`app.adiaryt`**
- Android 8.0+ / ARM64 compatible
- No accounts, ads, analytics, network permission, or cloud sync
- Automatic recovery to private on-device storage
- Uses the device clock and date
- Shows Gregorian dates alongside Iranian Solar Hijri months
- The current entry autosaves after typing pauses and records the save time
- Tap the saved time at the bottom right to see that day's autosave times, including seconds and the last edited line number, in your chosen clock format
- Autosave time logs stay on the device and survive restarts; older entries can show only the last time recorded by earlier app versions
- Previous dates become read-only after the day changes
- Calendar and entry browser are available from the bottom navigation
- Calendar can browse future months and preview future dates; diary writing remains available only for today
- Calendar opens as a full page, with smaller Solar Hijri month names below the Gregorian month heading
- The bottom navigation remains available on the calendar page; Dark mode and Clock format are direct three-dot menu options
- Diary export uses Android’s local document picker

## Build

The build is offline and uses the Android tools already configured in this workspace:

```sh
bash scripts/build.sh
```

The current release is **1.5** (Android version code **15**), written to `dist/ADiaryT-v1.5.apk`.

For the next release, use **1.6** with a higher Android version code (for example, **16**), then **1.7**, and so on. Set `android:versionName` and `android:versionCode` in `app/src/main/AndroidManifest.xml`. The build derives the APK filename from that version and verifies the packaged version and filename match. GitHub release tags and assets use the same version, such as `v1.5` and `ADiaryT-v1.5.apk`.

Calendar integration checks use a separately installed Playwright browser:

```sh
ADIARYT_PLAYWRIGHT=/path/to/node_modules/playwright node scripts/diary-browser-test.cjs
```
