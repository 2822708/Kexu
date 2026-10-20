package com.timetable.config;

import java.nio.charset.StandardCharsets;

/** Wire/storage identifiers from earlier releases. New output must use the Kexu identifiers. */
public final class LegacyIdentifiers {
    private LegacyIdentifiers() {}

    public static final String BACKUP_MANIFEST = ascii(116,97,110,103,101,110,116,45,98,97,99,107,117,112,46,106,115,111,110);
    public static final String BACKUP_FORMAT = ascii(116,97,110,103,101,110,116,45,104,50,45,98,97,99,107,117,112);
    public static final String BACKUP_PREFIX = ascii(116,97,110,103,101,110,116,45,98,97,99,107,117,112,45);
    public static final String DATA_DIRECTORY = ascii(46,116,97,110,103,101,110,116,45,116,105,109,101,116,97,98,108,101);
    public static final String ENV_PREFIX = ascii(84,65,78,71,69,78,84,95);

    private static String ascii(int... values) {
        byte[] bytes = new byte[values.length];
        for (int i = 0; i < values.length; i++) bytes[i] = (byte) values[i];
        return new String(bytes, StandardCharsets.US_ASCII);
    }
}
