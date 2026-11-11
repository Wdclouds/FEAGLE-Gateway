package io.github.wdclouds.feaglewxbot.agent;

import java.lang.reflect.Method;
import java.util.concurrent.ConcurrentHashMap;

import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;

/**
 * Narrow WeChat 8.0.70 adapter.
 *
 * <p>This class deliberately supports one package version and one feature set:
 * inbound/outbound private text plus inbound/outbound group text. Group events
 * remain fail-closed unless WeChat exposes an explicit mention flag. It does not enumerate DEX
 * classes, read databases, persist chat content, or expose a broadcast/file
 * command channel.</p>
 */
final class Wechat8078Adapter {
    static final String TARGET_VERSION = "8.0.78";

    private static final String MESSAGE_CLASS = "com.tencent.mm.storage.e9";
    private static final String ADD_MSG_CLASS = "com.tencent.mm.modelbase.p0";
    private static final String[] INSERT_HELPER_CLASSES =
            new String[]{"l41.aa", "b41.aa"};
    private static final String[] STORAGE_DISPATCHER_CLASSES =
            new String[]{"l41.ba", "b41.ba"};
    private static final String MESSAGE_STORAGE_CLASS = "com.tencent.mm.storage.f9";
    private static final String[] STORAGE_INSERT_METHODS =
            new String[]{"U8", "W8", "na", "ta", "Mb", "Nb", "Sb", "Tb", "pa", "Hc", "o"};
    private static final String SEND_FACTORY_CLASS = "hz0.r1";

    private Wechat8078Adapter() {
    }

    /**
     * CDN 诊断日志开关。默认关闭，避免每次上传都 dump 全字段把 LSPosed 日志撑爆。
     * 打开：adb shell setprop debug.feagle.cdn 1（重启微信生效）。
     * 读取失败（SELinux/属性不可见）一律按关闭处理。
     */
    private static boolean cdnDebugEnabled() {
        try {
            Class<?> properties = Class.forName("android.os.SystemProperties");
            java.lang.reflect.Method get = properties.getMethod(
                    "get", String.class, String.class);
            Object value = get.invoke(null, "debug.feagle.cdn", "0");
            return "1".equals(value) || "true".equals(value);
        } catch (Throwable ignored) {
            return false;
        }
    }

    static void installInbound(ClassLoader classLoader) throws Throwable {
        Class<?> messageClass = XposedHelpers.findClass(MESSAGE_CLASS, classLoader);
        Class<?> addMsgClass = XposedHelpers.findClass(ADD_MSG_CLASS, classLoader);
        int installed = 0;
        for (String helperClass : INSERT_HELPER_CLASSES) {
            installed += hookTwoArgMessagePath(
                    classLoader,
                    helperClass,
                    new String[]{"o", "n"},
                    messageClass,
                    addMsgClass,
                    "storage-helper");
        }
        installed += hookAdditionalStoragePaths(classLoader, messageClass);
        for (String dispatcherClass : STORAGE_DISPATCHER_CLASSES) {
            installed += hookTwoArgMessagePath(
                    classLoader,
                    dispatcherClass,
                    new String[]{"n", "o"},
                    messageClass,
                    addMsgClass,
                    "storage-dispatcher");
        }
        installed += hookLegacyStoragePaths(classLoader, messageClass);
        installed += hookSysCmdExtension(classLoader);
        installed += hookContactEntity(classLoader);

        try {
            Class<?> sp0_sClass = XposedHelpers.findClass("sp0.s", classLoader);
            Class<?> observerClass = XposedHelpers.findClass("androidx.lifecycle.x", classLoader);
            XposedHelpers.findAndHookMethod(sp0_sClass, "a", observerClass, new de.robv.android.xposed.XC_MethodHook() {
                @Override
                protected void afterHookedMethod(MethodHookParam param) throws Throwable {
                    Object lifecycle = param.thisObject;
                    Object observer = param.args[0];
                    if (observer == null) return;
                    Class<?> eventObserverClass = XposedHelpers.findClass("androidx.lifecycle.v", classLoader);
                    if (eventObserverClass.isInstance(observer)) {
                        Class<?> eventClass = XposedHelpers.findClass("androidx.lifecycle.m", classLoader);
                        Object owner = XposedHelpers.getObjectField(lifecycle, "b");
                        Object onStartEvent = XposedHelpers.getStaticObjectField(eventClass, "ON_START");
                        Object onResumeEvent = XposedHelpers.getStaticObjectField(eventClass, "ON_RESUME");
                        try {
                            XposedHelpers.callMethod(observer, "onStateChanged", owner, onStartEvent);
                            XposedHelpers.callMethod(observer, "onStateChanged", owner, onResumeEvent);
                            XposedBridge.log("FEAGLE-Hook: dynamically promoted new observer to RESUMED: " + observer);
                        } catch (Throwable t) {
                            XposedBridge.log("FEAGLE-Hook: promote observer failed: " + t.getMessage());
                        }
                    }
                }
            });
            WechatHook.logAdapterInfo("sp0.s observer promotion hook installed");
        } catch (Throwable t) {
            WechatHook.logAdapterError("failed to hook sp0.s.a", t);
        }

        try {
            Class<?> i0Class = XposedHelpers.findClass("rt5.i0", classLoader);
            Class<?> contClass = XposedHelpers.findClass("kotlin.coroutines.Continuation", classLoader);
            XposedHelpers.findAndHookMethod(i0Class, "emit", Object.class, contClass, new de.robv.android.xposed.XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) throws Throwable {
                    Object hObj = param.args[0];
                    if (hObj != null) {
                        Object resultType = XposedHelpers.getObjectField(hObj, "a");
                        long localId = XposedHelpers.getLongField(hObj, "c");
                        XposedBridge.log("FEAGLE-Hook: rt5.i0 emit called! resultType=" + resultType + " localId=" + localId);
                        // 两阶段 ACK 第二阶段：把最终投递结果回传给 Agent -> Bridge
                        WechatHook.onImageSendResult(
                                resultType == null ? "" : String.valueOf(resultType), localId);
                    } else {
                        XposedBridge.log("FEAGLE-Hook: rt5.i0 emit called with null");
                    }
                }
            });
            WechatHook.logAdapterInfo("rt5.i0 emit hook installed");
        } catch (Throwable t) {
            WechatHook.logAdapterError("failed to hook rt5.i0.emit", t);
        }

        try {
            Class<?> xlogClass = XposedHelpers.findClass("com.tencent.mars.xlog.Log", classLoader);
            XC_MethodHook xlogHook = new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    if (param.args == null || param.args.length < 2) return;
                    String tag = String.valueOf(param.args[0]);
                    if (tag.contains("Cdn") || tag.contains("Img") || tag.contains("Upload") || tag.contains("Mvvm") || tag.contains("Revoke")) {
                        Object msg = param.args[1];
                        if (param.args.length > 2 && param.args[2] instanceof Object[]) {
                            try {
                                msg = String.format(String.valueOf(msg), (Object[]) param.args[2]);
                            } catch (Throwable ignored) {}
                        }
                        XposedBridge.log("XLOG [" + tag + "] " + msg);
                    }
                }
            };
            XposedBridge.hookAllMethods(xlogClass, "i", xlogHook);
            XposedBridge.hookAllMethods(xlogClass, "w", xlogHook);
            XposedBridge.hookAllMethods(xlogClass, "e", xlogHook);
            WechatHook.logAdapterInfo("Mars Xlog mirror hook installed");
        } catch (Throwable t) {
            WechatHook.logAdapterError("failed to hook Mars Xlog", t);
        }

        try {
            // 8.0.79 原生请求已是 fileType=8 / host 空 / forceNoSafeCdn=true，
            // Mars 用自己的 SvrList 预调度解析 CDN。2026-11-10 真机对照实验：
            // 只观测不改写 -> 发图 Success；强改 novac2c host/debugIP/fileType -> errCode:-7。
            // 因此这里不再设置 Test$CDN.cdnC2CUploadDebugIP，也不再改写请求字段。

            // 只挂观测日志，不插手上传参数
            try {
                XposedHelpers.findAndHookMethod("com.tencent.mars.cdn.CdnManager", classLoader, "startSSUpload",
                        "com.tencent.mars.cdn.CdnManager$C2CUploadRequest",
                        "com.tencent.mars.cdn.CdnManager$SessionCallback",
                        "com.tencent.mars.cdn.CdnManager$UploadCallback",
                        new XC_MethodHook() {
                            @Override
                            protected void beforeHookedMethod(MethodHookParam param) {
                                Object req = param.args[0];
                                if (req != null && cdnDebugEnabled()) {
                                    XposedBridge.log("FEAGLE-CDN startSSUpload" + dumpRequestFields(req));
                                }
                            }
                        }
                );
                XposedBridge.log("FEAGLE-Hook: hooked CdnManager.startSSUpload (observe only)");
            } catch (Throwable t) {
                XposedBridge.log("FEAGLE-Hook: hook CdnManager.startSSUpload error: " + t.getMessage());
            }

            try {
                XposedHelpers.findAndHookMethod("com.tencent.mars.cdn.CdnManager", classLoader, "startC2CUpload",
                        "com.tencent.mars.cdn.CdnManager$C2CUploadRequest",
                        "com.tencent.mars.cdn.CdnManager$UploadCallback",
                        new XC_MethodHook() {
                            @Override
                            protected void beforeHookedMethod(MethodHookParam param) {
                                Object req = param.args[0];
                                if (req != null && cdnDebugEnabled()) {
                                    XposedBridge.log("FEAGLE-CDN startC2CUpload" + dumpRequestFields(req));
                                }
                            }
                        }
                );
                XposedBridge.log("FEAGLE-Hook: hooked CdnManager.startC2CUpload (observe only)");
            } catch (Throwable t) {
                XposedBridge.log("FEAGLE-Hook: hook CdnManager.startC2CUpload error: " + t.getMessage());
            }

            // Hook l1 C2C callback to monitor native callbacks
            Class<?> l1Class = XposedHelpers.findClass("com.tencent.mm.modelcdntran.l1", classLoader);
            XC_MethodHook uploadCbHook = new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    if (!cdnDebugEnabled()) {
                        return;
                    }
                    final String methodName = param.method.getName();
                    XposedBridge.log("FEAGLE-Hook: l1." + methodName + " called: mediaId=" + param.args[0] + " arg1=" + (param.args.length > 1 ? param.args[1] : null));

                    if ("keep_onUploadProgress".equals(methodName)
                            || "onUploadProgressChanged".equals(methodName)) {
                        // 只观测：原先这里按 PKCS#7 16 字节补齐伪造 finishedLength，
                        // 会让上传大小与真实文件不一致，接收端校验失败。
                        XposedBridge.log("FEAGLE-Hook: l1." + methodName
                                + " mediaId=" + param.args[0]
                                + " arg1=" + (param.args.length > 1 ? param.args[1] : null));
                    }

                    if ("onC2CUploadCompleted".equals(methodName) && param.args.length > 1 && param.args[1] != null) {
                        try {
                            Object res = param.args[1];
                            int err = XposedHelpers.getIntField(res, "errorCode");
                            String fid = (String) XposedHelpers.getObjectField(res, "fileid");
                            String aes = (String) XposedHelpers.getObjectField(res, "aeskey");
                            XposedBridge.log("FEAGLE-Hook: onC2CUploadCompleted original errorCode=" + err + " fileid=" + fid + " aeskey=" + aes);
                        } catch (Throwable t) {
                            XposedBridge.log("FEAGLE-Hook: log onC2CUploadCompleted error: " + t.getMessage());
                        }
                    }

                    if ("v".equals(methodName) && param.args[0] != null) {
                        // 只观测，绝不改写。8.0.79 原生 fileType=2（普通聊天图），
                        // 强行改成 8 会以开放平台分区上传，而接收端仍按 2 去 CDN 取图，
                        // 分区/鉴权不匹配 -> CDN 404 -> 微信显示“图片已过期或已被清理”。
                        // 同时不再改写 field_sendmsg_viacdn / trysafecdn / force_aeskeycdn，
                        // 也不再通过 resolveVfsStub 替换真实路径（软链接会让 CDN 取到错误内容）。
                        try {
                            Object m = param.args[0];
                            XposedBridge.log("FEAGLE-Hook: l1.v OBSERVE mediaId="
                                    + XposedHelpers.getObjectField(m, "field_mediaId")
                                    + " fileType=" + XposedHelpers.getIntField(m, "field_fileType")
                                    + " sendmsg_viacdn=" + XposedHelpers.getBooleanField(m, "field_sendmsg_viacdn")
                                    + " trysafecdn=" + XposedHelpers.getBooleanField(m, "field_trysafecdn")
                                    + " force_aeskeycdn=" + XposedHelpers.getBooleanField(m, "field_force_aeskeycdn")
                                    + " totalLen=" + XposedHelpers.getLongField(m, "field_totalLen")
                                    + " fullpath=" + XposedHelpers.getObjectField(m, "field_fullpath"));
                        } catch (Throwable t) {
                            XposedBridge.log("FEAGLE-Hook: l1.v observe error: " + t.getMessage());
                        }
                    }
                }
            };
            XposedBridge.hookAllMethods(l1Class, "keep_onUploadSuccessed", uploadCbHook);
            XposedBridge.hookAllMethods(l1Class, "keep_onUploadError", uploadCbHook);
            XposedBridge.hookAllMethods(l1Class, "keep_onUploadProgress", uploadCbHook);
            XposedBridge.hookAllMethods(l1Class, "onUploadProgressChanged", uploadCbHook);
            XposedBridge.hookAllMethods(l1Class, "onC2CUploadCompleted", uploadCbHook);
            XposedBridge.hookAllMethods(l1Class, "keep_callFromJni", new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    if (!cdnDebugEnabled()) {
                        return;
                    }
                    try {
                        byte[] b = (byte[]) param.args[2];
                        if (b != null) {
                            String log = new String(b);
                            XposedBridge.log("MARS-CDN: " + log);
                        }
                    } catch (Throwable ignored) {}
                }
            });
            XposedBridge.hookAllMethods(l1Class, "v", uploadCbHook);

            Class<?> pClass = XposedHelpers.findClass("com.tencent.mm.modelcdntran.p", classLoader);
            XposedBridge.hookAllMethods(pClass, "onChanged", new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    if (!cdnDebugEnabled()) {
                        return;
                    }
                    XposedBridge.log("FEAGLE-Hook: cdn.p.onChanged: " + param.args[0]);
                }
            });

            Class<?> cdnMgrClass = XposedHelpers.findClass("com.tencent.mars.cdn.CdnManager", classLoader);
            XC_MethodHook cdnMgrHook = new XC_MethodHook() {
                @Override
                protected void afterHookedMethod(MethodHookParam param) {
                    if (!cdnDebugEnabled()) {
                        return;
                    }
                    XposedBridge.log("FEAGLE-Hook: CdnManager." + param.method.getName() + " ret=" + param.getResult());
                }
            };
            XposedBridge.hookAllMethods(cdnMgrClass, "startUploadTask", cdnMgrHook);
            XposedBridge.hookAllMethods(cdnMgrClass, "startSSUpload", cdnMgrHook);
            XposedBridge.hookAllMethods(cdnMgrClass, "OnJniStartUpload", cdnMgrHook);
            XposedBridge.hookAllMethods(cdnMgrClass, "OnJniStartSSUpload", cdnMgrHook);

            WechatHook.logAdapterInfo("CDN diagnostics hooks installed");
        } catch (Throwable t) {
            WechatHook.logAdapterError("failed to install CDN diagnostics hooks", t);
        }

        if (installed == 0) {
            throw new NoSuchMethodException("No documented 8.0.78/8.0.79 inbound path found");
        }
        WechatHook.logAdapterInfo(
                "8.0.78/8.0.79 inbound paths installed=" + installed);
    }

    private static int hookTwoArgMessagePath(
            ClassLoader classLoader,
            String className,
            String[] methodNames,
            Class<?> messageClass,
            Class<?> addMsgClass,
            String source) {
        Class<?> helperClass;
        try {
            helperClass = XposedHelpers.findClass(className, classLoader);
        } catch (Throwable ignored) {
            return 0;
        }
        Method target = null;
        for (Method method : helperClass.getDeclaredMethods()) {
            Class<?>[] parameters = method.getParameterTypes();
            if (parameters.length != 2) {
                continue;
            }
            boolean nameMatch = false;
            if (methodNames == null || methodNames.length == 0) {
                nameMatch = true;
            } else {
                for (String candidate : methodNames) {
                    if (candidate.equals(method.getName())) {
                        nameMatch = true;
                        break;
                    }
                }
            }
            if (!nameMatch) {
                continue;
            }
            if ((compatible(parameters[0], messageClass) && compatible(parameters[1], addMsgClass))
                    || (compatible(parameters[0], addMsgClass) && compatible(parameters[1], messageClass))) {
                target = method;
                break;
            }
        }
        if (target == null) {
            return 0;
        }

        target.setAccessible(true);
        XposedBridge.hookMethod(target, new XC_MethodHook() {
            @Override
            protected void afterHookedMethod(MethodHookParam param) {
                // 8.0.70 上 n() 的参数顺序可能为 (p0, y8) 或 (y8, p0)，
                // 两个参数都尝试捕获，由 captureMessage 内部判别。
                for (int i = 0; i < param.args.length && i < 2; i++) {
                    if (param.args[i] != null) {
                        captureMessage(source + "/arg" + i, param.args[i]);
                    }
                }
            }
        });
        return 1;
    }

    /** 诊断（临时，2026-08-04）：Hook SQLCipher/WCDB openDatabase 拿 DB key，
     *  用于本地解密 EnMicroMsg.db 直查消息完整内容（引用文字定位）。 */
    private static int hookAdditionalStoragePaths(
            ClassLoader classLoader, Class<?> messageClass) {
        int installed = 0;
        for (String helperName : INSERT_HELPER_CLASSES) {
            Class<?> helperClass;
            try {
                helperClass = XposedHelpers.findClass(helperName, classLoader);
            } catch (Throwable ignored) {
                continue;
            }
            for (Method method : helperClass.getDeclaredMethods()) {
                if ("n".equals(method.getName()) || "o".equals(method.getName())) {
                    continue; // 已有专路
                }
                Class<?>[] ps = method.getParameterTypes();
                if (ps.length == 0) {
                    continue;
                }
                boolean relevant = false;
                for (Class<?> p : ps) {
                    if (p == messageClass || p == java.util.List.class) {
                        relevant = true;
                        break;
                    }
                }
                if (!relevant) {
                    continue;
                }
                final String methodName = method.getName();
                method.setAccessible(true);
                XposedBridge.hookMethod(method, new XC_MethodHook() {
                    @Override
                    protected void afterHookedMethod(MethodHookParam param) {
                        Object first = param.args.length > 0 ? param.args[0] : null;
                        if (first != null && first.getClass() == messageClass) {
                            captureMessage("helper-addl/" + methodName, first);
                        }
                    }
                });
                installed++;
            }
        }
        return installed;
    }

    private static int hookLegacyStoragePaths(
            ClassLoader classLoader, Class<?> messageClass) {
        Class<?> storageClass;
        try {
            storageClass = XposedHelpers.findClass(
                    MESSAGE_STORAGE_CLASS, classLoader);
        } catch (Throwable ignored) {
            return 0;
        }

        int installed = 0;
        for (Method method : storageClass.getDeclaredMethods()) {
            if (!matchesStorageMethod(method.getName())
                    || method.getParameterTypes().length == 0
                    || !compatible(
                            method.getParameterTypes()[0], messageClass)) {
                continue;
            }
            method.setAccessible(true);
            XposedBridge.hookMethod(method, new XC_MethodHook() {
                @Override
                protected void afterHookedMethod(MethodHookParam param) {
                    captureMessage("message-storage", param.args[0]);
                }
            });
            installed++;
        }
        return installed;
    }

    
    private static int hookSysCmdExtension(ClassLoader classLoader) {
        try {
            Class<?> fdClass = null;
            for (String fdName : new String[]{"l41.fd", "b41.fd"}) {
                try {
                    fdClass = XposedHelpers.findClass(fdName, classLoader);
                    if (fdClass != null) break;
                } catch (Throwable ignored) {}
            }
            if (fdClass == null) {
                return 0;
            }
            Class<?> p0Class = XposedHelpers.findClass("com.tencent.mm.modelbase.p0", classLoader);
            Method kMethod = null;
            for (Method m : fdClass.getDeclaredMethods()) {
                if (m.getParameterTypes().length == 1 && compatible(m.getParameterTypes()[0], p0Class)) {
                    kMethod = m;
                    break;
                }
            }
            if (kMethod != null) {
                kMethod.setAccessible(true);
                XposedBridge.hookMethod(kMethod, new XC_MethodHook() {
                    @Override
                    protected void beforeHookedMethod(MethodHookParam param) {
                        try {
                            Object p0Obj = param.args[0];
                            if (p0Obj != null) {
                                Object k4Obj = XposedHelpers.getObjectField(p0Obj, "a");
                                if (k4Obj != null) {
                                    Object q16Obj = XposedHelpers.getObjectField(k4Obj, "h");
                                    if (q16Obj != null) {
                                        String msgContent = null;
                                        for (String j1Name : new String[]{"ha1.j1", "x91.j1"}) {
                                            try {
                                                Class<?> j1Cls = XposedHelpers.findClass(j1Name, classLoader);
                                                msgContent = (String) XposedHelpers.callStaticMethod(j1Cls, "g", q16Obj);
                                                if (msgContent != null) break;
                                            } catch (Throwable ignored) {}
                                        }
                                        if (msgContent != null && msgContent.contains("type=") && msgContent.contains("pat")) {
                                            String fromUser = extractXmlTag(msgContent, "fromusername");
                                            String chatUser = extractXmlTag(msgContent, "chatusername");
                                            String pattedUser = extractXmlTag(msgContent, "pattedusername");
                                            String template = extractXmlTag(msgContent, "template");
                                            if (fromUser != null && !fromUser.isEmpty() && chatUser != null && !chatUser.isEmpty()) {
                                                long createTime = System.currentTimeMillis();
                                                WechatHook.captureNotice("sysmsg-pat", "poke", chatUser, fromUser, pattedUser != null ? pattedUser : "", template != null ? template : "", fromUser, 0, createTime);
                                            }
                                        } else if (msgContent != null && msgContent.contains("revokemsg")) {
                                            String session = extractXmlTag(msgContent, "session");
                                            String newMsgIdStr = extractXmlTag(msgContent, "newmsgid");
                                            String replaceMsg = extractXmlTag(msgContent, "replacemsg");
                                            if (session != null && !session.isEmpty()) {
                                                long createTime = System.currentTimeMillis();
                                                long msgSvrId = 0;
                                                try {
                                                    if (newMsgIdStr != null && !newMsgIdStr.isEmpty()) {
                                                        msgSvrId = Long.parseLong(newMsgIdStr);
                                                    }
                                                } catch (Throwable ignored) {}
                                                WechatHook.captureNotice("sysmsg-revoke", "recall", session, session, "", replaceMsg != null ? replaceMsg : "", session, msgSvrId, createTime);
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (Throwable t) {
                            WechatHook.logAdapterError("syscmd-k-pat-hook", t);
                        }
                    }
                });
                return 1;
            }
            return 0;
        } catch (Throwable error) {
            WechatHook.logAdapterError("hookSysCmdExtension", error);
            return 0;
        }
    }

    private static boolean matchesStorageMethod(String name) {
        for (String candidate : STORAGE_INSERT_METHODS) {
            if (candidate.equals(name)) {
                return true;
            }
        }
        return false;
    }

    private static boolean compatible(Class<?> actual, Class<?> expected) {
        return actual.isAssignableFrom(expected)
                || expected.isAssignableFrom(actual);
    }

    private static boolean isGroupTalker(String talker) {
        return talker != null
                && talker.toLowerCase(java.util.Locale.ROOT).endsWith("@chatroom");
    }

    static void sendText(ClassLoader classLoader, String talker, String content)
            throws Throwable {
        // 8.0.79 底层真实 NetSceneSendMsg 压网队列（免 UI Activity / LifecycleScope 依赖，后台锁屏必达）
        try {
            Class<?> netSceneClass79 = XposedHelpers.findClass("com.tencent.mm.plugin.voip.model.y", classLoader);
            Class<?> i1Class79 = XposedHelpers.findClass("pp0.i1", classLoader);
            if (netSceneClass79 != null && i1Class79 != null) {
                java.lang.reflect.Constructor<?> ctor = netSceneClass79.getDeclaredConstructor(
                        String.class, String.class, int.class, int.class);
                ctor.setAccessible(true);
                Object netScene = ctor.newInstance(talker, content, 1, 0);
                Object queue = XposedHelpers.callStaticMethod(i1Class79, "e");
                if (queue != null) {
                    Object res = XposedHelpers.callMethod(queue, "g", netScene);
                    XposedBridge.log("FEAGLE-Hook: 8.0.79 NetSceneSendMsg enqueued=" + res + " to " + talker);
                    return;
                }
            }
        } catch (Throwable t) {
            XposedBridge.log("FEAGLE-Hook: 8.0.79 NetSceneSendMsg fallback: " + t.getMessage());
        }

        // 尝试 8.0.79 的门面入口 wh0.c.a(...)
        try {
            Class<?> sendLogic79 = XposedHelpers.findClass("wh0.c", classLoader);
            if (sendLogic79 != null) {
                for (Method m : sendLogic79.getDeclaredMethods()) {
                    if ("a".equals(m.getName()) && m.getParameterTypes().length == 7) {
                        m.setAccessible(true);
                        m.invoke(null, talker, content, 1, 0, null, null, null);
                        return;
                    }
                }
            }
        } catch (Throwable ignored) {
        }

        // 兼容 8.0.78 原入口 oh0.c.a(...)
        try {
            Class<?> sendLogic78 = XposedHelpers.findClass("oh0.c", classLoader);
            if (sendLogic78 != null) {
                for (Method m : sendLogic78.getDeclaredMethods()) {
                    if ("a".equals(m.getName()) && m.getParameterTypes().length == 7) {
                        m.setAccessible(true);
                        m.invoke(null, talker, content, 1, 0, null, null, null);
                        return;
                    }
                }
            }
        } catch (Throwable ignored) {
        }

        // 兜底直接构建 NetSceneSendMsg 压入网络队列
        Class<?> netSceneClass = XposedHelpers.findClass("f61.s0", classLoader);
        java.lang.reflect.Constructor<?> ctor = null;
        for (java.lang.reflect.Constructor<?> c : netSceneClass.getDeclaredConstructors()) {
            Class<?>[] pts = c.getParameterTypes();
            if (pts.length == 6 && pts[0] == String.class && pts[1] == String.class) {
                ctor = c;
                break;
            }
        }
        if (ctor != null) {
            ctor.setAccessible(true);
            Object netScene = ctor.newInstance(talker, content, 1, 0, null, null);
            Class<?> h9Class = XposedHelpers.findClass("l41.h9", classLoader);
            Object queue = XposedHelpers.callStaticMethod(h9Class, "e");
            XposedHelpers.callMethod(queue, "g", netScene);
            return;
        }

        throw new NoSuchMethodError("No sendText method found for WeChat 8.0.78/8.0.79");
    }

    private static void advanceLifecycleToResumed(ClassLoader classLoader, Object lifecycle) {
        try {
            Class<?> stateClass = XposedHelpers.findClass("androidx.lifecycle.n", classLoader);
            Class<?> eventClass = XposedHelpers.findClass("androidx.lifecycle.m", classLoader);
            Class<?> eventObserverClass = XposedHelpers.findClass("androidx.lifecycle.v", classLoader);

            Object resumedState = XposedHelpers.getStaticObjectField(stateClass, "RESUMED");
            Object onStartEvent = XposedHelpers.getStaticObjectField(eventClass, "ON_START");
            Object onResumeEvent = XposedHelpers.getStaticObjectField(eventClass, "ON_RESUME");

            Object owner = XposedHelpers.getObjectField(lifecycle, "b");
            java.util.Map<?, ?> observers = (java.util.Map<?, ?>) XposedHelpers.getObjectField(lifecycle, "d");

            XposedHelpers.setObjectField(lifecycle, "c", resumedState);

            if (observers != null && owner != null) {
                java.util.List<Object> list = new java.util.ArrayList<>(observers.values());
                for (Object obs : list) {
                    if (eventObserverClass.isInstance(obs)) {
                        try {
                            XposedHelpers.callMethod(obs, "onStateChanged", owner, onStartEvent);
                            XposedHelpers.callMethod(obs, "onStateChanged", owner, onResumeEvent);
                        } catch (Throwable ignored) {}
                    }
                }
            }
            XposedBridge.log("FEAGLE-Hook: advanceLifecycleToResumed done, observers count=" + (observers != null ? observers.size() : 0));
        } catch (Throwable t) {
            XposedBridge.log("FEAGLE-Hook: advanceLifecycleToResumed failed: " + t.getMessage());
        }
    }

    private static void ensureCdnInit(ClassLoader classLoader) {
        try {
            Class<?> s1Class = XposedHelpers.findClass("com.tencent.mm.modelcdntran.s1", classLoader);
            Object cdnZ = XposedHelpers.callStaticMethod(s1Class, "Hj");
            if (cdnZ != null) {
                boolean isInit = XposedHelpers.getBooleanField(cdnZ, "g");
                XposedBridge.log("FEAGLE-Hook: cdnZ.g isInit=" + isInit);
                if (!isInit) {
                    XposedBridge.log("FEAGLE-Hook: initializing cdnZ via J7...");
                    Class<?> mmCtxClass = XposedHelpers.findClass("com.tencent.mm.sdk.platformtools.MMApplicationContext", classLoader);
                    android.content.Context ctx = (android.content.Context) XposedHelpers.callStaticMethod(mmCtxClass, "getContext");
                    XposedHelpers.callMethod(cdnZ, "J7", ctx);
                    XposedBridge.log("FEAGLE-Hook: cdnZ initialized! now g=" + XposedHelpers.getBooleanField(cdnZ, "g"));
                }
            }
            Object s1 = XposedHelpers.callStaticMethod(s1Class, "Gj");
            if (s1 != null) {
                XposedHelpers.callMethod(s1, "Lj", 7);
                XposedBridge.log("FEAGLE-Hook: triggered s1.Gj().Lj(7) to refresh CDN DNS info!");
            }
        } catch (Throwable t) {
            XposedBridge.log("FEAGLE-Hook: ensureCdnInit failed: " + t.getMessage());
        }
    }

    static void sendImage(ClassLoader classLoader, String talker, String imagePath, boolean isRaw)
            throws Throwable {
        try {
            ensureCdnInit(classLoader);

            Class<?> serviceClass = XposedHelpers.findClass("pa0.w", classLoader);
            Class<?> n0Class = XposedHelpers.findClass("ni5.n0", classLoader);
            Class<?> paramClass = XposedHelpers.findClass("la0.g", classLoader);
            Class<?> extraClass = XposedHelpers.findClass("ea0.i0", classLoader);
            Class<?> y1Class = XposedHelpers.findClass("l41.y1", classLoader);

            String fromUser = (String) XposedHelpers.callStaticMethod(y1Class, "u");
            if (fromUser == null) fromUser = "";
            XposedBridge.log("FEAGLE-Hook: sendImage fromUser=" + fromUser + " talker=" + talker);

            Object service = XposedHelpers.callStaticMethod(n0Class, "c", serviceClass);
            if (service == null) {
                throw new NullPointerException("pa0.w service instance is null");
            }

            // 推进 pa0.w 的 Lifecycle 至 RESUMED，彻底解除 SequenceLifecycleScope 的冻结状态
            try {
                Object lifecycle = XposedHelpers.callMethod(service, "getLifecycle");
                if (lifecycle != null) {
                    try {
                        XposedHelpers.callMethod(lifecycle, "d");
                    } catch (Throwable ignored) {}
                    advanceLifecycleToResumed(classLoader, lifecycle);
                }
            } catch (Throwable lt) {
                XposedBridge.log("FEAGLE-Hook: lifecycle check failed: " + lt.getMessage());
            }

            Object extra = XposedHelpers.newInstance(extraClass);
            // 2 = 系统相册来源（原图只存在于相册场景），0 为兜底
            XposedHelpers.setIntField(extra, "a", 2);
            // 第二个构造参数是 compressType：0 = 普通压缩图，1 = 原图/高清图（HD）
            int compressType = isRaw ? 1 : 0;
            Object param = XposedHelpers.newInstance(paramClass, imagePath, compressType, fromUser, talker, extra);
            // 必须是相册发图标识；component_copy_send_img（剪贴板）与 fileType=1 冲突，
            // 微信网关会判定业务场景不匹配并 RST 掉上传连接（表现为卡在 8KB）。
            XposedHelpers.setObjectField(param, "k", "chatting_send_img");

            Object flow = XposedHelpers.callMethod(service, "Oj", param);
            XposedBridge.log("FEAGLE-Hook: 8.0.79 Oj sendImage dispatched to " + talker
                    + " path=" + imagePath + " compressType=" + compressType
                    + " (isRaw=" + isRaw + ") flow=" + flow);

            // 再次在 Oj 调用后推进生命周期，确保新注册的 SequenceLifecycleScope 观察者立即激活
            try {
                Object lifecycle = XposedHelpers.callMethod(service, "getLifecycle");
                if (lifecycle != null) {
                    advanceLifecycleToResumed(classLoader, lifecycle);
                }
            } catch (Throwable ignored) {}

            if (flow != null) {
                try {
                    Class<?> pp0_i1Class = XposedHelpers.findClass("pp0.i1", classLoader);
                    Object kernelProcess = XposedHelpers.callStaticMethod(pp0_i1Class, "b");
                    if (kernelProcess != null) {
                        Object kernelH = XposedHelpers.getObjectField(kernelProcess, "h");
                        if (kernelH != null) {
                            Object lifecycleScope = XposedHelpers.getObjectField(kernelH, "e");
                            if (lifecycleScope != null) {
                                Class<?> flowClass = XposedHelpers.findClass("kotlinx.coroutines.flow.j", classLoader);
                                Class<?> j0Class = XposedHelpers.findClass("rt5.j0", classLoader);
                                Class<?> contClass = XposedHelpers.findClass("kotlin.coroutines.Continuation", classLoader);
                                Class<?> vf5_iClass = XposedHelpers.findClass("vf5.i", classLoader);
                                Class<?> a1Class = XposedHelpers.findClass("kotlinx.coroutines.a1", classLoader);
                                Class<?> ya6_pClass = XposedHelpers.findClass("ya6.p", classLoader);

                                java.lang.reflect.Constructor<?> j0Ctor = j0Class.getConstructor(flowClass, String.class, String.class, contClass);
                                Object j0Inst = j0Ctor.newInstance(flow, "chatting_send_img", talker, null);

                                java.lang.reflect.Method launchMethod = vf5_iClass.getMethod("c", vf5_iClass, a1Class, ya6_pClass, int.class, Object.class);
                                Object job = launchMethod.invoke(null, lifecycleScope, null, j0Inst, 3, null);
                                XposedBridge.log("FEAGLE-Hook: successfully launched sendImage flow via LifecycleScope job=" + job);
                            } else {
                                XposedBridge.log("FEAGLE-Hook: lifecycleScope is null");
                            }
                        } else {
                            XposedBridge.log("FEAGLE-Hook: kernelH is null");
                        }
                    } else {
                        XposedBridge.log("FEAGLE-Hook: kernelProcess is null");
                    }
                } catch (Throwable flowErr) {
                    XposedBridge.log("FEAGLE-Hook: flow launch error: " + flowErr);
                    for (StackTraceElement ste : flowErr.getStackTrace()) {
                        XposedBridge.log("FEAGLE-Hook:   at " + ste);
                    }
                }
            }
        } catch (Throwable t) {
            XposedBridge.log("FEAGLE-Hook: 8.0.79 sendImage failed: " + t.getMessage());
            throw t;
        }
    }

    private static void captureMessage(String source, Object message) {
        if (message == null) {
            return;
        }
        try {
            // 提前装 CdnManager hook（原图抓取用；不依赖 fetchOriginalImage，
            // CdnManager 类未加载时 forName 静默失败，下条消息再试）
            ensureCdnHookEarly(message);
            int type = intFieldOrMethod(message, "field_type", "getType", -1);
            int isSend = intFieldOrMethod(message, "field_isSend", null, -1);
            String talker = stringFieldOrMethods(
                    message,
                    "field_talker",
                    new String[]{"P0", "getTalker", "E0", "L0"});
            String content = stringFieldOrMethods(
                    message,
                    "field_content",
                    new String[]{"j", "getContent", "S1", "W0"});
            long createTime = longFieldOrMethod(
                    message, "field_createTime", "getCreateTime", 0L);
            long msgId = longFieldOrMethod(
                    message, "field_msgId", "getMsgId", 0L);
            long msgSvrId = longFieldOrMethod(
                    message, "field_msgSvrId", null, 0L);
            boolean mentioned = booleanFieldOrMethod(
                    message, "field_isAt", "isAt", false);
            // 8.0.70 混淆后 field_isAt/isAt 常读不到。群聊被 @ 时 content
            // 形如 "发送者wxid:\n@昵称 内容"，冒号后的正文以 '@' 开头即视为被 @。
            if (!mentioned && isGroupTalker(talker) && content != null) {
                String body = content;
                int sep = body.indexOf(":\n");
                if (sep >= 0) {
                    body = body.substring(sep + 2);
                }
                body = body.trim();
                mentioned = body.startsWith("@");
            }

            WechatHook.captureTextFields(
                    "wechat-8.0.78/" + source,
                    type,
                    isSend,
                    talker,
                    content,
                    createTime,
                    msgId,
                    msgSvrId,
                    mentioned,
                    0L);
            // ── 表情包解析 (type == 47) ──
            if (type == 47 && content != null && isSend == 0) {
                String emojiCdn = extractXmlAttr(content, "cdnurl");
                if (emojiCdn.isEmpty()) {
                    emojiCdn = extractXmlAttr(content, "thumburl");
                }
                if (emojiCdn.isEmpty()) {
                    String md5 = extractXmlAttr(content, "md5");
                    if (!md5.isEmpty()) {
                        emojiCdn = "http://emoji.qpic.cn/wx_emoji/" + md5 + "/";
                    }
                }
                if (!emojiCdn.isEmpty()) {
                    emojiCdn = emojiCdn.replace("http*#*//", "http://").replace("&amp;", "&");
                }
                String emojiText = !emojiCdn.isEmpty() ? "[CQ:image,file=" + emojiCdn + "]" : "[动画表情]";
                String emojiThumb = stringFieldOrMethods(message, "field_imgPath", new String[]{"getImgPath"});
                WechatHook.logAdapterInfo("emoji converted to CQ: " + emojiText);
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        isGroupTalker(talker) && quoteSender(content) != null ? quoteSender(content) + ":\n" + emojiText : emojiText,
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 位置消息 (type == 48) ──
            if (type == 48 && content != null && isSend == 0) {
                String label = extractXmlTag(content, "label");
                String poiname = extractXmlTag(content, "poiname");
                String locDesc = "[位置分享] " + (poiname != null && !poiname.isEmpty() ? poiname + " (" + label + ")" : label);
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        isGroupTalker(talker) && quoteSender(content) != null ? quoteSender(content) + ":\n" + locDesc : locDesc,
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 个人名片 (type == 42) ──
            if (type == 42 && content != null && isSend == 0) {
                String nickname = extractXmlTag(content, "nickname");
                String cardDesc = "[个人名片] " + nickname;
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        isGroupTalker(talker) && quoteSender(content) != null ? quoteSender(content) + ":\n" + cardDesc : cardDesc,
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 引用消息解析（2026-08-05 实测定案）──
            // type=822083633（0x31000031，低字节 49=appmsg），content =
            // "发送者wxid:\n<?xml...<appmsg><title>用户文字</title>...
            // <refermsg><svrid>被引用图msgSvrId</svrid>...</refermsg>"
            // 用户文字在 <title>，被引用图在 <refermsg><svrid>。
            if ((type & 0xFF) == 49 && content != null
                    && content.contains("<refermsg>")) {
                String title = extractXmlTag(content, "title");
                if (title != null && !title.isEmpty()) {
                    boolean quoteMentioned = title.trim().startsWith("@");
                    long quoteSvrIdLong = 0L;
                    try {
                        String svridStr = extractXmlTag(content, "svrid");
                        if (svridStr != null && !svridStr.isEmpty()) {
                            quoteSvrIdLong = Long.parseLong(svridStr);
                        }
                    } catch (Throwable ignored) {
                    }
                    // 群聊：captureTextFields 的 parseGroupText 要求
                    // "发送者:\n正文" 格式——从 content 前缀提取发送者拼回。
                    String quoteContent = formatQuoteContent(talker, content, title);
                    WechatHook.captureTextFields(
                            "wechat-8.0.78/" + source + "/quote",
                            1,
                            isSend,
                            talker,
                            quoteContent,
                            createTime,
                            msgId,
                            msgSvrId,
                            quoteMentioned,
                            quoteSvrIdLong);
                    WechatHook.logAdapterInfo(
                            "[QUOTE] title=" + maskId(title)
                            + " mentioned=" + quoteMentioned
                            + " svrid=" + quoteSvrIdLong);
                }
            }

            // ── 文件消息 (type == 49, sub 6) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 6)) {
                String fileName = extractXmlTag(content, "title");
                String totallen = extractXmlTag(content, "totallen");
                String fileDesc = "[文件] " + (fileName != null ? fileName : "附件文件")
                        + (totallen != null ? " (" + formatFileSize(totallen) + ")" : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, fileDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 合并转发聊天记录 (type == 49, sub 19) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 19)) {
                String title = extractXmlTag(content, "title");
                String des = extractXmlTag(content, "des");
                String recordDesc = "[聊天记录] " + (title != null ? title : "合并转发")
                        + (des != null && !des.isEmpty() ? "\n" + des : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, recordDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 网页与文章链接 (type == 49, sub 5 或 sub 1) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && (isAppMsgType(content, 5) || isAppMsgType(content, 1))) {
                String title = extractXmlTag(content, "title");
                String des = extractXmlTag(content, "des");
                String url = extractXmlTag(content, "url");
                String linkDesc = "[链接] " + (title != null ? title : "网页分享")
                        + (des != null && !des.isEmpty() ? "\n" + des : "")
                        + (url != null && !url.isEmpty() ? "\n" + url : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, linkDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 小程序卡片 (type == 49, sub 33 或 sub 36) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && (isAppMsgType(content, 33) || isAppMsgType(content, 36))) {
                String title = extractXmlTag(content, "title");
                String appName = extractXmlTag(content, "sourcedisplayname");
                String mpDesc = "[小程序] " + (appName != null && !appName.isEmpty() ? appName + " - " : "") + (title != null ? title : "小程序卡片");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, mpDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 视频号视频 (type == 49, sub 51) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 51)) {
                String title = extractXmlTag(content, "title");
                String author = extractXmlTag(content, "nickname");
                String chDesc = "[视频号] " + (author != null && !author.isEmpty() ? author + ": " : "") + (title != null ? title : "视频分享");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, chDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 视频号直播 (type == 49, sub 53) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 53)) {
                String title = extractXmlTag(content, "title");
                String author = extractXmlTag(content, "nickname");
                String liveDesc = "[视频号直播] " + (author != null && !author.isEmpty() ? author + ": " : "") + (title != null ? title : "直播分享");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, liveDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 微信笔记 (type == 49, sub 24) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 24)) {
                String title = extractXmlTag(content, "title");
                String des = extractXmlTag(content, "des");
                String noteDesc = "[微信笔记] " + (title != null ? title : "笔记分享")
                        + (des != null && !des.isEmpty() ? "\n" + des : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, noteDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 音乐卡片 (type == 49, sub 3) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 3)) {
                String title = extractXmlTag(content, "title");
                String singer = extractXmlTag(content, "des");
                String musicDesc = "[音乐分享] " + (title != null ? title : "音乐") + (singer != null && !singer.isEmpty() ? " - " + singer : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, musicDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 微信转账 (type == 49, sub 2000) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 2000)) {
                String fee = extractXmlTag(content, "feedesc");
                String memo = extractXmlTag(content, "pay_memo");
                String transferDesc = "[微信转账] " + (fee != null ? fee : "转账")
                        + (memo != null && !memo.isEmpty() ? " (" + memo + ")" : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, transferDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 微信红包 (type == 49, sub 2001) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && isAppMsgType(content, 2001)) {
                String wish = extractXmlTag(content, "sendertitle");
                String redDesc = "[微信红包] " + (wish != null ? wish : "恭喜发财，大吉大利");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, redDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 群接龙 (type == 49, sub 129 或 0x55000031) ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && (isAppMsgType(content, 129) || type == 1426063409)) {
                String title = extractXmlTag(content, "title");
                String des = extractXmlTag(content, "des");
                String solDesc = "[群接龙] " + (title != null ? title : "接龙消息")
                        + (des != null && !des.isEmpty() ? "\n" + des : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, solDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 其他未细分 AppMsg 卡片兜底 ──
            if ((type & 0xFF) == 49 && content != null && isSend == 0 && !content.contains("<refermsg>")
                    && !isAppMsgType(content, 6) && !isAppMsgType(content, 19)
                    && !isAppMsgType(content, 1) && !isAppMsgType(content, 5)
                    && !isAppMsgType(content, 33) && !isAppMsgType(content, 36)
                    && !isAppMsgType(content, 51) && !isAppMsgType(content, 53)
                    && !isAppMsgType(content, 24) && !isAppMsgType(content, 3)
                    && !isAppMsgType(content, 2000) && !isAppMsgType(content, 2001)
                    && !isAppMsgType(content, 129)) {
                String title = extractXmlTag(content, "title");
                String des = extractXmlTag(content, "des");
                if (title != null && !title.isEmpty()) {
                    String cardDesc = "[卡片] " + title + (des != null && !des.isEmpty() ? " - " + des : "");
                    WechatHook.captureTextFields(
                            "wechat-8.0.78/" + source,
                            1,
                            isSend,
                            talker,
                            formatGroupContent(talker, content, cardDesc),
                            createTime,
                            msgId,
                            msgSvrId,
                            mentioned,
                            0L);
                }
            }

            // ── 语音消息 (type == 34) ──
            if (type == 34 && content != null && isSend == 0) {
                String voiceLenStr = extractXmlAttr(content, "voicelength");
                long sec = 0;
                try {
                    if (voiceLenStr != null && !voiceLenStr.isEmpty()) {
                        sec = Math.round(Long.parseLong(voiceLenStr) / 1000.0);
                    }
                } catch (Throwable ignored) {}
                String transContent = stringFieldOrMethods(message, "field_transContent", new String[]{"getTransContent"});
                String voiceDesc = "[语音: " + (sec > 0 ? sec + "秒" : "语音") + "]"
                        + (transContent != null && !transContent.isEmpty() ? " " + transContent : "");
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, voiceDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 视频/小视频 (type == 43 或 type == 62) ──
            if ((type == 43 || type == 62) && isSend == 0) {
                String videoDesc = "[视频]";
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, videoDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            // ── 语音/视频通话信令 (type == 50, 52, 55, 64) ──
            if ((type == 50 || type == 52 || type == 55 || type == 64) && isSend == 0) {
                String voipDesc = "[语音通话/视频通话]";
                WechatHook.captureTextFields(
                        "wechat-8.0.78/" + source,
                        1,
                        isSend,
                        talker,
                        formatGroupContent(talker, content, voipDesc),
                        createTime,
                        msgId,
                        msgSvrId,
                        mentioned,
                        0L);
            }

            if (type == 3 && isSend == 1) {
                int status = intFieldOrMethod(message, "field_status", "getStatus", -1);
                XposedBridge.log("FEAGLE-Hook: [OUTBOUND-IMG] captured msgId=" + msgId + " svrId=" + msgSvrId + " status=" + status + " talker=" + talker);
            }

            if (type == 3 && isSend == 0) {
                // 图片消息：8.0.70 字段名已实测确认（field_imgPath，
                // 值 THUMBNAIL_DIRPATH://th_<32hex>）。
                // 原图链路（2026-08-08 v2）：后台线程尝试 CDN 原图下载
                // （微信构造照抄：adownimg fileKey + fileType=2 +
                //  customHeader 带 msgid），成功用原图，失败退回缩略图。
                String imgPath = stringFieldOrMethods(
                        message,
                        "field_imgPath",
                        new String[]{"field_imgPath", "getImgPath", "imgPath"});
                final Object msgRef = message;
                final String srcTag = "wechat-8.0.78/" + source;
                final String tRef = talker;
                final String cRef = content;
                final long ctRef = createTime;
                final long miRef = msgId;
                final long msRef = msgSvrId;
                final String thumbRef = imgPath;
                Thread origThread = new Thread(() -> {
                    try {
                        java.io.File original = fetchOriginalImage(
                                msgRef, 8_000, "", msRef, cRef);
                        if (original != null && original.isFile()
                                && original.length() > 0) {
                            // wxgf = 微信 HEVC 私有格式（文件头 wxgf），
                            // 微信进程内解码+压缩不可靠（WXGF JNI 破坏 native
                            // 状态，compress/getPixels 实测随机挂起）——
                            // 新链路：读字节 → Agent → 服务器 ffmpeg 解码
                            // （微信进程零像素操作，根治挂起）
                            boolean isWxgf = false;
                            try {
                                byte[] head = new byte[4];
                                java.io.FileInputStream fis =
                                        new java.io.FileInputStream(original);
                                int hr = fis.read(head);
                                fis.close();
                                isWxgf = hr == 4
                                        && head[0] == 'w' && head[1] == 'x'
                                        && head[2] == 'g' && head[3] == 'f';
                            } catch (Throwable ignored) {
                            }
                            if (isWxgf) {
                                WechatHook.logAdapterInfo(
                                        "[ORIG] wxgf detected, server decode");
                                boolean grp = tRef != null
                                        && tRef.toLowerCase(
                                                java.util.Locale.ROOT)
                                                .endsWith("@chatroom");
                                WechatHook.sendWxgfToAgent(
                                        grp ? AgentProtocol.MSG_GROUP_IMAGE
                                                : AgentProtocol.MSG_PRIVATE_IMAGE,
                                        "wxgf:" + msRef, tRef, cRef,
                                        original, ctRef, miRef, msRef);
                                return;
                            }
                            // 非 wxgf（异常情况）——旧链路压缩兜底
                            WechatHook.logAdapterInfo("[ORIG] original ok size="
                                    + original.length());
                            WechatHook.captureImageFromFile(
                                    srcTag, original, tRef, cRef,
                                    ctRef, miRef, msRef);
                        } else {
                            WechatHook.captureImage(
                                    srcTag, thumbRef, tRef, cRef,
                                    ctRef, miRef, msRef);
                        }
                    } catch (Throwable error) {
                        WechatHook.logAdapterError(
                                "[ORIG] fetch thread failed", error);
                        WechatHook.captureImage(
                                srcTag, thumbRef, tRef, cRef,
                                ctRef, miRef, msRef);
                    }
                }, "feagle-orig");
                // 非 daemon（2026-08-08 实测：daemon 线程在低内存平板被饿死，
                // 同步压缩不执行；非 daemon 保证调度——微信进程长驻无碍）
                origThread.setDaemon(false);
                origThread.start();
            }
        } catch (Throwable error) {
            WechatHook.logAdapterError("8.0.78 message capture failed", error);
        }
    }

    /** 手动构造有效 CDN fileid（DER）：以 XML 模板 DER 为基，改
     *  时间戳→当前 Unix 秒、规格码 150a→152a（微信运行时实测值）、
     *  尾部 4c4dff→4c4e63。UUID 保留（本图资源 ID）。
     *  （2026-08-08 实测：微信下载时 DER 与模板仅差这几个字段；
     *   模板时间戳=消息生成时，运行时=下载瞬间——CDN 校验新鲜度） */
    private static String buildFileId(String derHex) {
        if (derHex == null || derHex.length() != 194) {
            return derHex;
        }
        try {
            StringBuilder sb = new StringBuilder(derHex);
            sb.replace(62, 70, String.format("%08x",
                    System.currentTimeMillis() / 1000));
            if (sb.substring(152, 156).equals("150a")) {
                sb.replace(152, 156, "152a");
            }
            if (sb.substring(170, 176).equals("4c4dff")) {
                sb.replace(170, 176, "4c4e63");
            }
            return sb.toString();
        } catch (Throwable ignored) {
            return derHex;
        }
    }

    /** 提取 XML 标签属性值（img 标签的 cdnthumbwidth 等）。 */
    private static String extractXmlAttr(String tag, String attr) {
        if (tag == null || attr == null) {
            return "0";
        }
        try {
            int ai = tag.indexOf(attr + "=\"");
            if (ai >= 0) {
                int aEnd = tag.indexOf('"', ai + attr.length() + 2);
                if (aEnd > ai) {
                    String val = tag.substring(ai + attr.length() + 2, aEnd);
                    if (!val.isEmpty()) {
                        return val;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return "0";
    }

    /** 原图落盘路径（学微信）：MicroMsg/<用户32hex>/image2/<前2>/<次2>/<md5>。 */
    private static java.io.File originalTargetFile(String md5) {
        try {
            java.io.File microMsg = new java.io.File(
                    WechatHook.appContext().getFilesDir().getParentFile(),
                    "MicroMsg");
            java.io.File[] userDirs = microMsg.listFiles();
            if (userDirs != null) {
                for (java.io.File userDir : userDirs) {
                    if (userDir.isDirectory()
                            && userDir.getName().matches("^[0-9a-f]{32}$")) {
                        java.io.File d1 = new java.io.File(
                                new java.io.File(userDir, "image2"),
                                md5.substring(0, 2));
                        java.io.File d2 = new java.io.File(
                                d1, md5.substring(2, 4));
                        java.io.File target = new java.io.File(d2, md5);
                        d2.mkdirs();
                        return target;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    /** 原图下载（正式实现，2026-08-08）：
     *  b05.c.a(消息对象) → fx4.a ImageInfo（aeskey/URL/md5）
     *  → 构造 CdnManager$C2CDownloadRequest（照抄微信构造）
     *  → OnJniStartC2CDownload 启动 mars::cdn 下载
     *  → 轮询 savePath 落盘文件 → 返回原图文件。
     *  任何一步失败返回 null（调用方退回缩略图）。后台线程执行。 */
    private static java.io.File fetchOriginalImage(
            Object message, long timeoutMs, String senderWxid, long msgSvrId,
            String contentValue) {
        try {
            ClassLoader cl = message.getClass().getClassLoader();
            String aeskey = null;
            String bigUrl = null;
            String md5 = null;
            long length = 0;
            try {
                Class<?> b05c = Class.forName("b05.c", false, cl);
                for (java.lang.reflect.Method m2 : b05c.getDeclaredMethods()) {
                    if (m2.getName().equals("a") && m2.getParameterCount() == 1
                            && m2.getReturnType().getName().contains("fx4")) {
                        m2.setAccessible(true);
                        Object info = m2.invoke(null, message);
                        if (info != null) {
                            aeskey = stringGetter(info, "j");
                            bigUrl = stringGetter(info, "q");
                            md5 = stringGetter(info, "x");
                            length = longGetter(info, "getLength");
                            break;
                        }
                    }
                }
            } catch (Throwable ignored) {
            }
            if (aeskey == null || bigUrl == null || aeskey.isEmpty() || bigUrl.isEmpty()) {
                if (contentValue != null && contentValue.contains("<img")) {
                    int imgStart = contentValue.indexOf("<img");
                    int imgEnd = contentValue.indexOf('>', imgStart);
                    if (imgEnd > imgStart) {
                        String imgTag = contentValue.substring(imgStart, imgEnd);
                        aeskey = extractXmlAttr(imgTag, "aeskey");
                        bigUrl = extractXmlAttr(imgTag, "cdnbigimgurl");
                        if (bigUrl == null || bigUrl.isEmpty()) {
                            bigUrl = extractXmlAttr(imgTag, "cdnmidimgurl");
                        }
                        md5 = extractXmlAttr(imgTag, "md5");
                        try {
                            length = Long.parseLong(extractXmlAttr(imgTag, "length"));
                        } catch (Throwable ignored) {}
                    }
                }
            }
            if (aeskey == null || bigUrl == null || aeskey.isEmpty()
                    || bigUrl.isEmpty()) {
                WechatHook.logAdapterInfo("[ORIG] missing aeskey/url");
                return null;
            }
            // 去重：同一 md5 在途下载只跑一个（两个 hook 路径各起线程）
            if (md5 != null && !md5.isEmpty()
                    && ORIG_IN_FLIGHT.containsKey(md5)) {
                WechatHook.logAdapterInfo("[ORIG] skip duplicate md5=" + md5);
                return null;
            }
            String[] der = parseDerUrl(bigUrl);
            // 构造下载请求（照抄微信 OnJniStartC2CDownload 的 request 构造，
            // 实测 dump：fileid=DER hex 整体、fileKey=文件名描述符
            // （含 cdnthumbwidth/height 宽高）、savePath=image2 下、
            // host/url 留空（mars 从 fileid 解析 CDN））
            String thumbW = "0";
            String thumbH = "0";
            try {
                if (contentValue != null) {
                    String imgTag2 = "";
                    int imgStart = contentValue.indexOf("<img");
                    int imgEnd = imgStart >= 0
                            ? contentValue.indexOf('>', imgStart) : -1;
                    if (imgEnd > imgStart) {
                        imgTag2 = contentValue.substring(imgStart, imgEnd);
                    }
                    thumbW = extractXmlAttr(imgTag2, "cdnthumbwidth");
                    thumbH = extractXmlAttr(imgTag2, "cdnthumbheight");
                }
            } catch (Throwable ignored) {
            }
            Class<?> cdn = Class.forName(
                    "com.tencent.mars.cdn.CdnManager", false, cl);
            Class<?> reqCls = Class.forName(
                    "com.tencent.mars.cdn.CdnManager$C2CDownloadRequest",
                    false, cl);
            // 优先用微信官方静态工厂 createC2CDownload 构造（自动初始化
            // supportFormats 等默认值），失败退回 new + 手填
            Object req = null;
            // 微信原图下载构造（2026-08-08 实测 dump）：fileKey=adownimg_<hash>_<ts>_<seq>_hevc、
            // fileType=2、customHeader=source_format:1+msgid+source_filesize；
            // 关键：hash 固定 = cf8f8e41a49c1185（两次不同图相同=CDN 会话标识，
            // 随机 hash 会导致 CDN 只返回部分数据 8-80KB，固定 hash 才是完整原图）
            String hash8 = "cf8f8e41a49c1185";
            String fileKey = "adownimg_" + hash8 + "_"
                    + (System.currentTimeMillis() / 1000) + "_1_hevc";
            // savePath 学微信：image2/<前2>/<次2>/<md5>（原图命名，无 th_ 前缀）
            java.io.File target = originalTargetFile(md5);
            String targetPath = target == null ? "" : target.getAbsolutePath();
            // fileid 手动构造：XML 模板 DER + 新时间戳 + 152a 规格码
            String fileid = buildFileId(bigUrl);
            try {
                java.lang.reflect.Method createReq = null;
                for (java.lang.reflect.Method cm : cdn.getDeclaredMethods()) {
                    if (cm.getName().equals("createC2CDownload")
                            && cm.getParameterCount() == 5
                            && java.lang.reflect.Modifier.isStatic(
                                    cm.getModifiers())) {
                        createReq = cm;
                        break;
                    }
                }
                if (createReq != null) {
                    createReq.setAccessible(true);
                    Object created = createReq.invoke(
                            null, bigUrl, fileKey, targetPath, 3, "");
                    if (created != null) {
                        req = created;
                        WechatHook.logAdapterInfo(
                                "[ORIG] req via createC2CDownload factory");
                    }
                }
            } catch (Throwable ignored) {
            }
            if (req == null) {
                req = reqCls.newInstance();
            }
            setStringField(req, "aeskey", aeskey);
            setStringField(req, "fileid", fileid);
            setStringField(req, "fileKey", fileKey);
            setIntField(req, "fileType", 2);
            setIntField(req, "bizid", 1);
            setIntField(req, "certificateVerifyPolicy", 1);
            setIntField(req, "msgType", 1);
            setIntField(req, "requestVideoFormat", 1);
            // 对照微信原图下载 dump：apptype=0 + customHeader 带 msgid
            setIntField(req, "apptype", 0);
            setStringField(req, "customHeader",
                    "source_format:1\r\nmsgid:" + msgSvrId
                            + "\r\nsource_filesize:0");
            // 微信 supportFormats=int[1,2]（实测 dump #1），照抄
            setIntArrayField(req, "supportFormats", new int[]{1, 2});
            if (target != null) {
                setStringField(req, "savePath", targetPath);
            }
            WechatHook.logAdapterInfo("[ORIG] req fileid-len=" + bigUrl.length()
                    + " fileKey=" + fileKey + " savePath="
                    + (target == null ? "null" : target.getAbsolutePath()));
            // 回调：动态代理（接口方法签名未知，拦截打日志 + dump 结果对象）
            ensureCdnHook(cdn);
            Class<?> cbCls = Class.forName(
                    "com.tencent.mars.cdn.CdnManager$DownloadCallback",
                    false, cl);
            Object callback = java.lang.reflect.Proxy.newProxyInstance(
                    cl, new Class<?>[]{cbCls},
                    (proxy, method, args) -> {
                        StringBuilder cbLog = new StringBuilder(
                                "[ORIG-CB] ").append(method.getName()).append('(');
                        if (args != null) {
                            for (int i = 0; i < args.length; i++) {
                                if (i > 0) {
                                    cbLog.append(',');
                                }
                                cbLog.append(args[i] == null ? "null"
                                        : args[i].getClass().getSimpleName());
                            }
                        }
                        cbLog.append(')');
                        WechatHook.logAdapterInfo(cbLog.toString());
                        // 回调结果写文件（C2DownloadResult.fileSize 确认原图）
                        if (args != null) {
                            for (Object arg : args) {
                                if (arg != null) {
                                    try {
                                        writeDumpFile("RESULT "
                                                + method.getName() + ": "
                                                + dumpRequestFields(arg) + "\n");
                                    } catch (Throwable ignored) {
                                    }
                                }
                            }
                        }
                        Class<?> rt = method.getReturnType();
                        if (rt == boolean.class) {
                            return false;
                        }
                        if (rt == int.class) {
                            return 0;
                        }
                        if (rt == long.class) {
                            return 0L;
                        }
                        return null;
                    });
            // 启动下载
            java.lang.reflect.Method start = null;
            for (java.lang.reflect.Method m3 : cdn.getDeclaredMethods()) {
                if (m3.getName().equals("OnJniStartC2CDownload")) {
                    start = m3;
                    break;
                }
            }
            if (start == null) {
                WechatHook.logAdapterInfo("[ORIG] start method not found");
                return null;
            }
            // OnJniStartC2CDownload 是实例方法：反射拿 CdnManager 实例。
            // 1) hook 缓存优先；2) 主动初始化（OnJniCreateCdnManagerFromContext
            // 静态调用）；3) 等微信下载捕获（最多 5s）；4) 静态字段；5) 工厂。
            Object cdnInstance = CDN_INSTANCE;
            if (cdnInstance == null) {
                try {
                    // 静态初始化：微信启动时调用过，若静态可直接再调
                    java.lang.reflect.Method create = null;
                    for (java.lang.reflect.Method cm : cdn.getDeclaredMethods()) {
                        if (cm.getName().equals(
                                "OnJniCreateCdnManagerFromContext")
                                && java.lang.reflect.Modifier.isStatic(
                                        cm.getModifiers())) {
                            create = cm;
                            break;
                        }
                    }
                    if (create != null) {
                        create.setAccessible(true);
                        create.invoke(null,
                                WechatHook.appContext());
                    }
                } catch (Throwable ignored) {
                }
                long instDeadline = System.currentTimeMillis() + 5000;
                while (cdnInstance == null
                        && System.currentTimeMillis() < instDeadline) {
                    try {
                        Thread.sleep(200);
                    } catch (InterruptedException e) {
                        break;
                    }
                    cdnInstance = CDN_INSTANCE;
                }
            }
            if (cdnInstance == null) {
                try {
                    for (java.lang.reflect.Field sf : cdn.getDeclaredFields()) {
                        if (java.lang.reflect.Modifier.isStatic(
                                sf.getModifiers())
                                && cdn.isAssignableFrom(sf.getType())) {
                            sf.setAccessible(true);
                            Object candidate = sf.get(null);
                            if (candidate != null) {
                                cdnInstance = candidate;
                                CDN_INSTANCE = candidate;
                                break;
                            }
                        }
                    }
                } catch (Throwable ignored) {
                }
            }
            if (cdnInstance == null) {
                try {
                    for (java.lang.reflect.Method fm : cdn.getDeclaredMethods()) {
                        if (java.lang.reflect.Modifier.isStatic(
                                fm.getModifiers())
                                && fm.getParameterCount() == 0
                                && cdn.isAssignableFrom(fm.getReturnType())) {
                            fm.setAccessible(true);
                            Object candidate = fm.invoke(null);
                            if (candidate != null) {
                                cdnInstance = candidate;
                                CDN_INSTANCE = candidate;
                                break;
                            }
                        }
                    }
                } catch (Throwable ignored) {
                }
            }
            if (cdnInstance == null) {
                // 单例未找到：dump 静态字段/方法线索（hook 已由 ensureCdnHook 装）
                try {
                    StringBuilder sd = new StringBuilder("[ORIG] static fields:");
                    for (java.lang.reflect.Field sf2 : cdn.getDeclaredFields()) {
                        if (java.lang.reflect.Modifier.isStatic(
                                sf2.getModifiers())) {
                            sd.append(' ').append(sf2.getName()).append(':')
                              .append(sf2.getType().getSimpleName());
                        }
                    }
                    WechatHook.logAdapterInfo(sd.toString());
                    StringBuilder md = new StringBuilder("[ORIG] static methods:");
                    for (java.lang.reflect.Method m4 : cdn.getDeclaredMethods()) {
                        if (java.lang.reflect.Modifier.isStatic(
                                m4.getModifiers())) {
                            md.append(' ').append(m4.getName());
                        }
                    }
                    WechatHook.logAdapterInfo(md.toString());
                } catch (Throwable ignored) {
                }
                return null;
            }
            start.setAccessible(true);
            dumpLog("[ORIG] our req: ", dumpRequestFields(req));
            int startResult = (Integer) start.invoke(
                    cdnInstance, req, callback);
            WechatHook.logAdapterInfo("[ORIG] start=" + startResult
                    + " md5=" + md5 + " len=" + length);
            if (startResult != 0) {
                WechatHook.logAdapterInfo("[ORIG] start failed rc=" + startResult);
                return null;
            }
            if (md5 != null && !md5.isEmpty()) {
                ORIG_IN_FLIGHT.put(md5, System.currentTimeMillis());
            }
            // 轮询落盘：savePath 文件出现且大小接近 expectFileSize 才算完成
            // （mars 边写边落盘，500ms 快照可能抓到半成品——4822 字节教训）
            java.io.File result = pollOriginalFile(target, timeoutMs, length);
            if (md5 != null) {
                ORIG_IN_FLIGHT.remove(md5);
            }
            return result;
        } catch (Throwable error) {
            WechatHook.logAdapterError("[ORIG] fetch failed", error);
            return null;
        }
    }

    /** 请求对象字段值 dump（截断 120 字符/字符串字段，用于对照微信构造）。 */
    private static String dumpRequestFields(Object req) {
        StringBuilder rd = new StringBuilder(8000);
        try {
            for (Class<?> rc = req.getClass();
                    rc != null && rc != Object.class;
                    rc = rc.getSuperclass()) {
                for (java.lang.reflect.Field rf :
                        rc.getDeclaredFields()) {
                    try {
                        rf.setAccessible(true);
                        Object v = rf.get(req);
                        if (v == null) {
                            rd.append(' ').append(rf.getName()).append("=null");
                        } else if (v instanceof byte[]) {
                            rd.append(' ').append(rf.getName())
                              .append("=byte[").append(((byte[]) v).length)
                              .append(']');
                        } else if (v instanceof int[]) {
                            int[] arr = (int[]) v;
                            StringBuilder ab = new StringBuilder("int[");
                            for (int j = 0; j < Math.min(arr.length, 20);
                                    j++) {
                                if (j > 0) {
                                    ab.append(',');
                                }
                                ab.append(arr[j]);
                            }
                            ab.append(']');
                            rd.append(' ').append(rf.getName()).append('=')
                              .append(ab);
                        } else if (v instanceof String) {
                            String s = (String) v;
                            rd.append(' ').append(rf.getName()).append('=').append(
                                    s.length() > 400
                                            ? s.substring(0, 400) + "..."
                                            : s);
                        } else {
                            rd.append(' ').append(rf.getName()).append('=')
                              .append(String.valueOf(v));
                        }
                    } catch (Throwable ignored) {
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return rd.toString();
    }

    /** 分段打印长 dump（绕 logcat ~4KB 单行截断）。 */
    private static void dumpLog(String tag, String dump) {
        if (dump == null || dump.isEmpty()) {
            return;
        }
        int chunk = 1400;
        if (dump.length() <= chunk) {
            WechatHook.logAdapterInfo(tag + dump);
            return;
        }
        for (int i = 0; i < dump.length(); i += chunk) {
            WechatHook.logAdapterInfo(tag + "[" + i + "]: "
                    + dump.substring(i, Math.min(i + chunk, dump.length())));
        }
    }

    /** 用微信 WXGF 解码器（MMWXGFJNI buffer API）把 wxgf 数据解码成 Bitmap。
     *  wxgf=微信 HEVC 私有图片格式（文件头 wxgf），BitmapFactory 无法解码；
     *  流程照抄微信：nativeInitWxAMDecoder -> nativeDecodeBufferHeader ->
     *  nativeGetOption(宽高) -> nativeDecodeBufferFrame -> nativeUninit。
     *  Codex 建议：MMWXGFJNI 底层可能有全局状态（HEVC context/硬解器），
     *  handle 独立不等于可重入——整个会话串行化（双 hook 并发解码是竞态源）。 */
    private static final Object WXGF_DECODER_LOCK = new Object();

    private static android.graphics.Bitmap decodeWxgfToBitmap(
            java.io.File wxgf) {
        synchronized (WXGF_DECODER_LOCK) {
            return decodeWxgfLocked(wxgf);
        }
    }

    private static android.graphics.Bitmap decodeWxgfLocked(
            java.io.File wxgf) {
        try {
            Class<?> jni = Class.forName(
                    "com.tencent.mm.plugin.gif.MMWXGFJNI", false,
                    WechatHook.appContext().getClassLoader());
            byte[] data = new byte[(int) wxgf.length()];
            java.io.FileInputStream fis =
                    new java.io.FileInputStream(wxgf);
            int off = 0;
            while (off < data.length) {
                int r = fis.read(data, off, data.length - off);
                if (r < 0) {
                    break;
                }
                off += r;
            }
            fis.close();
            java.lang.reflect.Method init = findMethod(jni,
                    "nativeInitWxAMDecoder");
            long handle = (Long) init.invoke(null);
            if (handle == 0) {
                WechatHook.logAdapterInfo("[ORIG] wxgf init=0");
                return null;
            }
            try {
                java.lang.reflect.Method decHeader = findMethod(jni,
                        "nativeDecodeBufferHeader", long.class,
                        byte[].class, int.class);
                int rc1 = (Integer) decHeader.invoke(null,
                        handle, data, data.length);
                java.lang.reflect.Method getOpt = findMethod(jni,
                        "nativeGetOption", long.class,
                        byte[].class, int.class, int[].class);
                int[] opts = new int[16];
                int rc2 = (Integer) getOpt.invoke(null,
                        handle, data, data.length, opts);
                // log opts 全数组（Grok 建议：确认宽高下标位置）
                StringBuilder ob = new StringBuilder(
                        "[ORIG] wxgf opts rc=" + rc2 + ":");
                for (int v : opts) {
                    ob.append(' ').append(v);
                }
                WechatHook.logAdapterInfo(ob.toString());
                // Codex 建议：rc1/rc2 必须为 0，失败即关闭（不再继续）
                if (rc1 != 0 || rc2 != 0) {
                    WechatHook.logAdapterInfo(
                            "[ORIG] wxgf header/opt rc=" + rc1 + "/" + rc2);
                    return null;
                }
                // 实测 opts: [0]=1(格式标志) [1]=宽 [2]=高（2026-08-08 实测
                // 2744x1280）；旧取 opts[0]/[1] 导致 1px 宽 Bitmap + native 卡死
                int w = opts[1];
                int h = opts[2];
                // Codex 建议：宽高异常直接失败关闭（猜尺寸 fallback 不安全，
                // 真实帧更大时按真实 stride 写入小分配会越界）
                if (w <= 0 || h <= 0 || w > 8000 || h > 8000) {
                    WechatHook.logAdapterInfo(
                            "[ORIG] wxgf opts 宽高异常 w=" + w + " h=" + h);
                    return null;
                }
                android.graphics.Bitmap bmp = android.graphics.Bitmap
                        .createBitmap(w, h,
                                android.graphics.Bitmap.Config.ARGB_8888);
                java.lang.reflect.Method decFrame = findMethod(jni,
                        "nativeDecodeBufferFrame", long.class,
                        byte[].class, int.class,
                        android.graphics.Bitmap.class, int[].class);
                int[] outInfo = new int[4];
                int rc3 = (Integer) decFrame.invoke(null,
                        handle, data, data.length, bmp, outInfo);
                WechatHook.logAdapterInfo(
                        "[ORIG] wxgf frame rc=" + rc3 + " out="
                                + outInfo[0] + "," + outInfo[1] + ","
                                + outInfo[2] + "," + outInfo[3]
                                + " bmp=" + w + "x" + h);
                if (rc3 != 0) {
                    return null;
                }
                // 宽高用 opts 值（nativeGetOption 返回），全程不访问 bitmap
                // 方法——2026-08-08 实测 copy 后 getWidth 偶发挂起（微信 native
                // 引用竞争），读取一律用 w/h（opts[1]/opts[2]）
                WXGF_W = w;
                WXGF_H = h;
                // nativeUninit 会释放 Bitmap 的 native 像素（实测坏引用），
                // 必须先 copy 到 Java 内存再返回（2026-08-08 实测修复）
                android.graphics.Bitmap safe = bmp.copy(
                        android.graphics.Bitmap.Config.ARGB_8888, false);
                // 不主动 recycle 原图：实测 recycle 后 safe 的 native 引用
                // 连带释放（isRecycled 误报 → 压缩静默跳过）；靠 GC 回收
                WechatHook.logAdapterInfo(
                        "[ORIG] wxgf copy " + (safe == null ? "null"
                                : w + "x" + h));
                return safe;
            } finally {
                try {
                    findMethod(jni, "nativeUninit", long.class)
                            .invoke(null, handle);
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable error) {
            WechatHook.logAdapterError(
                    "[ORIG] wxgf decode error", error);
            return null;
        }
    }

    /** 按名字+参数找方法（避免 getMethod 因 private 失败）。 */
    private static java.lang.reflect.Method findMethod(
            Class<?> cls, String name, Class<?>... params) {
        try {
            java.lang.reflect.Method m = cls.getDeclaredMethod(
                    name, params);
            m.setAccessible(true);
            return m;
        } catch (Throwable t) {
            return null;
        }
    }

    /** 读 request 单字段字符串（private 也可）。 */
    private static String dumpFieldString(Object target, String name) {
        java.lang.reflect.Field f = findField(target, name);
        if (f == null) {
            return null;
        }
        try {
            Object v = f.get(target);
            return v == null ? null : String.valueOf(v);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static volatile int WXGF_W;
    private static volatile int WXGF_H;

    /** 提前装 CdnManager hook（消息入库时尝试，类未加载则等下条消息）。 */
    private static void ensureCdnHookEarly(Object message) {
        if (CDN_HOOK_TRIED) {
            return;
        }
        try {
            Class<?> cdn = Class.forName(
                    "com.tencent.mars.cdn.CdnManager", false,
                    message.getClass().getClassLoader());
            ensureCdnHook(cdn);
        } catch (Throwable ignored) {
        }
        // WXGF 解码器签名 dump（wxgf=微信 HEVC 私有格式，
        // nativeWxam2PicBuf JNI 解码；写文件避免截断）
        try {
            Class<?> wxgfJni = Class.forName(
                    "com.tencent.mm.plugin.gif.MMWXGFJNI", false,
                    message.getClass().getClassLoader());
            StringBuilder wb = new StringBuilder("WXGFJNI ");
            for (java.lang.reflect.Method m :
                    wxgfJni.getDeclaredMethods()) {
                wb.append('\n').append(
                        java.lang.reflect.Modifier.toString(
                                m.getModifiers())).append(' ')
                  .append(m.getName()).append('(');
                Class<?>[] pts = m.getParameterTypes();
                for (int i = 0; i < pts.length; i++) {
                    if (i > 0) {
                        wb.append(", ");
                    }
                    wb.append(pts[i].getName());
                }
                wb.append(") -> ").append(
                        m.getReturnType().getName());
            }
            writeDumpFile(wb.append('\n').toString());
            WechatHook.logAdapterInfo(
                    "[ORIG] wxgf jni dumped");
        } catch (Throwable ignored) {
            WechatHook.logAdapterInfo(
                    "[ORIG] wxgf jni not found");
        }
    }

    /** 写 dump 文件（logcat 有 ~4KB 截断，Grok 建议写文件抓完整 request）。 */
    private static void writeDumpFile(String content) {
        try {
            java.io.File f = new java.io.File(
                    WechatHook.appContext().getCacheDir(), "wx_orig_dump.txt");
            java.io.FileWriter w = new java.io.FileWriter(f, true);
            w.write(content);
            w.close();
        } catch (Throwable ignored) {
        }
    }

    /** 一次性安装 CdnManager 实例捕获 hook（所有实例方法，微信任何下载
     *  都触发捕获；OnJniStartC2CDownload 额外 dump 微信 request 构造一次）。 */
    private static void ensureCdnHook(Class<?> cdn) {
        if (CDN_HOOK_TRIED) {
            return;
        }
        synchronized (Wechat8078Adapter.class) {
            if (CDN_HOOK_TRIED) {
                return;
            }
            CDN_HOOK_TRIED = true;
            int hooked = 0;
            for (java.lang.reflect.Method hm : cdn.getDeclaredMethods()) {
                if (java.lang.reflect.Modifier.isStatic(hm.getModifiers())) {
                    continue;
                }
                try {
                    XposedBridge.hookMethod(hm, new XC_MethodHook() {
                        @Override
                        protected void beforeHookedMethod(
                                MethodHookParam param) {
                            if (param.thisObject != null) {
                                CDN_INSTANCE = param.thisObject;
                            }                            // dump 微信自己的下载请求：写文件（绕 logcat 截断），
                            // 判定原图请求（fileKey 含 downimgbig 或
                            // customHeader 含 source_format:2）优先完整记录
                            if (!"OnJniStartC2CDownload".equals(
                                    param.method.getName())
                                    || "feagle-orig".equals(
                                            Thread.currentThread().getName())
                                    || param.args == null
                                    || param.args.length == 0) {
                                return;
                            }
                            try {
                                Object req = param.args[0];
                                String fk = dumpFieldString(req, "fileKey");
                                String ch = dumpFieldString(req, "customHeader");
                                // 原图请求判定（实测：微信原图下载 fileKey=
                                // adownimg_... 或 customHeader 含 msgid:）
                                boolean isOrig = (fk != null
                                        && fk.contains("adownimg"))
                                        || (ch != null
                                        && ch.contains("msgid:"));
                                if (isOrig || CDN_REQ_DUMP_COUNT < 3) {
                                    CDN_REQ_DUMP_COUNT++;
                                    StringBuilder rd = new StringBuilder(
                                            "=== ").append(isOrig
                                                    ? "ORIG" : "OTHER")
                                              .append(" #")
                                              .append(CDN_REQ_DUMP_COUNT)
                                              .append(' ').append(
                                                      System.currentTimeMillis())
                                              .append(" ===\n");
                                    rd.append(dumpRequestFields(req))
                                      .append('\n');
                                    // 调用栈（定位微信原图下载入口方法）
                                    if (isOrig) {
                                        StackTraceElement[] st =
                                                Thread.currentThread()
                                                        .getStackTrace();
                                        rd.append("STACK:\n");
                                        for (int i = 3;
                                                i < Math.min(st.length, 20);
                                                i++) {
                                            rd.append("  ").append(st[i])
                                              .append('\n');
                                        }
                                    }
                                    writeDumpFile(rd.toString());
                                    WechatHook.logAdapterInfo(
                                            "[ORIG] wx req #" + CDN_REQ_DUMP_COUNT
                                                    + (isOrig ? " ORIG" : "")
                                                    + " -> file");
                                }
                            } catch (Throwable ignored) {
                            }
                        }
                    });
                    hooked++;
                } catch (Throwable ignored) {
                }
            }
            WechatHook.logAdapterInfo("[ORIG] cdn hooks installed=" + hooked);
            // hook 微信 CDN request 构造（modelcdntran.l1.t，调用栈实测），
            // after 拿微信生成的完整 request（fileKey 含真实 adownimg hash）
            try {
                Class<?> l1 = Class.forName(
                        "com.tencent.mm.modelcdntran.l1", false,
                        WechatHook.appContext().getClassLoader());
                XposedBridge.hookAllMethods(l1, "t", new XC_MethodHook() {
                    @Override
                    protected void afterHookedMethod(
                            MethodHookParam param) {
                        try {
                            StringBuilder rb = new StringBuilder("L1T ");
                            if (param.args != null) {
                                for (Object a : param.args) {
                                    if (a != null) {
                                        rb.append('[').append(
                                                a.getClass().getSimpleName())
                                          .append("] ");
                                    }
                                }
                            }
                            if (param.getResult() != null) {
                                rb.append("=> ")
                                  .append(param.getResult()
                                          .getClass().getSimpleName())
                                  .append(' ')
                                  .append(param.getResult());
                            }
                            writeDumpFile(rb.append('\n').toString());
                            WechatHook.logAdapterInfo("[ORIG] l1.t -> file");
                        } catch (Throwable ignored) {
                        }
                    }
                });
                WechatHook.logAdapterInfo("[ORIG] l1.t hooked");
            } catch (Throwable ignored) {
                WechatHook.logAdapterInfo("[ORIG] l1.t hook failed");
            }
        }
    }

    private static java.io.File pollOriginalFile(
            java.io.File target, long timeoutMs, long expectSize) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        // 阈值：≥10% 或 ≥15KB 尽快返回；超时后只要有 >10KB 文件就用
        // （实测 CDN 对大图只给 59-75KB wxgf，10% 阈值对大图太苛刻；
        //  wxgf 是 HEVC 压缩，解码后分辨率由内容决定）
        long threshold = Math.max(expectSize / 10L, 15_000L);
        while (System.currentTimeMillis() < deadline) {
            if (target.isFile() && target.length() >= threshold) {
                return target;
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException ignored) {
                return null;
            }
        }
        if (target.isFile() && target.length() > 10_000) {
            return target;
        }
        return null;
    }

    /** 在 image2/<前2>/<次2>/ 下找 <md5> 命名的文件（无 th_ 前缀=原图/中图）。 */
    private static java.io.File findMd5File(
            java.io.File microMsg, String md5) {
        if (microMsg == null || !microMsg.isDirectory() || md5 == null
                || md5.length() != 32) {
            return null;
        }
        java.io.File[] userDirs = microMsg.listFiles();
        if (userDirs == null) {
            return null;
        }
        for (java.io.File userDir : userDirs) {
            if (!userDir.isDirectory()
                    || !userDir.getName().matches("^[0-9a-f]{32}$")) {
                continue;
            }
            java.io.File image2 = new java.io.File(userDir, "image2");
            java.io.File[] d1 = image2.listFiles();
            if (d1 == null) {
                continue;
            }
            for (java.io.File f1 : d1) {
                if (!f1.isDirectory() || f1.getName().startsWith(".")) {
                    continue;
                }
                java.io.File[] d2 = f1.listFiles();
                if (d2 == null) {
                    continue;
                }
                for (java.io.File f2 : d2) {
                    if (!f2.isDirectory()) {
                        continue;
                    }
                    java.io.File cand = new java.io.File(f2, md5);
                    if (cand.isFile() && cand.length() > 0) {
                        return cand;
                    }
                }
            }
        }
        return null;
    }

    private static final java.util.regex.Pattern DER_UUID =
            java.util.regex.Pattern.compile(
                    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
                            + "[0-9a-f]{4}-[0-9a-f]{12}");

    /** CdnManager 实例缓存：优先用 hook 捕获（微信下载时必调实例方法）。 */
    private static volatile Object CDN_INSTANCE;
    private static volatile boolean CDN_HOOK_TRIED;
    private static volatile int CDN_REQ_DUMP_COUNT;

    /** 在途原图下载去重（md5 → 开始时间戳；两个 hook 路径会各起一个线程）。 */
    private static final java.util.Map<String, Long> ORIG_IN_FLIGHT =
            new ConcurrentHashMap<>();

    /** 解析 DER hex 里的 UUID + IPv4（微信 CDN 定位信息）。 */
    private static String[] parseDerUrl(String derHex) {
        String[] result = new String[]{"", ""};
        try {
            byte[] raw = hexDecode(derHex);
            String latin = new String(raw,
                    java.nio.charset.StandardCharsets.ISO_8859_1);
            java.util.regex.Matcher m = DER_UUID.matcher(latin);
            if (m.find()) {
                result[0] = m.group();
            }
            for (int i = 0; i + 5 < raw.length; i++) {
                if (raw[i] == 0x02 && raw[i + 1] == 0x04) {
                    result[1] = (raw[i + 2] & 0xFF) + "."
                            + (raw[i + 3] & 0xFF) + "."
                            + (raw[i + 4] & 0xFF) + "."
                            + (raw[i + 5] & 0xFF);
                    break;
                }
            }
        } catch (Throwable ignored) {
        }
        return result;
    }

    private static byte[] hexDecode(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            out[i / 2] = (byte) Integer.parseInt(
                    hex.substring(i, i + 2), 16);
        }
        return out;
    }

    private static String stringGetter(Object target, String name) {
        try {
            java.lang.reflect.Method m = target.getClass().getMethod(name);
            Object v = m.invoke(target);
            return v == null ? null : String.valueOf(v);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static long longGetter(Object target, String name) {
        try {
            java.lang.reflect.Method m = target.getClass().getMethod(name);
            Object v = m.invoke(target);
            return v instanceof Number ? ((Number) v).longValue() : 0L;
        } catch (Throwable ignored) {
            return 0L;
        }
    }

    /** 设置字段（private 也可：declared 遍历 + setAccessible）。
     *  实测：savePath 等字段非 public，getField 会静默失败（-20003 根因之一）。 */
    private static void setStringField(Object target, String name, String value) {
        java.lang.reflect.Field f = findField(target, name);
        if (f == null) {
            return;
        }
        try {
            f.set(target, value);
        } catch (Throwable ignored) {
        }
    }

    private static void setLongField(Object target, String name, long value) {
        java.lang.reflect.Field f = findField(target, name);
        if (f == null) {
            return;
        }
        try {
            f.set(target, value);
        } catch (Throwable ignored) {
        }
    }

    private static void setIntField(Object target, String name, int value) {
        java.lang.reflect.Field f = findField(target, name);
        if (f == null) {
            return;
        }
        try {
            f.set(target, value);
        } catch (Throwable ignored) {
        }
    }

    private static void setIntArrayField(
            Object target, String name, int[] value) {
        java.lang.reflect.Field f = findField(target, name);
        if (f == null) {
            return;
        }
        try {
            f.set(target, value);
        } catch (Throwable ignored) {
        }
    }

    /** 沿继承链找字段（declared），setAccessible 后返回。 */
    private static java.lang.reflect.Field findField(Object target, String name) {
        for (Class<?> c = target.getClass(); c != null && c != Object.class;
                c = c.getSuperclass()) {
            try {
                java.lang.reflect.Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f;
            } catch (NoSuchFieldException ignored) {
            } catch (Throwable ignored) {
            }
        }
        return null;
    }

    /** 回调结果对象 dump（截断 80 字符/字段，防日志爆炸）。 */
    private static String previewFieldDump(Object target) {
        StringBuilder sb = new StringBuilder(400);
        sb.append(target.getClass().getSimpleName()).append('{');
        try {
            for (java.lang.reflect.Field f :
                    target.getClass().getDeclaredFields()) {
                try {
                    f.setAccessible(true);
                    Object v = f.get(target);
                    sb.append(f.getName()).append('=');
                    if (v == null) {
                        sb.append("null");
                    } else if (v instanceof byte[]) {
                        sb.append("byte[").append(((byte[]) v).length).append(']');
                    } else {
                        String s = String.valueOf(v);
                        sb.append(s.length() > 80
                                ? s.substring(0, 80) + "..." : s);
                    }
                    sb.append(' ');
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable ignored) {
        }
        return sb.append('}').toString();
    }

    /** 群名缓存（talker → field_nickname），由 Contact getter hook 填充。 */
    private static final java.util.Map<String, String> GROUP_NAME_CACHE =
            new ConcurrentHashMap<>();

    /** 查询群名（未缓存返回 null，Bridge 侧 fallback 占位名）。 */
    static String groupNameFor(String talker) {
        if (talker == null) {
            return null;
        }
        return GROUP_NAME_CACHE.get(talker);
    }

    /** Hook Contact 实体（pl.f2 = rcontact 表）的 getter 方法：微信渲染会话列表
     *  必然调用，捕获实例缓存群名（field_nickname）。 */
    private static int hookContactEntity(ClassLoader classLoader) {
        try {
            Class<?> contactClass = XposedHelpers.findClass("com.tencent.mm.contact.s", classLoader);
            XC_MethodHook cacheHook = new XC_MethodHook() {
                @Override
                protected void afterHookedMethod(MethodHookParam param) {
                    try {
                        Object contact = param.thisObject;
                        String username = (String) XposedHelpers
                                .getObjectField(contact, "field_username");
                        if (username == null || !username.toLowerCase(
                                java.util.Locale.ROOT).endsWith("@chatroom")) {
                            return;
                        }
                        Object nickname = XposedHelpers.getObjectField(
                                contact, "field_nickname");
                        if (nickname instanceof String
                                && !((String) nickname).isEmpty()) {
                            GROUP_NAME_CACHE.put(username, (String) nickname);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            };
            int hooked = 0;
            for (Method method : contactClass.getDeclaredMethods()) {
                if (method.getParameterTypes().length == 0
                        && method.getReturnType() == String.class) {
                    try {
                        method.setAccessible(true);
                        XposedBridge.hookMethod(method, cacheHook);
                        hooked++;
                    } catch (Throwable ignored) {
                    }
                }
            }
            try {
                XposedBridge.hookAllConstructors(contactClass, cacheHook);
            } catch (Throwable ignored) {
            }
            WechatHook.logAdapterInfo(
                    "8.0.78 contact entity hook installed getters=" + hooked);
            return hooked > 0 ? 1 : 0;
        } catch (Throwable ignored) {
            return 0;
        }
    }

    /** 格式化群聊消息正文（加上群成员发送者前缀）。 */
    private static String formatGroupContent(String talker, String rawContent, String text) {
        if (isGroupTalker(talker)) {
            String qSender = quoteSender(rawContent);
            if (qSender != null && !qSender.isEmpty()) {
                return qSender + ":\n" + text;
            }
        }
        return text;
    }

    /** 检查 AppMsg 的子类型是否匹配。 */
    private static boolean isAppMsgType(String xml, int targetType) {
        if (xml == null) return false;
        String typeTag = extractXmlTag(xml, "type");
        if (typeTag != null) {
            try {
                if (typeTag.startsWith("<![CDATA[") && typeTag.endsWith("]]>")) {
                    typeTag = typeTag.substring(9, typeTag.length() - 3);
                }
                return Integer.parseInt(typeTag.trim()) == targetType;
            } catch (Throwable ignored) {}
        }
        return false;
    }

    /** 格式化文件大小为易读字符串。 */
    private static String formatFileSize(String totalLenStr) {
        try {
            long bytes = Long.parseLong(totalLenStr.trim());
            if (bytes < 1024) return bytes + "B";
            if (bytes < 1024 * 1024) return String.format(java.util.Locale.ROOT, "%.1fKB", bytes / 1024.0);
            return String.format(java.util.Locale.ROOT, "%.1fMB", bytes / (1024.0 * 1024.0));
        } catch (Throwable ignored) {
            return "";
        }
    }

    /** 从 XML 字符串中提取指定标签的文本（单行标签，如 <title>xxx</title>），支持 CDATA 与实体转义还原。 */
    private static String extractXmlTag(String xml, String tag) {
        if (xml == null || tag == null) {
            return null;
        }
        String open = "<" + tag + ">";
        String close = "</" + tag + ">";
        int start = xml.indexOf(open);
        if (start < 0) {
            return null;
        }
        start += open.length();
        int end = xml.indexOf(close, start);
        if (end < 0) {
            return null;
        }
        String value = xml.substring(start, end);
        if (value.startsWith("<![CDATA[") && value.endsWith("]]>")) {
            value = value.substring(9, value.length() - 3);
        }
        value = value.replace("&#x20;", " ")
                     .replace("&nbsp;", " ")
                     .replace("&amp;", "&")
                     .replace("&lt;", "<")
                     .replace("&gt;", ">")
                     .replace("&quot;", "\"");
        return value.replaceAll("\\s+", " ").trim();
    }

    /** 从群聊 content 前缀提取发送者（"发送者wxid:" 冒号前截取）。 */
        private static String formatQuoteContent(String talker, String rawContent, String title) {
        String refermsg = extractXmlTag(rawContent, "refermsg");
        String quotePrefix = "";
        if (refermsg != null && !refermsg.isEmpty()) {
            String refUser = extractXmlTag(refermsg, "displayname");
            if (refUser == null || refUser.isEmpty()) {
                refUser = extractXmlTag(refermsg, "fromusr");
            }
            String refContent = extractXmlTag(refermsg, "content");
            if (refContent != null && (refContent.contains("<msg><img") || refContent.contains("<img") || refContent.contains("cdnthumburl"))) {
                refContent = "[\u56fe\u7247]";
            }
            if (refUser != null && !refUser.isEmpty() && refContent != null && !refContent.isEmpty()) {
                quotePrefix = "[\u5f15\u7528 \"" + refUser.trim() + ": " + refContent.trim() + "\"] ";
            }
        }
        String fullContent = quotePrefix + (title != null ? title.trim() : "");
        if (isGroupTalker(talker)) {
            String qSender = quoteSender(rawContent);
            if (qSender != null && !qSender.isEmpty()) {
                return qSender + ":\n" + fullContent;
            }
        }
        return fullContent;
    }

    private static String quoteSender(String content) {
        if (content == null || content.isEmpty()) {
            return "";
        }
        String normalized = content.replaceAll("(?i)<br\\s*/?>", "\n");
        int sep = normalized.indexOf(':');
        if (sep <= 0) {
            return "";
        }
        String sender = normalized.substring(0, sep).trim();
        if (sender.isEmpty() || sender.length() > 256) {
            return "";
        }
        return sender;
    }

    /** 打码 wxid 形式的标识（诊断日志用，保留其余内容）。 */
    private static String maskId(String value) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        return value.replaceAll("wxid_[0-9a-zA-Z]{4,}", "wxid_***");
    }

    /** 诊断限流：每 20 秒窗口最多 15 条 dump，防日志刷屏拖慢微信。 */
    private static String stringFieldOrMethods(
            Object target, String fieldName, String[] methodNames) {
        Object fieldValue = value(target, fieldName, null);
        if (fieldValue != null) {
            String result = String.valueOf(fieldValue);
            if (!result.isEmpty()) {
                return result;
            }
        }
        for (String methodName : methodNames) {
            try {
                Object methodValue = XposedHelpers.callMethod(target, methodName);
                if (methodValue != null) {
                    String result = String.valueOf(methodValue);
                    if (!result.isEmpty()) {
                        return result;
                    }
                }
            } catch (Throwable ignored) {
            }
        }
        return "";
    }

    private static int intFieldOrMethod(
            Object target, String fieldName, String methodName, int fallback) {
        Object value = value(target, fieldName, methodName);
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    private static long longFieldOrMethod(
            Object target, String fieldName, String methodName, long fallback) {
        Object value = value(target, fieldName, methodName);
        return value instanceof Number ? ((Number) value).longValue() : fallback;
    }

    private static boolean booleanFieldOrMethod(
            Object target, String fieldName, String methodName, boolean fallback) {
        Object value = value(target, fieldName, methodName);
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue() != 0;
        }
        return fallback;
    }

    private static Object value(Object target, String fieldName, String methodName) {
        try {
            return XposedHelpers.getObjectField(target, fieldName);
        } catch (Throwable ignored) {
            if (methodName == null || methodName.isEmpty()) {
                return null;
            }
            try {
                return XposedHelpers.callMethod(target, methodName);
            } catch (Throwable ignoredMethod) {
                return null;
            }
        }
    }
}
