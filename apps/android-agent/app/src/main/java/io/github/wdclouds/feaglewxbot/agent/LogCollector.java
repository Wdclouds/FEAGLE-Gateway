package io.github.wdclouds.feaglewxbot.agent;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class LogCollector {
    private static final int MAX_LOGS = 300;
    private static final ArrayDeque<String> logs = new ArrayDeque<>();
    private static final SimpleDateFormat sdf = new SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault());
    private static Runnable changeListener = null;

    public static synchronized void log(String tag, String message) {
        String time = sdf.format(new Date());
        String entry = time + " [" + tag + "] " + message;
        if (logs.size() >= MAX_LOGS) {
            logs.pollFirst();
        }
        logs.addLast(entry);
        if (changeListener != null) {
            changeListener.run();
        }
    }

    public static synchronized void setChangeListener(Runnable listener) {
        changeListener = listener;
    }

    public static synchronized List<String> getAllLogs() {
        return new ArrayList<>(logs);
    }

    public static synchronized String getRecent50LogsAsString() {
        List<String> list = new ArrayList<>(logs);
        int start = Math.max(0, list.size() - 50);
        StringBuilder sb = new StringBuilder();
        for (int i = start; i < list.size(); i++) {
            sb.append(list.get(i)).append("\n");
        }
        return sb.toString().trim();
    }
}
