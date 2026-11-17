package app.anotep.editor;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Native local-file access. The bundled editor has no network permission or remote content. */
public final class MainActivity extends Activity {
    private static final int OPEN = 101, SAVE = 102, FOLDER = 103;
    private WebView web;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private AtomicFile workspace;
    private boolean ready, pickerBusy;
    private JSONObject pendingSave;
    private byte[] pendingBytes;
    private String pendingSaveRequest = "";
    private String folderUri = "";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        workspace = new AtomicFile(new File(getFilesDir(), "workspace.json"));
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.setBackgroundColor(Color.WHITE);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setBlockNetworkLoads(true);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setSafeBrowsingEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new LocalBridge(), "AnotePNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!"https".equals(url.getScheme()) || !"anotep.local".equals(url.getHost())) return blocked();
                String path = url.getPath();
                if (path == null || path.contains("..") || path.contains("\\")) return blocked();
                if (path.equals("/")) path = "/index.html";
                try {
                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript"
                        : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : "text/plain";
                    HashMap<String, String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(path.substring(1)));
                } catch (IOException missing) { return blocked(); }
            }
        });
        setContentView(web);
        web.loadUrl("https://anotep.local/index.html");
    }

    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private final class LocalBridge {
        @JavascriptInterface public void dispatch(String raw) {
            try {
                if (raw.length() > EditorCore.MAX_SESSION_BYTES) throw new IOException("The workspace is too large to recover. Save and close some tabs.");
                JSONObject command = new JSONObject(raw);
                String type = command.getString("type"), request = command.optString("requestId");
                JSONObject payload = command.optJSONObject("payload");
                final JSONObject p = payload == null ? new JSONObject() : payload;
                switch (type) {
                    case "ready": runOnUiThread(() -> bootstrap()); break;
                    case "persist": submit(request, () -> persist(p)); break;
                    case "open": runOnUiThread(() -> openPicker()); break;
                    case "openUri": submit(request, () -> openDocument(Uri.parse(p.getString("uri")), p.optString("encoding"), p.optInt("line", 0))); break;
                    case "save": submit(request, () -> prepareSave(p, request)); break;
                    case "chooseFolder": runOnUiThread(() -> chooseFolder()); break;
                    case "listFolder": submit(request, () -> emit("folderListing", listFolder(Uri.parse(p.getString("uri"))), request)); break;
                    case "findInFiles": submit(request, () -> findInFiles(p, request)); break;
                    case "copy": runOnUiThread(() -> {
                        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                        clipboard.setPrimaryClip(ClipData.newPlainText("AnoteP", p.optString("text")));
                        emit("copied", new JSONObject(), request);
                    }); break;
                    case "paste": runOnUiThread(() -> {
                        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                        ClipData clip = clipboard.getPrimaryClip();
                        CharSequence value = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).coerceToText(MainActivity.this) : "";
                        emit("pasted", object("text", value == null ? "" : value.toString()), request);
                    }); break;
                    case "hideKeyboard": runOnUiThread(() -> ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(), 0)); break;
                    case "theme": runOnUiThread(() -> applyTheme(p.optBoolean("dark"))); break;
                    case "licenses": submit(request, () -> {
                        try (InputStream in = getAssets().open("licenses.txt")) {
                            emit("licenses", object("text", new String(EditorCore.readLimited(in, 100000), StandardCharsets.UTF_8)), request);
                        }
                    }); break;
                    default: error("Unknown editor request.", request);
                }
            } catch (Exception e) { error(message(e), ""); }
        }
    }

    private interface Work { void run() throws Exception; }
    private void submit(String request, Work work) {
        io.execute(() -> { try { work.run(); } catch (Exception e) { error(message(e), request); } });
    }

    private void bootstrap() {
        if (ready) return;
        ready = true;
        submit("", () -> {
            JSONObject state = new JSONObject();
            try (InputStream in = workspace.openRead()) {
                state = new JSONObject(new String(EditorCore.readLimited(in, EditorCore.MAX_SESSION_BYTES), StandardCharsets.UTF_8));
            } catch (java.io.FileNotFoundException firstRun) {
                // An empty workspace creates the first document in the editor.
            } catch (Exception damaged) {
                error("The recovery snapshot could not be loaded. Original files have not been changed.", "");
            }
            JSONObject settings = state.optJSONObject("settings");
            if (settings != null) folderUri = settings.optString("folderUri");
            emit("bootstrap", state, "");
            runOnUiThread(() -> handleIntent(getIntent()));
        });
    }

    private void persist(JSONObject state) throws Exception {
        JSONArray docs = state.optJSONArray("documents");
        if (docs == null || docs.length() > 30) throw new IOException("A workspace can contain at most 30 tabs.");
        byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > EditorCore.MAX_SESSION_BYTES) throw new IOException("Recovery storage is limited to 32 MB. Save and close some tabs.");
        FileOutputStream output = null;
        try {
            output = workspace.startWrite(); output.write(bytes); workspace.finishWrite(output);
        } catch (IOException e) { if (output != null) workspace.failWrite(output); throw e; }
    }

    private void openPicker() {
        if (pickerBusy) { error("Finish the current file picker first.", ""); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launchPicker(intent, OPEN);
    }

    private void chooseFolder() {
        if (pickerBusy) { error("Finish the current file picker first.", ""); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launchPicker(intent, FOLDER);
    }

    private void launchPicker(Intent intent, int code) {
        try { pickerBusy = true; startActivityForResult(intent, code); }
        catch (Exception e) { pickerBusy = false; error("No system file picker is available: " + message(e), pendingSaveRequest); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        pickerBusy = false;
        if (result != RESULT_OK || data == null) {
            if (request == SAVE) { emit("cancelled", new JSONObject(), pendingSaveRequest); clearPendingSave(); }
            return;
        }
        if (request == OPEN) {
            ClipData clip = data.getClipData();
            List<Uri> uris = new ArrayList<>();
            if (clip != null) for (int i = 0; i < Math.min(clip.getItemCount(), 30); i++) uris.add(clip.getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
            for (Uri uri : uris) {
                takePermission(uri, data.getFlags());
                submit("", () -> openDocument(uri, "", 0));
            }
        } else if (request == SAVE && data.getData() != null && pendingSave != null) {
            final Uri uri = data.getData();
            takePermission(uri, data.getFlags());
            final JSONObject payload = pendingSave;
            final byte[] bytes = pendingBytes;
            final String requestId = pendingSaveRequest;
            clearPendingSave();
            submit(requestId, () -> writeDocument(payload, uri, bytes, requestId, true));
        } else if (request == FOLDER && data.getData() != null) {
            Uri uri = data.getData(); takePermission(uri, data.getFlags());
            folderUri = uri.toString();
            submit("", () -> emit("folderChosen", object("uri", uri.toString(), "name", displayName(uri)), ""));
        }
    }

    private void clearPendingSave() { pendingSave = null; pendingBytes = null; pendingSaveRequest = ""; }
    private void takePermission(Uri uri, int flags) {
        try { getContentResolver().takePersistableUriPermission(uri, flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)); }
        catch (SecurityException temporaryGrant) { /* Some providers offer session grants only. */ }
    }

    private byte[] readBytes(Uri uri) throws IOException {
        validateUri(uri);
        try (InputStream in = getContentResolver().openInputStream(uri)) { return EditorCore.readLimited(in, EditorCore.MAX_FILE_BYTES); }
    }

    private void validateUri(Uri uri) throws IOException {
        if (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme())) throw new IOException("Only local document URIs can be opened.");
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        String path = uri.getLastPathSegment();
        return path == null ? "document.txt" : path.substring(path.lastIndexOf('/') + 1);
    }

    private void openDocument(Uri uri, String encoding, int line) throws Exception {
        byte[] bytes = readBytes(uri);
        EditorCore.Decoded text = EditorCore.decode(bytes, encoding);
        emit("opened", object("uri", uri.toString(), "name", displayName(uri), "text", text.text,
            "encoding", text.encoding, "eol", text.eol, "mixedEol", text.mixedEol,
            "fingerprint", EditorCore.fingerprint(bytes), "line", line, "reload", !encoding.isEmpty()), "");
    }

    private void prepareSave(JSONObject p, String request) throws Exception {
        byte[] bytes = EditorCore.encode(p.getString("text"), p.getString("encoding"), p.getString("eol"));
        if (p.optBoolean("saveAs") || p.optString("uri").isEmpty()) {
            runOnUiThread(() -> {
                if (pickerBusy) { error("Finish the current file picker first.", request); return; }
                pendingSave = p; pendingBytes = bytes; pendingSaveRequest = request;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("text/plain").addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_TITLE, p.optString("name", "document.txt"));
                intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                launchPicker(intent, SAVE);
            });
        } else writeDocument(p, Uri.parse(p.getString("uri")), bytes, request, p.optBoolean("force"));
    }

    private void writeDocument(JSONObject p, Uri uri, byte[] bytes, String request, boolean force) throws Exception {
        validateUri(uri);
        String expected = p.optString("fingerprint");
        if (!force && !expected.isEmpty() && !expected.equals(EditorCore.fingerprint(readBytes(uri)))) {
            emit("conflict", object("name", displayName(uri)), request); return;
        }
        // Encode and check the old fingerprint before opening a truncating output stream.
        try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IOException("The provider did not allow writing. Try Save As.");
            output.write(bytes); output.flush();
        }
        emit("saved", object("id", p.getString("id"), "uri", uri.toString(), "name", displayName(uri), "fingerprint", EditorCore.fingerprint(bytes)), request);
    }

    private static final String[] COLUMNS = {DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE};

    private JSONObject listFolder(Uri uri) throws Exception {
        if (folderUri.isEmpty()) throw new IOException("Choose a local folder first.");
        Uri root = Uri.parse(folderUri);
        if (!root.getAuthority().equals(uri.getAuthority()) || !DocumentsContract.getTreeDocumentId(root).equals(DocumentsContract.getTreeDocumentId(uri)))
            throw new IOException("Choose this folder before browsing it.");
        String id = DocumentsContract.isDocumentUri(this, uri) ? DocumentsContract.getDocumentId(uri) : DocumentsContract.getTreeDocumentId(uri);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(root, id);
        ArrayList<JSONObject> items = new ArrayList<>();
        boolean truncated = false;
        try (Cursor c = getContentResolver().query(children, COLUMNS, null, null, null)) {
            if (c == null) throw new IOException("This folder could not be read.");
            while (c.moveToNext()) {
                if (items.size() >= 1000) { truncated = true; break; }
                boolean directory = DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2));
                items.add(object("uri", DocumentsContract.buildDocumentUriUsingTree(root, c.getString(0)).toString(),
                    "name", c.getString(1), "directory", directory));
            }
        }
        Collections.sort(items, (a,b) -> {
            int directories = Boolean.compare(b.optBoolean("directory"), a.optBoolean("directory"));
            return directories != 0 ? directories : a.optString("name").compareToIgnoreCase(b.optString("name"));
        });
        return object("uri", uri.toString(), "entries", new JSONArray(items), "truncated", truncated);
    }

    private void findInFiles(JSONObject p, String request) throws Exception {
        String query = p.getString("query");
        if (query.isEmpty() || query.length() > 1000) throw new IOException("Enter a search up to 1,000 characters.");
        if (folderUri.isEmpty()) throw new IOException("Choose a local folder from File first.");
        String expression = p.optBoolean("regex") ? query : Pattern.quote(query);
        if (p.optBoolean("wholeWord")) expression = "\\b(?:" + expression + ")\\b";
        Pattern pattern = Pattern.compile(expression, p.optBoolean("caseSensitive") ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
        JSONArray matches = new JSONArray();
        ArrayList<Uri> folders = new ArrayList<>(); folders.add(Uri.parse(folderUri));
        int files = 0, skipped = 0, visitedFolders = 0;
        long bytesRead = 0;
        boolean limited = false;
        scan: while (!folders.isEmpty()) {
            if (++visitedFolders > 200) { limited = true; break; }
            JSONObject listing = listFolder(folders.remove(folders.size() - 1));
            if (listing.optBoolean("truncated")) limited = true;
            JSONArray entries = listing.getJSONArray("entries");
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.getJSONObject(i); Uri uri = Uri.parse(entry.getString("uri"));
                if (entry.getBoolean("directory")) { folders.add(uri); continue; }
                if (++files > 500 || bytesRead > 16 * 1024 * 1024) { limited = true; break scan; }
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    byte[] bytes = EditorCore.readLimited(in, 1024 * 1024); bytesRead += bytes.length;
                    String[] lines = EditorCore.decode(bytes, null).text.split("\n", -1);
                    for (int line = 0; line < lines.length; line++) {
                        java.util.regex.Matcher matcher = pattern.matcher(lines[line]);
                        if (!matcher.find()) continue;
                        int start = Math.max(0, matcher.start() - 50);
                        matches.put(object("uri", uri.toString(), "name", entry.getString("name"), "line", line + 1,
                            "snippet", lines[line].substring(start, Math.min(lines[line].length(), start + 180))));
                        if (matches.length() >= 200) { limited = true; break scan; }
                    }
                } catch (IOException | SecurityException unsupported) { skipped++; }
            }
        }
        emit("findResults", object("matches", matches, "files", files, "skipped", skipped, "limited", limited), request);
    }

    private void applyTheme(boolean dark) {
        getWindow().setStatusBarColor(Color.parseColor(dark ? "#202420" : "#EDF0E8"));
        getWindow().setNavigationBarColor(Color.parseColor(dark ? "#242624" : "#F0F0F0"));
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); if (ready) handleIntent(intent);
    }
    private void handleIntent(Intent intent) {
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            Uri uri = intent.getData(); submit("", () -> openDocument(uri, "", 0));
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) submit("", () -> openDocument(uri, "", 0));
            else if (text != null) emit("sharedText", object("text", text.toString()), "");
        }
        intent.setAction(null);
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.App?App.handleBack():false", result -> {
            if (!"true".equals(result)) { web.evaluateJavascript("window.App&&App.flushSession()", null); moveTaskToBack(true); }
        });
    }
    @Override protected void onPause() {
        if (ready) web.evaluateJavascript("window.App&&App.flushSession()", null);
        super.onPause();
    }
    @Override protected void onDestroy() {
        if (web != null) { web.removeJavascriptInterface("AnotePNative"); web.destroy(); }
        io.shutdown(); super.onDestroy();
    }

    private void error(String text, String request) { emit("error", object("message", text), request); }
    private String message(Exception e) { return e.getMessage() == null ? "The local file operation failed." : e.getMessage(); }
    private void emit(String type, JSONObject payload, String request) {
        JSONObject event = object("type", type, "payload", payload, "requestId", request);
        final String json = event.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) web.evaluateJavascript("window.App&&App.nativeEvent(" + json + ")", null); });
    }
    private static JSONObject object(Object... entries) {
        JSONObject object = new JSONObject();
        try { for (int i = 0; i < entries.length; i += 2) object.put((String)entries[i], entries[i + 1]); }
        catch (JSONException impossible) { throw new IllegalArgumentException(impossible); }
        return object;
    }
}
