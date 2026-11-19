package app.focus;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashSet;
import java.util.Set;

/** State shared between the web page (through MainActivity) and the blocking service. */
final class Store {
    static final String ACTIVE = "active", END_AT = "endAt", TITLE = "title", URL = "url", TOKEN = "token", APPS = "apps";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("focus", Context.MODE_PRIVATE);
    }

    /** A focus session started on this phone is running right now. */
    static boolean focusActive(SharedPreferences p) {
        return p.getBoolean(ACTIVE, false) && p.getLong(END_AT, 0) > System.currentTimeMillis();
    }

    static Set<String> blockedApps(SharedPreferences p) {
        return new HashSet<>(p.getStringSet(APPS, new HashSet<>()));
    }

    private Store() {}
}
