package cn.tripagentai.studyapp;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FocusLock")
public class FocusLockPlugin extends Plugin {
    private boolean isLocked() {
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        return manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    @PluginMethod
    public void start(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                activity.startLockTask();
                JSObject result = new JSObject();
                result.put("active", isLocked());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Unable to start focus lock", error);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                if (isLocked()) activity.stopLockTask();
                JSObject result = new JSObject();
                result.put("active", false);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Unable to stop focus lock", error);
            }
        });
    }
}
