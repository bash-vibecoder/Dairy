package app.adiaryt;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.util.AtomicFile;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import org.json.JSONObject;

/** Offline diary host: WebView UI plus an atomic private recovery snapshot. */
public final class MainActivity extends Activity {
    private static final int SAVE = 401;
    private static final int OPEN = 402;
    private static final int MAX_STATE_BYTES = 32 * 1024 * 1024;
    private static final int MAX_BACKUP_BYTES = 64 * 1024 * 1024;
    private static final int TRANSFER_CHUNK_BYTES = 96 * 1024;
    private WebView web;
    private AtomicFile stateFile;
    private boolean ready;
    private boolean pickerBusy;
    private byte[] pendingExport;
    private String pendingExportRequest = "";
    private String transferRequest = "";
    private String transferName;
    private ByteArrayOutputStream pendingExportStream;
    private String pendingImportRequest = "";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        stateFile = new AtomicFile(new File(getFilesDir(), "adiaryt-state.json"));
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.setBackgroundColor(Color.WHITE);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new DiaryBridge(), "ADiaryTNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!"https".equals(url.getScheme()) || !"adiaryt.local".equals(url.getHost())) return blocked();
                String path = url.getPath();
                if (path == null || path.contains("..") || path.contains("\\")) return blocked();
                if ("/".equals(path)) path = "/index.html";
                String asset = path.substring(1);
                try {
                    String mime = asset.endsWith(".html") ? "text/html" : asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : asset.endsWith(".ttf") ? "font/ttf" : "text/plain";
                    java.util.HashMap<String,String> headers = new java.util.HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(asset));
                } catch (IOException missing) { return blocked(); }
            }
        });
        setContentView(web);
        web.loadUrl("https://adiaryt.local/index.html");
    }

    private WebResourceResponse blocked() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }

    private final class DiaryBridge {
        @JavascriptInterface public boolean dispatch(String raw) {
            String request = "";
            try {
                if (raw == null || raw.length() > MAX_BACKUP_BYTES + 1024) throw new IOException("Diary data is too large to save.");
                JSONObject command = new JSONObject(raw);
                String type = command.optString("type"); request = command.optString("requestId");
                JSONObject payload = command.optJSONObject("payload");
                if (payload == null) payload = new JSONObject();
                if ("ready".equals(type)) runOnUiThread(MainActivity.this::bootstrap);
                else if ("persist".equals(type)) persist(payload);
                else if ("theme".equals(type)) { final JSONObject p = payload; runOnUiThread(() -> applyTheme(p.optBoolean("dark"))); }
                else if ("saveStart".equals(type)) beginExport(payload, request);
                else if ("saveChunk".equals(type)) appendExportChunk(payload, request);
                else if ("saveComplete".equals(type)) prepareExport(request);
                else if ("open".equals(type)) prepareImport(request);
                return true;
            } catch (Exception error) { emit("error", object("message", message(error)), request); return false; }
        }
    }

    private void bootstrap() {
        if (ready) return;
        ready = true;
        new Thread(() -> {
            JSONObject state = new JSONObject();
            try (InputStream in = stateFile.openRead()) { state = new JSONObject(new String(readLimited(in, MAX_STATE_BYTES), StandardCharsets.UTF_8)); }
            catch (java.io.FileNotFoundException firstRun) { }
            catch (Exception damaged) { emit("error", object("message", "The local diary snapshot could not be loaded."), ""); }
            emit("bootstrap", state, "");
        }).start();
    }

    private void persist(JSONObject state) throws Exception {
        byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_STATE_BYTES) throw new IOException("Diary storage is limited to 32 MB.");
        FileOutputStream output = null;
        try { output = stateFile.startWrite(); output.write(bytes); stateFile.finishWrite(output); }
        catch (IOException e) { if (output != null) stateFile.failWrite(output); throw e; }
    }

    private synchronized void beginExport(JSONObject payload, String request) {
        pendingExportStream = new ByteArrayOutputStream();
        transferName = payload.optString("name", "adiary-backup.adiary");
        transferRequest = request;
    }

    private synchronized void appendExportChunk(JSONObject payload, String request) throws Exception {
        if (pendingExportStream == null || !request.equals(transferRequest)) throw new IOException("The encrypted backup transfer expired.");
        byte[] block = Base64.decode(payload.getString("data"), Base64.NO_WRAP);
        if (pendingExportStream.size() + block.length > MAX_BACKUP_BYTES) {
            pendingExportStream = null;
            throw new IOException("Encrypted backups are limited to 64 MB.");
        }
        pendingExportStream.write(block);
    }

    private void prepareExport(String request) throws Exception {
        final byte[] bytes;
        final String name;
        synchronized (this) {
            if (pendingExportStream == null || !request.equals(transferRequest)) throw new IOException("The encrypted backup transfer expired.");
            bytes = pendingExportStream.toByteArray();
            pendingExportStream = null;
            name = transferName;
        }
        runOnUiThread(() -> {
            if (pickerBusy) { emit("error", object("message", "Finish the current file operation first."), request); return; }
            pendingExport = bytes;
            pendingExportRequest = request;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/octet-stream").addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_TITLE, name); intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            try { pickerBusy = true; startActivityForResult(intent, SAVE); }
            catch (Exception error) { pickerBusy = false; clearExport(); emit("error", object("message", message(error)), request); }
        });
    }

    private void prepareImport(String request) {
        runOnUiThread(() -> {
            if (pickerBusy) { emit("error", object("message", "Finish the current file operation first."), request); return; }
            pendingImportRequest = request;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            try { pickerBusy = true; startActivityForResult(intent, OPEN); }
            catch (Exception error) { pickerBusy = false; pendingImportRequest = ""; emit("error", object("message", message(error)), request); }
        });
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data); pickerBusy = false;
        if (request == SAVE) {
            if (result != RESULT_OK || data == null || data.getData() == null) { emit("cancelled", new JSONObject(), pendingExportRequest); clearExport(); return; }
            if (pendingExport == null) return;
            Uri uri = data.getData(); final byte[] bytes = pendingExport; final String id = pendingExportRequest; clearExport();
            new Thread(() -> {
                try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new IOException("The selected location cannot be written.");
                    out.write(bytes); out.flush(); emit("saved", object("name", "encrypted diary backup"), id);
                } catch (Exception error) { emit("error", object("message", message(error)), id); }
            }).start();
        } else if (request == OPEN) {
            final String id = pendingImportRequest; pendingImportRequest = "";
            if (result != RESULT_OK || data == null || data.getData() == null) { emit("cancelled", new JSONObject(), id); return; }
            Uri uri = data.getData();
            new Thread(() -> {
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new IOException("The selected file cannot be read.");
                    byte[] bytes = readLimited(in, MAX_BACKUP_BYTES);
                    emit("importStart", object("bytes", bytes.length), id);
                    for (int offset = 0; offset < bytes.length; offset += TRANSFER_CHUNK_BYTES) {
                        int length = Math.min(TRANSFER_CHUNK_BYTES, bytes.length - offset);
                        byte[] chunk = Arrays.copyOfRange(bytes, offset, offset + length);
                        emit("importChunk", object("data", Base64.encodeToString(chunk, Base64.NO_WRAP)), id);
                    }
                    emit("importComplete", new JSONObject(), id);
                } catch (Exception error) { emit("error", object("message", message(error)), id); }
            }).start();
        }
    }
    private void clearExport() { pendingExport = null; pendingExportRequest = ""; }
    private static byte[] readLimited(InputStream input, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] block = new byte[8192]; int count;
        while ((count = input.read(block)) != -1) { if (out.size() + count > max) throw new IOException("Diary storage is too large."); out.write(block, 0, count); }
        return out.toByteArray();
    }
    private void applyTheme(boolean dark) {
        getWindow().setStatusBarColor(Color.parseColor(dark ? "#202320" : "#eee9df")); getWindow().setNavigationBarColor(Color.parseColor(dark ? "#30352f" : "#eee9df"));
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }
    @Override public void onBackPressed() { web.evaluateJavascript("window.App?App.handleBack():false", result -> { if (!"true".equals(result)) { web.evaluateJavascript("window.App&&App.flushSession()", null); moveTaskToBack(true); } }); }
    @Override protected void onPause() { if (ready) web.evaluateJavascript("window.App&&App.flushSession()", null); super.onPause(); }
    @Override protected void onDestroy() { if (web != null) { web.removeJavascriptInterface("ADiaryTNative"); web.destroy(); } super.onDestroy(); }
    private void emit(String type, JSONObject payload, String request) {
        JSONObject event = object("type", type, "payload", payload, "requestId", request); final String json = event.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        runOnUiThread(() -> { if (web != null && !isFinishing() && !isDestroyed()) web.evaluateJavascript("window.App&&App.nativeEvent(" + json + ")", null); });
    }
    private static JSONObject object(Object... values) { JSONObject out = new JSONObject(); try { for (int i=0;i<values.length;i+=2) out.put((String)values[i], values[i+1]); } catch (Exception impossible) { throw new IllegalArgumentException(impossible); } return out; }
    private static String message(Exception e) { return e.getMessage() == null ? "The local diary operation failed." : e.getMessage(); }
}
