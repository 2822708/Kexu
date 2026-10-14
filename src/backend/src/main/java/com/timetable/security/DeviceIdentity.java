package com.timetable.security;

import java.util.regex.Pattern;

/** A random bearer credential, not a hardware fingerprint or a public device identifier. */
public final class DeviceIdentity {
    public static final String KEY_PATTERN = "^device_[A-Za-z0-9_-]{43}$";
    private static final Pattern KEY = Pattern.compile(KEY_PATTERN);

    private DeviceIdentity() {}

    public static boolean isDeviceKey(String key) {
        return key != null && KEY.matcher(key).matches();
    }
}
