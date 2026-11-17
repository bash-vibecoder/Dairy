package app.anotep.editor;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public final class EditorCoreTest {
    private static int checks;
    private static void check(boolean condition, String message) {
        checks++; if (!condition) throw new AssertionError(message);
    }
    private interface Action { void run() throws Exception; }
    private static void rejects(Action action, String message) throws Exception {
        try { action.run(); } catch (IOException expected) { checks++; return; }
        throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        String text = "AnoteP\nTürkçe Ελληνικά 日本語 العربية 🙂\n";
        for (String encoding : new String[]{"UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"}) {
            for (String eol : new String[]{"LF", "CRLF", "CR"}) {
                byte[] encoded = EditorCore.encode(text, encoding, eol);
                EditorCore.Decoded decoded = EditorCore.decode(encoded, null);
                check(decoded.text.equals(text), "Unicode round trip " + encoding + " / " + eol);
                check(decoded.encoding.equals(encoding), "BOM detection " + encoding);
                check(decoded.eol.equals(eol), "Line ending detection " + eol);
                check(Arrays.equals(encoded, EditorCore.encode(decoded.text, decoded.encoding, decoded.eol)), "Exact byte round trip");
            }
        }
        byte[] legacy = "€ “Café”\r\n".getBytes("windows-1252");
        EditorCore.Decoded decoded = EditorCore.decode(legacy, null);
        check(decoded.encoding.equals("windows-1252"), "Legacy encoding fallback");
        check(Arrays.equals(legacy, EditorCore.encode(decoded.text, decoded.encoding, decoded.eol)), "Legacy exact byte round trip");
        EditorCore.Decoded mixed = EditorCore.decode("one\r\ntwo\nthree\r".getBytes(StandardCharsets.UTF_8), null);
        check(mixed.mixedEol && mixed.text.equals("one\ntwo\nthree\n"), "Mixed EOL detection");
        check(EditorCore.decode(new byte[0], null).text.isEmpty(), "Empty file");
        rejects(() -> EditorCore.decode(new byte[]{0, 1, 2, 0}, null), "Binary files must be rejected");
        rejects(() -> EditorCore.decode(new byte[]{(byte)0xff,(byte)0xfe,0,0,0,0,0,0}, null), "UTF-32 must not be mistaken for UTF-16");
        rejects(() -> EditorCore.decode(new byte[]{(byte)0xc3}, "UTF-8"), "Explicit UTF-8 must not silently replace malformed text");
        rejects(() -> EditorCore.encode("🙂", "windows-1252", "LF"), "Unrepresentable characters must not become question marks");
        rejects(() -> EditorCore.encode("abc", "bogus", "LF"), "Unknown encoding");
        rejects(() -> EditorCore.encode("abc", "UTF-8", "bogus"), "Unknown line endings");
        rejects(() -> EditorCore.readLimited(new ByteArrayInputStream(new byte[20]), 19), "Read limit");
        check(EditorCore.readLimited(new ByteArrayInputStream(new byte[20]), 20).length == 20, "Exact read limit");
        check(EditorCore.fingerprint(new byte[0]).equals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), "SHA-256 fingerprint");
        System.out.println("EditorCore: " + checks + " checks passed.");
    }
}
