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
- Previous dates become read-only after the day changes
- Calendar and entry browser are available from the bottom navigation
- Calendar can browse future months and preview future dates; diary writing remains available only for today
- Diary export uses Android’s local document picker

## Build

The build is offline and uses the Android tools already configured in this workspace:

```sh
bash scripts/build.sh
```

The current release is **1.2** (Android version code **12**), written to `dist/ADiaryT-v1.2.apk`.

For the next release, use **1.3** with a higher Android version code (for example, **13**), then **1.4**, and so on. Set `android:versionName` and `android:versionCode` in `app/src/main/AndroidManifest.xml`. The build derives the APK filename from that version and verifies the packaged version and filename match. GitHub release tags and assets use the same version, such as `v1.2` and `ADiaryT-v1.2.apk`.

Calendar integration checks use a separately installed Playwright browser:

```sh
ADIARYT_PLAYWRIGHT=/path/to/node_modules/playwright node scripts/diary-browser-test.cjs
```
