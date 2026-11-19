package app.focus;

import android.accessibilityservice.AccessibilityService;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Watches which app comes to the front. While a focus session is running and the app
 * is on the user's block list, sends the user to the "back to work" screen instead.
 */
public class BlockService extends AccessibilityService implements SharedPreferences.OnSharedPreferenceChangeListener {
    private static final String CHANNEL = "done";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private String frontApp = "";
    // a session started on another device, learned from the server
    private long remoteEndAt, remoteCheckedAt;
    private String remoteTitle = "";

    private final Runnable sessionEnded = () -> {
        if (prefs.getBoolean(Store.ACTIVE, false) && !MainActivity.visible) notifyDone();
    };

    @Override
    protected void onServiceConnected() {
        prefs = Store.prefs(this);
        prefs.registerOnSharedPreferenceChangeListener(this);
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_HIGH));
        scheduleEnd();
    }

    @Override
    public void onSharedPreferenceChanged(SharedPreferences p, String key) {
        if (Store.END_AT.equals(key) || Store.ACTIVE.equals(key)) {
            scheduleEnd();
            if (!Store.focusActive(prefs) && remoteEndAt <= System.currentTimeMillis()) hideOverlay(); // session stopped early
        }
    }

    private void scheduleEnd() {
        handler.removeCallbacks(sessionEnded);
        if (Store.focusActive(prefs))
            handler.postDelayed(sessionEnded, prefs.getLong(Store.END_AT, 0) - System.currentTimeMillis());
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (prefs == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || e.getPackageName() == null) return;
        frontApp = e.getPackageName().toString();
        if (!Store.blockedApps(prefs).contains(frontApp)) return;

        long now = System.currentTimeMillis();
        if (Store.focusActive(prefs)) block(prefs.getLong(Store.END_AT, 0), prefs.getString(Store.TITLE, ""));
        else if (remoteEndAt > now) block(remoteEndAt, remoteTitle);
        else if (now - remoteCheckedAt > 15000) askServer(frontApp);
    }

    /**
     * Leaves the blocked app and covers the screen with our own overlay window.
     * Deliberately not an Activity: Xiaomi/POCO (and some others) silently refuse to start
     * activities from the background, while an accessibility overlay needs no extra permission.
     */
    private void block(long endAt, String title) {
        performGlobalAction(GLOBAL_ACTION_HOME);
        overlayEnd = endAt;
        if (overlay == null) {
            float dp = getResources().getDisplayMetrics().density;
            int pad = (int) (24 * dp);
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setGravity(Gravity.CENTER);
            box.setPadding(pad, pad, pad, pad);
            box.setBackgroundColor(Color.parseColor("#0E0E10"));
            TextView head = label(28, "#EFE9DB");
            head.setText(R.string.blocked_title);
            overlayTask = label(16, "#A09A8E");
            overlayClock = label(60, "#F2B33D");
            box.addView(head);
            box.addView(overlayTask);
            box.addView(overlayClock);
            box.addView(button(R.string.blocked_ok, v -> hideOverlay()));
            box.addView(button(R.string.blocked_back, v -> {
                hideOverlay();
                try { startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
            }));
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                    PixelFormat.OPAQUE);
            try { getSystemService(WindowManager.class).addView(box, lp); overlay = box; } catch (Exception e) { return; }
        }
        overlayTask.setText(title == null || title.isEmpty() ? "" : getString(R.string.blocked_task, title));
        handler.removeCallbacks(overlayTick);
        overlayTick.run();
    }

    private View overlay;
    private TextView overlayClock, overlayTask;
    private long overlayEnd;
    private final Runnable overlayTick = new Runnable() {
        @Override public void run() {
            long sec = (overlayEnd - System.currentTimeMillis() + 999) / 1000;
            if (overlay == null) return;
            if (sec <= 0) { hideOverlay(); return; }
            overlayClock.setText(String.format(Locale.ROOT, "%02d:%02d", sec / 60, sec % 60));
            handler.postDelayed(this, 500);
        }
    };

    private void hideOverlay() {
        handler.removeCallbacks(overlayTick);
        if (overlay == null) return;
        try { getSystemService(WindowManager.class).removeView(overlay); } catch (Exception ignored) {}
        overlay = null;
    }

    private TextView label(int sp, String color) {
        TextView v = new TextView(this);
        v.setTextSize(sp);
        v.setTextColor(Color.parseColor(color));
        v.setGravity(Gravity.CENTER);
        v.setPadding(0, 0, 0, (int) (12 * getResources().getDisplayMetrics().density));
        return v;
    }

    private TextView button(int text, View.OnClickListener onClick) {
        float dp = getResources().getDisplayMetrics().density;
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextSize(16);
        b.setTextColor(Color.parseColor("#17130A"));
        b.setGravity(Gravity.CENTER);
        b.setPadding((int) (22 * dp), (int) (12 * dp), (int) (22 * dp), (int) (12 * dp));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#F2B33D"));
        bg.setCornerRadius(99 * dp);
        b.setBackground(bg);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (14 * dp);
        b.setLayoutParams(lp);
        return b;
    }

    /** Maybe the session was started on the PC: ask the home server (works only on the home network). */
    private void askServer(String app) {
        String url = prefs.getString(Store.URL, ""), token = prefs.getString(Store.TOKEN, "");
        if (url.isEmpty() || token.isEmpty()) return;
        remoteCheckedAt = System.currentTimeMillis();
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url.replaceAll("/+$", "") + "/api/state").openConnection();
                c.setConnectTimeout(3000);
                c.setReadTimeout(3000);
                c.setRequestProperty("Authorization", "Bearer " + token);
                if (c.getResponseCode() != 200) return;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[4096];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                }
                JSONObject timer = new JSONObject(out.toString("UTF-8")).optJSONObject("timer");
                if (timer == null || !"focus".equals(timer.optString("kind"))) return;
                long endAt = timer.optLong("endAt");
                String title = timer.optString("title");
                handler.post(() -> {
                    remoteEndAt = endAt;
                    remoteTitle = title;
                    if (endAt > System.currentTimeMillis() && app.equals(frontApp)) block(endAt, title);
                });
            } catch (Exception ignored) {} // server unreachable: nothing to block
        }).start();
    }

    private void notifyDone() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        getSystemService(NotificationManager.class).notify(1, new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(getString(R.string.done_title))
                .setContentText(getString(R.string.done_text))
                .setContentIntent(open).setAutoCancel(true).build());
    }

    @Override public void onInterrupt() {}

    @Override
    public void onDestroy() {
        hideOverlay();
        if (prefs != null) prefs.unregisterOnSharedPreferenceChangeListener(this);
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
