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
- Diary export uses Android’s local document picker

## Build

The build is offline and uses the Android tools already configured in this workspace:

```sh
bash scripts/build.sh
```

The release APK is written to `dist/ADiaryT-v1.0.apk`.
