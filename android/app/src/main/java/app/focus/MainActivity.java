package app.focus;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/** Shows the shared web app and passes the timer state to the blocking service. */
public class MainActivity extends Activity {
    static volatile boolean visible;
    private WebView web;
    private android.widget.FrameLayout root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // debug builds only: lets the page be inspected and driven from a computer over adb
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        // WebView ignores its own padding, so the insets go on a wrapper
        root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(android.graphics.Color.parseColor("#0E0E10")); // shows behind the system bars; the page recolours it per theme
        root.addView(web);
        setContentView(root);
        // keep the page clear of the status bar, navigation bar and keyboard
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient()); // alert() and confirm()
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.loadUrl("file:///android_asset/index.html");

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    @Override protected void onResume() { super.onResume(); visible = true; web.onResume(); }
    @Override protected void onPause() { visible = false; web.onPause(); super.onPause(); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
    }

    /** Methods the page calls as window.AndroidBridge.* */
    public class Bridge {
        private SharedPreferences p() { return Store.prefs(MainActivity.this); }

        @JavascriptInterface
        public void setFocus(String json) {
            try {
                JSONObject o = new JSONObject(json);
                p().edit().putBoolean(Store.ACTIVE, o.optBoolean("active"))
                        .putLong(Store.END_AT, o.optLong("endAt"))
                        .putString(Store.TITLE, o.optString("title")).apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void setServer(String url, String token) {
            p().edit().putString(Store.URL, url == null ? "" : url).putString(Store.TOKEN, token == null ? "" : token).apply();
        }

        @JavascriptInterface
        public void setReminders(String json) { Reminders.schedule(MainActivity.this, json); }

        /** Installed apps with a launcher icon, sorted by name: [{p: package, n: label, on: blocked}]. The page draws the list itself. */
        @JavascriptInterface
        public String listApps() {
            PackageManager pm = getPackageManager();
            java.util.Set<String> chosen = Store.blockedApps(p());
            java.util.TreeMap<String, String> byLabel = new java.util.TreeMap<>(String.CASE_INSENSITIVE_ORDER);
            Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            for (android.content.pm.ResolveInfo r : pm.queryIntentActivities(launcher, 0)) {
                String pkg = r.activityInfo.packageName;
                if (!pkg.equals(getPackageName())) byLabel.put(r.loadLabel(pm) + "\u0000" + pkg, pkg);
            }
            org.json.JSONArray out = new org.json.JSONArray();
            try {
                for (java.util.Map.Entry<String, String> e : byLabel.entrySet())
                    out.put(new JSONObject().put("p", e.getValue()).put("n", e.getKey().substring(0, e.getKey().indexOf('\u0000')))
                            .put("on", chosen.contains(e.getValue())));
            } catch (Exception ignored) {}
            return out.toString();
        }

        /** Replaces the block list with the given JSON array of package names. */
        @JavascriptInterface
        public void setApps(String json) {
            java.util.Set<String> chosen = new java.util.HashSet<>();
            try { org.json.JSONArray a = new org.json.JSONArray(json); for (int i = 0; i < a.length(); i++) chosen.add(a.getString(i)); } catch (Exception ignored) {}
            p().edit().putStringSet(Store.APPS, chosen).apply();
        }

        /** The page's theme: colour behind the system bars, and whether their icons must be dark (light theme). */
        @JavascriptInterface
        public void setChrome(String color, boolean light) {
            runOnUiThread(() -> {
                try { root.setBackgroundColor(android.graphics.Color.parseColor(color)); } catch (Exception ignored) {}
                if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
                    int bars = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    getWindow().getInsetsController().setSystemBarsAppearance(light ? bars : 0, bars);
                }
            });
        }

        @JavascriptInterface
        public void openAccessibility() { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }

        @JavascriptInterface
        public boolean blockingEnabled() {
            String on = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            return on != null && on.contains(new ComponentName(MainActivity.this, BlockService.class).flattenToString());
        }

        @JavascriptInterface
        public int blockedCount() { return Store.blockedApps(p()).size(); }
    }
}
