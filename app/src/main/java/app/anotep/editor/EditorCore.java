package app.anotep.editor;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.security.MessageDigest;
import java.util.Arrays;

/** Text/file rules kept independent of Android so file fidelity can be tested. */
public final class EditorCore {
    public static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    public static final int MAX_SESSION_BYTES = 32 * 1024 * 1024;

    public static final class Decoded {
        public final String text, encoding, eol;
        public final boolean mixedEol;
        Decoded(String text, String encoding, String eol, boolean mixedEol) {
            this.text = text; this.encoding = encoding; this.eol = eol; this.mixedEol = mixedEol;
        }
    }

    private EditorCore() {}

    public static byte[] readLimited(InputStream input, int max) throws IOException {
        if (input == null) throw new IOException("The document could not be opened.");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] block = new byte[8192];
        int count;
        while ((count = input.read(block)) != -1) {
            if (out.size() + count > max) throw new IOException("This file exceeds the 8 MB editing limit.");
            out.write(block, 0, count);
        }
        return out.toByteArray();
    }

    public static Decoded decode(byte[] bytes, String requestedEncoding) throws IOException {
        if (bytes.length > MAX_FILE_BYTES) throw new IOException("This file exceeds the 8 MB editing limit.");
        int offset = 0;
        String encoding = requestedEncoding;
        if (encoding == null || encoding.isEmpty()) {
            if (starts(bytes, 0xef, 0xbb, 0xbf)) { encoding = "UTF-8-BOM"; offset = 3; }
            else if (starts(bytes, 0xff, 0xfe, 0, 0) || starts(bytes, 0, 0, 0xfe, 0xff)) {
                throw new IOException("UTF-32 is not supported. Convert this file to UTF-8 first.");
            }
            else if (starts(bytes, 0xff, 0xfe)) { encoding = "UTF-16LE"; offset = 2; }
            else if (starts(bytes, 0xfe, 0xff)) { encoding = "UTF-16BE"; offset = 2; }
            else encoding = "UTF-8";
        } else {
            validateEncoding(encoding);
            if ((encoding.equals("UTF-8") || encoding.equals("UTF-8-BOM")) && starts(bytes, 0xef, 0xbb, 0xbf)) offset = 3;
            if (encoding.equals("UTF-16LE") && starts(bytes, 0xff, 0xfe)) offset = 2;
            if (encoding.equals("UTF-16BE") && starts(bytes, 0xfe, 0xff)) offset = 2;
        }
        String text;
        try { text = decodeStrict(bytes, offset, encoding); }
        catch (CharacterCodingException e) {
            if (requestedEncoding != null && !requestedEncoding.isEmpty()) throw new IOException("This file is not valid " + encoding + ".", e);
            encoding = "windows-1252";
            try { text = decodeStrict(bytes, 0, encoding); }
            catch (CharacterCodingException invalid) { throw new IOException("This file contains invalid text bytes.", invalid); }
        }
        if (text.indexOf('\u0000') != -1) throw new IOException("This appears to be a binary file or UTF-16 without a byte order mark.");
        int crlf = 0, lf = 0, cr = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\r') {
                if (i + 1 < text.length() && text.charAt(i + 1) == '\n') { crlf++; i++; }
                else cr++;
            } else if (c == '\n') lf++;
        }
        String eol = crlf > 0 && crlf >= lf && crlf >= cr ? "CRLF" : cr > lf ? "CR" : "LF";
        boolean mixed = (crlf > 0 ? 1 : 0) + (lf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0) > 1;
        return new Decoded(normalize(text), encoding, eol, mixed);
    }

    public static byte[] encode(String text, String encoding, String eol) throws IOException {
        validateEncoding(encoding);
        if (!Arrays.asList("LF", "CRLF", "CR").contains(eol)) throw new IOException("Unsupported line ending.");
        text = normalize(text);
        if (eol.equals("CRLF")) text = text.replace("\n", "\r\n");
        else if (eol.equals("CR")) text = text.replace('\n', '\r');
        byte[] content;
        try {
            ByteBuffer buffer = charset(encoding).newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .encode(CharBuffer.wrap(text));
            content = new byte[buffer.remaining()]; buffer.get(content);
        } catch (CharacterCodingException e) {
            throw new IOException("Some characters cannot be saved as " + encoding + ". Choose UTF-8 in the Encoding menu.", e);
        }
        byte[] bom = encoding.equals("UTF-8-BOM") ? new byte[]{(byte)0xef,(byte)0xbb,(byte)0xbf}
            : encoding.equals("UTF-16LE") ? new byte[]{(byte)0xff,(byte)0xfe}
            : encoding.equals("UTF-16BE") ? new byte[]{(byte)0xfe,(byte)0xff} : new byte[0];
        if ((long) content.length + bom.length > MAX_FILE_BYTES) throw new IOException("The encoded document exceeds the 8 MB file limit.");
        byte[] result = Arrays.copyOf(bom, bom.length + content.length);
        System.arraycopy(content, 0, result, bom.length, content.length);
        return result;
    }

    public static String fingerprint(byte[] bytes) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder out = new StringBuilder();
            for (byte b : hash) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return out.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }

    public static String normalize(String text) { return text.replace("\r\n", "\n").replace('\r', '\n'); }

    private static void validateEncoding(String name) throws IOException {
        if (!Arrays.asList("UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE", "windows-1252", "ISO-8859-1", "US-ASCII").contains(name))
            throw new IOException("Unsupported text encoding: " + name);
    }
    private static Charset charset(String name) { return Charset.forName(name.equals("UTF-8-BOM") ? "UTF-8" : name); }
    private static String decodeStrict(byte[] bytes, int start, String encoding) throws CharacterCodingException {
        return charset(encoding).newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, start, bytes.length - start)).toString();
    }
    private static boolean starts(byte[] bytes, int... prefix) {
        if (bytes.length < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) if ((bytes[i] & 255) != prefix[i]) return false;
        return true;
    }
}
