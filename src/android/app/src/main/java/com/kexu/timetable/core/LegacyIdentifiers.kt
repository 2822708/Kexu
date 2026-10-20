package com.kexu.timetable.core

/** Read-only identifiers for imports and databases written by earlier releases. */
internal object LegacyIdentifiers {
    val EXCHANGE_FORMAT = ascii(116,97,110,103,101,110,116,45,116,105,109,101,116,97,98,108,101,45,101,120,99,104,97,110,103,101)
    val DATABASE_NAME = ascii(116,97,110,103,101,110,116,45,116,105,109,101,116,97,98,108,101,46,100,98)

    private fun ascii(vararg bytes: Int) = bytes.map { it.toByte() }.toByteArray().toString(Charsets.US_ASCII)
}
