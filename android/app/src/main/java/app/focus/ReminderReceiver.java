package app.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires when a planned task is due, and after a reboot to put the alarms back. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) Reminders.restore(c);
        else if (Reminders.ACTION.equals(i.getAction()) && !MainActivity.visible) Reminders.show(c, i); // when the app is open the page reminds by itself
    }
}
