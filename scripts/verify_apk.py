#!/usr/bin/env python3
"""Check the packaged manifest, offline assets, and executable payload."""
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

apk = Path(sys.argv[1])
source_manifest = ET.parse(Path(__file__).resolve().parents[1] / 'app/src/main/AndroidManifest.xml').getroot()
android = '{http://schemas.android.com/apk/res/android}'
version = source_manifest.attrib[android + 'versionName']
version_code = source_manifest.attrib[android + 'versionCode']
expected_name = f'ADiaryT-v{version}' + ('-debug' if 'debug' in apk.name.lower() else '') + '.apk'
assert apk.name == expected_name, f'APK filename must match Android version: {expected_name}'
permissions = subprocess.check_output(['aapt', 'dump', 'permissions', str(apk)], text=True)
assert 'uses-permission' not in permissions, permissions
manifest = subprocess.check_output(['aapt', 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
assert re.search(r'allowBackup[^\n]*0x0', manifest), 'Android backup must be disabled'
assert re.search(r'usesCleartextTraffic[^\n]*0x0', manifest), 'Cleartext traffic must be disabled'
if 'debug' not in apk.name.lower():
    assert not re.search(r'debuggable[^\n]*0xffffffff', manifest), 'Release must not be debuggable'
badging = subprocess.check_output(['aapt', 'dump', 'badging', str(apk)], text=True)
assert "package: name='app.adiaryt'" in badging
assert f"versionName='{version}'" in badging, 'Packaged version name differs from source'
assert f"versionCode='{version_code}'" in badging, 'Packaged version code differs from source'
assert "application-label:'ADiaryT'" in badging
assert "sdkVersion:'26'" in badging
assert "targetSdkVersion:'34'" in badging
with ZipFile(apk) as archive:
    names = set(archive.namelist())
    for name in ['classes.dex', 'assets/index.html', 'assets/app.css', 'assets/app.js',
                 'assets/editor-core.js', 'assets/icon.svg', 'assets/licenses.txt',
                 'assets/vendor/codemirror.js', 'assets/vendor/codemirror.css',
                 'assets/vendor/LICENSE-CodeMirror.txt']:
        assert name in names, 'Missing packaged file: '+name
    html = archive.read('assets/index.html').decode()
    for path in re.findall(r'(?:src|href)="([^"#]+)"', html):
        assert not path.startswith(('http:', 'https:', '//')), 'Remote asset: '+path
        assert 'assets/'+path in names, 'Missing referenced asset: '+path
    assert not any(name.endswith(('.jks', '.keystore')) for name in names), 'Signing keys must not be packaged'
    assert 'res/mipmap-anydpi-v26/ic_launcher.xml' in names, 'Adaptive icon must be packaged'
print(f'APK verified: ADiaryT {version} (code {version_code}), matching filename, Android 8+, no permissions, backup disabled, all assets bundled.')
