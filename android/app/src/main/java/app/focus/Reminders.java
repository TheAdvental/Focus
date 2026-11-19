package app.focus;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * "It is time to start X" notifications. The web page is paused while the app is in the background,
 * so it hands the list of planned tasks over and the system alarm clock does the waiting.
 */
final class Reminders {
    static final String ACTION = "app.focus.REMIND";
    private static final String CHANNEL = "remind", JSON = "reminders", CODES = "reminderCodes";

    private static PendingIntent pending(Context c, int code, Intent extras, int flags) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION);
        if (extras != null) i.putExtras(extras);
        return PendingIntent.getBroadcast(c, code, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Replaces every scheduled reminder with the given list: [{id, at, title, step}]. */
    static void schedule(Context c, String json) {
        SharedPreferences p = Store.prefs(c);
        AlarmManager am = c.getSystemService(AlarmManager.class);
        for (String code : p.getStringSet(CODES, new HashSet<>())) {
            PendingIntent old = pending(c, Integer.parseInt(code), null, PendingIntent.FLAG_NO_CREATE);
            if (old != null) { am.cancel(old); old.cancel(); }
        }
        Set<String> codes = new HashSet<>();
        long now = System.currentTimeMillis();
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            JSONArray list = new JSONArray(json);
            for (int n = 0; n < list.length(); n++) {
                JSONObject o = list.getJSONObject(n);
                long at = o.optLong("at");
                if (at <= now) continue;
                int code = o.optString("id").hashCode();
                Intent extras = new Intent().putExtra("title", o.optString("title")).putExtra("step", o.optString("step")).putExtra("code", code);
                PendingIntent pi = pending(c, code, extras, PendingIntent.FLAG_UPDATE_CURRENT);
                if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi); // may be a few minutes late
                codes.add(String.valueOf(code));
            }
        } catch (Exception ignored) {}
        p.edit().putString(JSON, json).putStringSet(CODES, codes).apply();
    }

    /** Alarms do not survive a reboot: put them back from the saved list. */
    static void restore(Context c) {
        schedule(c, Store.prefs(c).getString(JSON, "[]"));
    }

    static void show(Context c, Intent i) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, c.getString(R.string.channel_remind), NotificationManager.IMPORTANCE_HIGH));
        String step = i.getStringExtra("step");
        PendingIntent open = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        nm.notify(i.getIntExtra("code", 2), new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(c.getString(R.string.remind_title, i.getStringExtra("title")))
                .setContentText(step == null || step.isEmpty() ? c.getString(R.string.remind_text) : c.getString(R.string.remind_step, step))
                .setContentIntent(open).setAutoCancel(true).build());
    }

    private Reminders() {}
}
