package io.github.wdclouds.feaglewxbot.agent;

import android.content.ContentResolver;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

import java.util.Collections;
import java.util.Locale;

import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * 小红书无障碍致盲隐身盾 (LSPosed Hook)
 * 拦截小红书进程内对 AccessibilityManager 与 Settings 的所有探测调用，
 * 使小红书安全 SDK 认为设备未启用任何无障碍服务，彻底杜绝风控检测。
 */
public final class XhsMaskHook {
    private static final String TAG = "FEAGLE-XhsMask";

    public static void init(XC_LoadPackage.LoadPackageParam lpparam) {
        if (!"com.xingin.xhs".equals(lpparam.packageName)) {
            return;
        }

        XposedBridge.log(TAG + ": Initializing accessibility mask for " + lpparam.processName);

        try {
            // 1. 致盲 Settings.Secure 与 Settings.Global 的 enabled_accessibility_services 读取 (小红书风控主要读取处)
            hookSettings(Settings.Secure.class);
            hookSettings(Settings.Global.class);
            hookSettings(Settings.System.class);

            XposedBridge.log(TAG + ": Accessibility mask successfully applied to " + lpparam.processName);
        } catch (Throwable t) {
            XposedBridge.log(TAG + ": Failed to apply mask: " + t.getMessage());
        }
    }

    private static void hookSettings(Class<?> settingsClass) {
        try {
            XposedHelpers.findAndHookMethod(
                    settingsClass,
                    "getString",
                    ContentResolver.class,
                    String.class,
                    new XC_MethodHook() {
                        @Override
                        protected void afterHookedMethod(MethodHookParam param) {
                            String name = (String) param.args[1];
                            if (name != null) {
                                String lower = name.toLowerCase(Locale.ROOT);
                                if (lower.contains("accessibility") || lower.contains("touch_exploration")) {
                                    param.setResult("");
                                }
                            }
                        }
                    }
            );
        } catch (Throwable ignored) {
        }
    }
}
