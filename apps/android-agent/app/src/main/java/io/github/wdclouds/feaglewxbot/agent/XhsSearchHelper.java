package io.github.wdclouds.feaglewxbot.agent;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * 小红书原生自动化搜索执行器 (Root + DeepLink + 节点解析)
 * 无需开启系统无障碍服务，全走 Linux 底层调度，毫秒级抓取。
 */
public final class XhsSearchHelper {
    private static final String TAG = "FEAGLE-XhsSearch";

    public static JSONObject search(String keyword) {
        JSONObject res = new JSONObject();
        try {
            res.put("query", keyword);
            Log.i(TAG, "Starting XHS search for: " + keyword);

            // 1. 唤醒并解锁屏幕
            runSu("/system/bin/input keyevent 224 && /system/bin/wm dismiss-keyguard && /system/bin/input swipe 1000 600 200 600 200");
            Thread.sleep(500);

            // 2. 调起小红书深链接直接进入搜索结果页
            String enc = URLEncoder.encode(keyword, "UTF-8");
            String cmd = "/system/bin/am start -a android.intent.action.VIEW -d \"xhsdiscover://search/result?keyword=" + enc + "\" com.xingin.xhs";
            runSu(cmd);

            // 3. 等待内容渲染
            Thread.sleep(3000);

            // 4. Dump UI 并解析节点与截图存照
            String dumpPath = "/data/local/tmp/xhs_search_res.xml";
            String shotPath = "/sdcard/Pictures/xhs_latest.png";
            runSu("/system/bin/screencap -p " + shotPath + " && chmod 666 " + shotPath);
            runSu("/system/bin/uiautomator dump " + dumpPath);

            List<String> rawTexts = parseDumpXml(dumpPath);
            Set<String> cleanSet = new LinkedHashSet<>();
            for (String val : rawTexts) {
                if (val == null || val.length() < 3) continue;
                if (val.contains("搜索") || val.contains("取消") || val.contains("筛选") ||
                    val.contains("图文") || val.contains("视频") || val.contains("用户") ||
                    val.contains("关注") || val.contains("发现") || val.contains("我") ||
                    val.contains("商城") || val.contains("全部") || val.contains("粉丝") ||
                    val.contains("小红书号") || val.contains("无更多")) {
                    continue;
                }
                cleanSet.add(val);
                if (cleanSet.size() >= 8) break;
            }

            JSONArray arr = new JSONArray();
            for (String note : cleanSet) {
                arr.put(note);
            }
            res.put("ok", true);
            res.put("notes", arr);
            res.put("screenshot", shotPath);

            // 5. 任务完成，返回桌面以保持环境整洁
            runSu("/system/bin/input keyevent KEYCODE_HOME");

        } catch (Exception e) {
            Log.e(TAG, "XHS search error: " + e.getMessage(), e);
            try {
                res.put("ok", false);
                res.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return res;
    }

    private static List<String> parseDumpXml(String path) {
        List<String> list = new ArrayList<>();
        try {
            File f = new File(path);
            if (!f.exists()) return list;
            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            DocumentBuilder db = dbf.newDocumentBuilder();
            Document doc = db.parse(f);
            NodeList nodes = doc.getElementsByTagName("node");
            for (int i = 0; i < nodes.getLength(); i++) {
                Element el = (Element) nodes.item(i);
                String t = el.getAttribute("text");
                String d = el.getAttribute("content-desc");
                String val = (t != null && !t.isEmpty()) ? t.trim() : (d != null ? d.trim() : "");
                if (!val.isEmpty()) {
                    list.add(val);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "parseDumpXml err: " + e.getMessage());
        }
        return list;
    }

    /** 执行 root 命令并返回退出码（0 = 成功，-1 = 所有 su 路径都失败）。 */
    public static int runSuResult(String command) {
        String[] suPaths = {"/system_ext/bin/su", "/system/bin/su", "/system/xbin/su", "su"};
        for (String su : suPaths) {
            try {
                Process p = Runtime.getRuntime().exec(new String[]{su, "-c", command});
                int code = p.waitFor();
                Log.i(TAG, "runSu " + su + " code=" + code + " for: " + command);
                if (code == 0) {
                    return 0;
                }
            } catch (Exception e) {
                Log.w(TAG, "runSu failed with " + su + ": " + e.getMessage());
            }
        }
        return -1;
    }

    public static void runSu(String command) {
        runSuResult(command);
    }
}
