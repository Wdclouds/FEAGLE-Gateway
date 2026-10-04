package io.github.wdclouds.feaglewxbot.agent;

import android.util.Log;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.Configuration;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.app.AlertDialog;
import org.json.JSONObject;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URI;
import java.util.Collections;
import java.util.List;

public class MainActivity extends Activity {
    private static final String TAG = "MainActivity";
    private boolean isDarkMode;
    private int COLOR_BG;
    private int COLOR_SURFACE;
    private int COLOR_BORDER;
    private int COLOR_TEXT_PRI;
    private int COLOR_TEXT_SEC;
    private int COLOR_ACCENT;
    private static final int COLOR_SUCCESS = 0xFF2DA44E;     // Green Success
    private static final int COLOR_WARNING = 0xFFBF8700;     // Orange Warning
    private static final int COLOR_DANGER = 0xFFCF222E;      // Red Error

    private void initTheme() {
        int nightModeFlags = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        isDarkMode = (nightModeFlags == Configuration.UI_MODE_NIGHT_YES);

        if (isDarkMode) {
            // Dark Mode (GitHub Dark)
            COLOR_BG = 0xFF0D1117;
            COLOR_SURFACE = 0xFF161B22;
            COLOR_BORDER = 0xFF30363D;
            COLOR_TEXT_PRI = 0xFFF0F6FC;
            COLOR_TEXT_SEC = 0xFF8B949E;
            COLOR_ACCENT = 0xFF58A6FF;
        } else {
            // Light Mode (GitHub Light / Clean Modern)
            COLOR_BG = 0xFFF6F8FA;
            COLOR_SURFACE = 0xFFFFFFFF;
            COLOR_BORDER = 0xFFD0D7DE;
            COLOR_TEXT_PRI = 0xFF1F2328;
            COLOR_TEXT_SEC = 0xFF656D76;
            COLOR_ACCENT = 0xFF0969DA;
        }
    }

    private SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());

    // Tabs
    private FrameLayout contentContainer;
    private ScrollView overviewPage;
    private FrameLayout logPage;
    private TextView navOverviewBtn;
    private TextView navLogBtn;
    private int currentTab = 0; // 0: Overview, 1: Log

    // Overview components
    private TextView wechatStatusBadge;
    private TextView serviceStatusBadge;
    private TextView bridgeStatusBadge;
    private TextView localIpText;
    private TextView targetIpText;
    private TextView currentGatewayText;
    private EditText gatewayInput;
    private EditText tokenInput;
    private Button startStopBtn;
    private TextView statDeviceText;
    private TextView statLatencyText;
    private TextView statInboundText;
    private TextView statOutboundText;

    // Log components
    private TextView logTextView;
    private ScrollView logScrollView;

    private final Runnable refreshStatus = new Runnable() {
        @Override
        public void run() {
            if (isFinishing() || isDestroyed()) return;
            updateOverviewState();
            handler.postDelayed(this, 1500);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initTheme();
        prefs = getSharedPreferences(AgentProtocol.PREFS, MODE_PRIVATE);

        // Root vertical layout: Content + Bottom Navigation
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(COLOR_BG);

        // 1. Content Container (Weight 1)
        contentContainer = new FrameLayout(this);
        LinearLayout.LayoutParams contentLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f);
        contentContainer.setLayoutParams(contentLp);

        // Build Pages
        buildOverviewPage();
        buildLogPage();

        contentContainer.addView(overviewPage);
        contentContainer.addView(logPage);
        logPage.setVisibility(View.GONE);

        // 2. Bottom Navigation Bar (Fixed Height 56dp)
        View bottomNav = buildBottomNav();

        root.addView(contentContainer);
        root.addView(bottomNav);

        setContentView(root);
        requestNotificationPermission();

        // Listen for log changes
        LogCollector.setChangeListener(() -> handler.post(this::updateLogView));
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        recreate();
    }

    @Override
    protected void onResume() {
        super.onResume();
        IntentFilter filter = new IntentFilter();
        filter.addAction("io.github.wdclouds.feaglewxbot.SWITCH_TAB");
        filter.addAction("io.github.wdclouds.feaglewxbot.RESTART_WECHAT");
        filter.addAction("io.github.wdclouds.feaglewxbot.SET_GATEWAY");
        filter.addAction("io.github.wdclouds.feaglewxbot.TOGGLE_SERVICE");
        filter.addAction("io.github.wdclouds.feaglewxbot.COPY_LOGS");
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerReceiver(agentControlReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(agentControlReceiver, filter);
        }

        handler.post(refreshStatus);
        updateLogView();
    }

    @Override
    protected void onPause() {
        try { unregisterReceiver(agentControlReceiver); } catch (Exception ignored) {}
        super.onPause();
        handler.removeCallbacks(refreshStatus);
    }

    private void switchTab(int tab) {
        currentTab = tab;
        if (tab == 0) {
            overviewPage.setVisibility(View.VISIBLE);
            logPage.setVisibility(View.GONE);
            navOverviewBtn.setTextColor(COLOR_ACCENT);
            navLogBtn.setTextColor(COLOR_TEXT_SEC);
        } else {
            overviewPage.setVisibility(View.GONE);
            logPage.setVisibility(View.VISIBLE);
            navOverviewBtn.setTextColor(COLOR_TEXT_SEC);
            navLogBtn.setTextColor(COLOR_ACCENT);
            updateLogView();
            // Scroll to bottom
            logScrollView.post(() -> logScrollView.fullScroll(View.FOCUS_DOWN));
        }
    }

    // ==========================================
    // Page 1: Overview Page
    // ==========================================
    private void buildOverviewPage() {
        overviewPage = new ScrollView(this);
        overviewPage.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        overviewPage.setFillViewport(true);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(20), dp(20), dp(20), dp(24));

        // 1. Header Title with Brand Logo
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        ImageView logoView = new ImageView(this);
        int logoRes = isDarkMode ? R.drawable.ic_feagle_dark : R.drawable.ic_feagle_light;
        logoView.setImageResource(logoRes);
        logoView.setAdjustViewBounds(true);
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(dp(132), dp(22));
        logoLp.setMargins(0, 0, dp(12), 0);
        logoView.setLayoutParams(logoLp);
        header.addView(logoView);

        TextView title = new TextView(this);
        title.setText("BOT DRIVER");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        title.setTextColor(COLOR_TEXT_PRI);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        title.setLayoutParams(titleLp);

        TextView version = new TextView(this);
        version.setText("v0.8.0 minimal");
        version.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        version.setTextColor(COLOR_TEXT_SEC);
        version.setTypeface(Typeface.MONOSPACE, Typeface.NORMAL);

        header.addView(title);
        header.addView(version);
        layout.addView(header);

        addDivider(layout, 16);

        // 2. Core Topology Status Badges
        TextView topoTitle = createSectionHeader("链路健康状态");
        layout.addView(topoTitle);

        LinearLayout badgesRow = new LinearLayout(this);
        badgesRow.setOrientation(LinearLayout.HORIZONTAL);
        badgesRow.setPadding(0, dp(8), 0, dp(8));

        wechatStatusBadge = createBadge("WeChat 8.0.78", "● 检查中", COLOR_WARNING);
        serviceStatusBadge = createBadge("Driver 服务", "● 未启动", COLOR_TEXT_SEC);
        bridgeStatusBadge = createBadge("Bridge 网关", "● 未连接", COLOR_TEXT_SEC);

        LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        badgeLp.setMargins(dp(2), 0, dp(2), 0);
        wechatStatusBadge.setLayoutParams(badgeLp);
        serviceStatusBadge.setLayoutParams(badgeLp);
        bridgeStatusBadge.setLayoutParams(badgeLp);

        badgesRow.addView(wechatStatusBadge);
        badgesRow.addView(serviceStatusBadge);
        badgesRow.addView(bridgeStatusBadge);
        layout.addView(badgesRow);

        addDivider(layout, 16);

        // 3. IP & Gateway Routing Section
        TextView netTitle = createSectionHeader("网络与网关路由");
        layout.addView(netTitle);

        LinearLayout netBox = new LinearLayout(this);
        netBox.setOrientation(LinearLayout.VERTICAL);
        netBox.setPadding(dp(14), dp(12), dp(14), dp(12));
        netBox.setBackground(createRoundedBackground(COLOR_SURFACE, COLOR_BORDER, dp(8)));

        localIpText = createMonoInfoRow("平板内网 IP", "获取中...");
        targetIpText = createMonoInfoRow("目标宿主 IP", "解析中...");
        currentGatewayText = createMonoInfoRow("网关连接地址", "未配置");

        netBox.addView(localIpText);
        netBox.addView(targetIpText);
        netBox.addView(currentGatewayText);
        layout.addView(netBox);

        // Gateway configuration input
        TextView configLabel = new TextView(this);
        configLabel.setText("修改网关接入点:");
        configLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        configLabel.setTextColor(COLOR_TEXT_SEC);
        configLabel.setPadding(0, dp(12), 0, dp(6));
        layout.addView(configLabel);

        gatewayInput = new EditText(this);
        gatewayInput.setContentDescription("input_gateway_url");
        gatewayInput.setText(prefs.getString(AgentProtocol.KEY_ENDPOINT, "ws://127.0.0.1:6191/android"));
        gatewayInput.setTextColor(COLOR_TEXT_PRI);
        gatewayInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        gatewayInput.setTypeface(Typeface.MONOSPACE);
        gatewayInput.setBackground(createRoundedBackground(COLOR_SURFACE, COLOR_BORDER, dp(6)));
        gatewayInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        layout.addView(gatewayInput);

        TextView tokenLabel = new TextView(this);
        tokenLabel.setText("网关鉴权 Token / 8位配对码 (可选):");
        tokenLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        tokenLabel.setTextColor(COLOR_TEXT_SEC);
        tokenLabel.setPadding(0, dp(10), 0, dp(6));
        layout.addView(tokenLabel);

        tokenInput = new EditText(this);
        tokenInput.setContentDescription("input_gateway_token");
        tokenInput.setHint("输入 Token 或 8位配对码");
        tokenInput.setHintTextColor(COLOR_TEXT_SEC);
        String savedToken = prefs.getString(AgentProtocol.KEY_TOKEN, "");
        if (savedToken.isEmpty()) {
            savedToken = prefs.getString(AgentProtocol.KEY_PAIRING_CODE, "");
        }
        tokenInput.setText(savedToken);
        tokenInput.setTextColor(COLOR_TEXT_PRI);
        tokenInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tokenInput.setTypeface(Typeface.MONOSPACE);
        tokenInput.setBackground(createRoundedBackground(COLOR_SURFACE, COLOR_BORDER, dp(6)));
        tokenInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        layout.addView(tokenInput);

        LinearLayout configBtnRow = new LinearLayout(this);
        configBtnRow.setOrientation(LinearLayout.HORIZONTAL);
        configBtnRow.setPadding(0, dp(8), 0, dp(4));

        Button saveBtn = createStyledButton("保存并重连", "btn_save_gateway", COLOR_ACCENT, true);
        saveBtn.setOnClickListener(v -> {
            String newEndpoint = gatewayInput.getText().toString().trim();
            String newToken = tokenInput.getText().toString().trim();
            if (newEndpoint.isEmpty()) {
                Toast.makeText(this, "请输入有效的网关地址", Toast.LENGTH_SHORT).show();
                return;
            }
            applyConfig(newEndpoint, newToken);
        });

        Button qrBtn = createStyledButton("扫码配置", "btn_qr_scan", COLOR_SURFACE, false);
        qrBtn.setOnClickListener(v -> {
            try {
                Intent intent = new Intent(this, QrScanActivity.class);
                startActivityForResult(intent, 300);
            } catch (Exception e) {
                handleScanFailure();
            }
        });

        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(0, dp(40), 1.0f);
        btnLp.setMargins(dp(2), 0, dp(2), 0);
        saveBtn.setLayoutParams(btnLp);
        qrBtn.setLayoutParams(btnLp);

        configBtnRow.addView(qrBtn);
        configBtnRow.addView(saveBtn);
        layout.addView(configBtnRow);

        addDivider(layout, 16);

        // 4. Live Telemetry
        TextView teleTitle = createSectionHeader("实时吞吐指标");
        layout.addView(teleTitle);

        LinearLayout teleBox = new LinearLayout(this);
        teleBox.setOrientation(LinearLayout.VERTICAL);
        teleBox.setPadding(dp(14), dp(12), dp(14), dp(12));
        teleBox.setBackground(createRoundedBackground(COLOR_SURFACE, COLOR_BORDER, dp(8)));

        statDeviceText = createMonoInfoRow("设备唯一标识", maskDeviceId(initDeviceId()));
        statLatencyText = createMonoInfoRow("心跳时延估计", "< 5ms (正常)");
        statInboundText = createMonoInfoRow("接收微信事件", "0 条");
        statOutboundText = createMonoInfoRow("下发 OneBot 指令", "0 条");

        teleBox.addView(statDeviceText);
        teleBox.addView(statLatencyText);
        teleBox.addView(statInboundText);
        teleBox.addView(statOutboundText);
        layout.addView(teleBox);

        addDivider(layout, 16);

        // 5. Actions Row
        TextView actTitle = createSectionHeader("快捷运维");
        layout.addView(actTitle);

        LinearLayout actionRow = new LinearLayout(this);
        actionRow.setOrientation(LinearLayout.HORIZONTAL);
        actionRow.setPadding(0, dp(4), 0, dp(20));

        startStopBtn = createStyledButton("启动 Driver 服务", "btn_start_stop", COLOR_SUCCESS, true);
        startStopBtn.setOnClickListener(v -> {
            if (isBridgeServiceRunning()) {
                stopAgent();
            } else {
                startAgent();
            }
            updateOverviewState();
        });

        Button restartWechatBtn = createStyledButton("⟳ 一键重启微信", "btn_restart_wechat", COLOR_SURFACE, false);
        restartWechatBtn.setOnClickListener(v -> {
            Toast.makeText(this, "正在通过 Root 重启微信进程...", Toast.LENGTH_SHORT).show();
            LogCollector.log("CMD", "发起一键重启微信 Hook 进程");
            new Thread(() -> {
                try {
                    Process p = Runtime.getRuntime().exec(new String[]{"su", "-c",
                            "am force-stop com.tencent.mm && am start -n com.tencent.mm/.ui.LauncherUI"});
                    p.waitFor();
                    runOnUiThread(() -> Toast.makeText(this, "微信已成功拉起，Hook 注入中", Toast.LENGTH_SHORT).show());
                } catch (Exception e) {
                    runOnUiThread(() -> Toast.makeText(this, "Root 执行失败: " + e.getMessage(), Toast.LENGTH_SHORT).show());
                }
            }).start();
        });

        LinearLayout.LayoutParams actBtnLp = new LinearLayout.LayoutParams(0, dp(44), 1.0f);
        actBtnLp.setMargins(dp(3), 0, dp(3), 0);
        startStopBtn.setLayoutParams(actBtnLp);
        restartWechatBtn.setLayoutParams(actBtnLp);

        actionRow.addView(startStopBtn);
        actionRow.addView(restartWechatBtn);
        layout.addView(actionRow);

        overviewPage.addView(layout);
    }

    // ==========================================
    // Page 2: Log Page (Truly Fullscreen)
    // ==========================================
    private void buildLogPage() {
        logPage = new FrameLayout(this);
        logPage.setBackgroundColor(0xFF05070A); // Pitch Black Terminal Background

        logScrollView = new ScrollView(this);
        logScrollView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        logScrollView.setFillViewport(true);

        logTextView = new TextView(this);
        logTextView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        logTextView.setTextColor(0xFFE6EDF3);
        logTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        logTextView.setTypeface(Typeface.MONOSPACE);
        logTextView.setPadding(dp(12), dp(16), dp(12), dp(20));
        logTextView.setLineSpacing(dp(2), 1.1f);
        logTextView.setTextIsSelectable(true);

        logScrollView.addView(logTextView);
        logPage.addView(logScrollView);

        // Floating Copy Button (Overlay Layer)
        Button copyPillBtn = new Button(this);
        copyPillBtn.setContentDescription("btn_copy_logs");
        copyPillBtn.setText("复制近50条");
        copyPillBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        copyPillBtn.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        copyPillBtn.setTextColor(COLOR_TEXT_PRI);

        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setShape(GradientDrawable.RECTANGLE);
        pillBg.setCornerRadius(dp(16));
        pillBg.setColor(0xCC21262D); // Semi-transparent Slate Glass
        pillBg.setStroke(dp(1), 0x9930363D);
        copyPillBtn.setBackground(pillBg);
        copyPillBtn.setPadding(dp(14), dp(4), dp(14), dp(4));

        FrameLayout.LayoutParams copyLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(34));
        copyLp.gravity = Gravity.TOP | Gravity.END;
        copyLp.setMargins(0, dp(12), dp(14), 0);
        copyPillBtn.setLayoutParams(copyLp);

        copyPillBtn.setOnClickListener(v -> {
            String logs50 = LogCollector.getRecent50LogsAsString();
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("FEAGLE Logs", logs50));
                Toast.makeText(this, "已复制最近 50 条日志到剪贴板", Toast.LENGTH_SHORT).show();
            }
        });

        logPage.addView(copyPillBtn);
    }

    private void updateLogView() {
        if (logTextView == null) return;
        List<String> logs = LogCollector.getAllLogs();
        if (logs.isEmpty()) {
            logTextView.setText("--- [等待事件日志输入] ---");
            return;
        }
        StringBuilder sb = new StringBuilder();
        for (String line : logs) {
            sb.append(line).append("\n");
        }
        logTextView.setText(sb.toString().trim());

        // Always lock to bottom
        if (currentTab == 1 && logScrollView != null) {
            logScrollView.post(() -> logScrollView.fullScroll(View.FOCUS_DOWN));
        }
    }

    // ==========================================
    // Bottom Navigation Bar
    // ==========================================
    private View buildBottomNav() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setBackgroundColor(COLOR_SURFACE);
        nav.setPadding(0, dp(4), 0, dp(4));

        // Top Border for Nav
        View divider = new View(this);
        divider.setBackgroundColor(COLOR_BORDER);
        LinearLayout.LayoutParams divLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.addView(divider, divLp);

        navOverviewBtn = createNavButton("总览 (Overview)", true);
        navLogBtn = createNavButton("日志 (Terminal)", false);

        LinearLayout.LayoutParams itemLp = new LinearLayout.LayoutParams(0, dp(50), 1.0f);
        navOverviewBtn.setLayoutParams(itemLp);
        navLogBtn.setLayoutParams(itemLp);

        navOverviewBtn.setContentDescription("tab_overview");
        navOverviewBtn.setOnClickListener(v -> switchTab(0));
        navLogBtn.setContentDescription("tab_terminal");
        navLogBtn.setOnClickListener(v -> switchTab(1));

        nav.addView(navOverviewBtn);
        nav.addView(navLogBtn);
        container.addView(nav);

        return container;
    }

    private TextView createNavButton(String label, boolean active) {
        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tv.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        tv.setGravity(Gravity.CENTER);
        tv.setTextColor(active ? COLOR_ACCENT : COLOR_TEXT_SEC);
        return tv;
    }

    // ==========================================
    // State Refresh Logic
    // ==========================================
    private void updateOverviewState() {
        String status = prefs.getString(AgentProtocol.KEY_STATUS, "未启动");
        String hook = prefs.getString(AgentProtocol.KEY_HOOK_STATUS, "未连接");
        String endpoint = prefs.getString(AgentProtocol.KEY_ENDPOINT, "ws://127.0.0.1:6191/android");

        boolean serviceRunning = isBridgeServiceRunning();
        boolean hookActive = hook.contains("已连接") || hook.contains("active") || hook.toLowerCase().contains("connected");
        boolean bridgeOnline = status.contains("已连接") || status.toLowerCase().contains("online") || status.toLowerCase().contains("connected");

        // Badges
        updateBadge(wechatStatusBadge, "WeChat 8.0.78", hookActive ? "● 正常 ACTIVE" : "● 未注入", hookActive ? COLOR_SUCCESS : COLOR_DANGER);
        updateBadge(serviceStatusBadge, "Driver 服务", serviceRunning ? "● 运行中" : "● 已停止", serviceRunning ? COLOR_SUCCESS : COLOR_WARNING);
        updateBadge(bridgeStatusBadge, "Bridge 网关", bridgeOnline ? "● 已连通" : "● 断开", bridgeOnline ? COLOR_SUCCESS : COLOR_DANGER);

        // Network Info
        String localIp = getLocalWifiOrEthernetIp();
        localIpText.setText("平板内网 IP   :  " + (localIp != null ? localIp : "无网络 / 未分配"));

        String targetIp = extractHostFromUri(endpoint);
        targetIpText.setText("目标宿主 IP   :  " + targetIp);
        currentGatewayText.setText("当前网关地址 :  " + endpoint);

        // Metrics
        long inbound = prefs.getLong("stat_inbound_total", 0);
        long outbound = prefs.getLong("stat_outbound_total", 0);
        statInboundText.setText("接收微信事件 :  " + inbound + " 条");
        statOutboundText.setText("下发 OneBot  :  " + outbound + " 条");

        // Action button
        if (serviceRunning) {
            startStopBtn.setText("⏹ 停止 Driver 服务");
            startStopBtn.setTextColor(COLOR_DANGER);
        } else {
            startStopBtn.setText("▶ 启动 Driver 服务");
            startStopBtn.setTextColor(COLOR_SUCCESS);
        }
    }

    // ==========================================
    // Helpers & UI Utilities
    // ==========================================
    private TextView createBadge(String title, String val, int color) {
        TextView badge = new TextView(this);
        badge.setText(title + "\n" + val);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        badge.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp(8), dp(8), dp(8), dp(8));
        badge.setTextColor(color);
        badge.setBackground(createRoundedBackground(COLOR_SURFACE, COLOR_BORDER, dp(6)));
        return badge;
    }

    private void updateBadge(TextView tv, String title, String val, int color) {
        if (tv == null) return;
        tv.setText(title + "\n" + val);
        tv.setTextColor(color);
    }

    private TextView createSectionHeader(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tv.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        tv.setTextColor(COLOR_TEXT_SEC);
        tv.setPadding(0, dp(4), 0, dp(6));
        return tv;
    }

    private TextView createMonoInfoRow(String label, String value) {
        TextView tv = new TextView(this);
        tv.setText(label + "  :  " + value);
        tv.setTextColor(COLOR_TEXT_PRI);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        tv.setTypeface(Typeface.MONOSPACE);
        tv.setPadding(0, dp(3), 0, dp(3));
        return tv;
    }

    private Button createStyledButton(String text, String semanticId, int bgColor, boolean primary) {
        Button btn = new Button(this);
        btn.setContentDescription(semanticId);
        
        btn.setText(text);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        btn.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        btn.setTextColor(primary ? COLOR_TEXT_PRI : COLOR_TEXT_SEC);

        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(dp(6));
        gd.setColor(bgColor);
        gd.setStroke(dp(1), COLOR_BORDER);
        btn.setBackground(gd);
        return btn;
    }

    private GradientDrawable createRoundedBackground(int color, int borderColor, int radius) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(radius);
        gd.setColor(color);
        if (borderColor != 0) {
            gd.setStroke(dp(1), borderColor);
        }
        return gd;
    }

    private void addDivider(LinearLayout parent, int marginDp) {
        View line = new View(this);
        line.setBackgroundColor(COLOR_BORDER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        lp.setMargins(0, dp(marginDp), 0, dp(marginDp));
        parent.addView(line, lp);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private String getLocalWifiOrEthernetIp() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                if (intf.isLoopback() || !intf.isUp()) continue;
                for (InetAddress addr : Collections.list(intf.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr.getHostAddress().indexOf(':') < 0) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String extractHostFromUri(String uriStr) {
        try {
            URI u = new URI(uriStr);
            String h = u.getHost();
            int p = u.getPort();
            return (h != null ? h : "127.0.0.1") + (p > 0 ? (":" + p) : "");
        } catch (Exception e) {
            return "127.0.0.1:6191";
        }
    }

    private String initDeviceId() {
        String deviceId = prefs.getString(AgentProtocol.KEY_DEVICE_ID, "");
        if (deviceId.isEmpty()) {
            deviceId = "dev_" + Long.toHexString(Double.doubleToLongBits(Math.random()));
            prefs.edit().putString(AgentProtocol.KEY_DEVICE_ID, deviceId).apply();
        }
        return deviceId;
    }

    private String maskDeviceId(String id) {
        if (id == null || id.length() < 6) return id;
        return id.substring(0, 3) + "***" + id.substring(id.length() - 2);
    }

    private boolean isBridgeServiceRunning() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        for (ActivityManager.RunningServiceInfo service : am.getRunningServices(Integer.MAX_VALUE)) {
            if (BridgeForegroundService.class.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }
    }

    private void startAgent() {
        Intent serviceIntent = new Intent(this, BridgeForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        LogCollector.log("AGENT", "手动启动 Agent 前台服务");
    }

    private void stopAgent() {
        stopService(new Intent(this, BridgeForegroundService.class));
        LogCollector.log("AGENT", "手动停止 Agent 前台服务");
    }

    private final BroadcastReceiver agentControlReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            Log.i(TAG, "Agent command received via broadcast: " + action);
            switch (action) {
                case "io.github.wdclouds.feaglewxbot.SWITCH_TAB":
                    String tab = intent.getStringExtra("tab");
                    if ("terminal".equalsIgnoreCase(tab) || "log".equalsIgnoreCase(tab)) {
                        switchTab(1);
                    } else {
                        switchTab(0);
                    }
                    break;
                case "io.github.wdclouds.feaglewxbot.RESTART_WECHAT":
                    try {
                        Runtime.getRuntime().exec(new String[]{"su", "-c", "am force-stop com.tencent.mm && monkey -p com.tencent.mm -c android.intent.category.LAUNCHER 1"});
                        LogCollector.log("SYS", "Agent CLI: 已触发强制重启微信进程");
                    } catch (Exception e) {
                        LogCollector.log("ERR", "Agent CLI 重启微信失败: " + e.getMessage());
                    }
                    break;
                case "io.github.wdclouds.feaglewxbot.SET_GATEWAY":
                    String url = intent.getStringExtra("url");
                    if (url != null && !url.trim().isEmpty()) {
                        prefs.edit().putString(AgentProtocol.KEY_ENDPOINT, url.trim()).apply();
                        gatewayInput.setText(url.trim());
                        LogCollector.log("SYS", "Agent CLI: 网关已更新为 " + url.trim());
                        if (isBridgeServiceRunning()) {
                            stopAgent();
                            handler.postDelayed(() -> startAgent(), 600);
                        }
                    }
                    break;
                case "io.github.wdclouds.feaglewxbot.TOGGLE_SERVICE":
                    boolean enable = intent.getBooleanExtra("enable", !isBridgeServiceRunning());
                    if (enable) {
                        startAgent();
                        LogCollector.log("SYS", "Agent CLI: Driver 服务已启动");
                    } else {
                        stopAgent();
                        LogCollector.log("SYS", "Agent CLI: Driver 服务已停止");
                    }
                    handler.post(refreshStatus);
                    break;
                case "io.github.wdclouds.feaglewxbot.COPY_LOGS":
                    copyLogsToClipboard();
                    break;
            }
        }
    };

    private void copyLogsToClipboard() {
        String logs = LogCollector.getRecent50LogsAsString();
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("FEAGLE_LOGS", logs));
            Toast.makeText(this, "已复制最近 50 条日志到剪贴板", Toast.LENGTH_SHORT).show();
            LogCollector.log("SYS", "用户/Agent 已复制最近 50 条终端日志");
        }
    }

    private void applyConfig(String endpoint, String token) {
        SharedPreferences.Editor editor = prefs.edit().putString(AgentProtocol.KEY_ENDPOINT, endpoint);
        if (token != null && !token.trim().isEmpty()) {
            String trimmedToken = token.trim();
            if (trimmedToken.matches("\\d{8}")) {
                editor.putString(AgentProtocol.KEY_PAIRING_CODE, trimmedToken);
                editor.remove(AgentProtocol.KEY_TOKEN);
            } else {
                editor.putString(AgentProtocol.KEY_TOKEN, trimmedToken);
                editor.remove(AgentProtocol.KEY_PAIRING_CODE);
            }
        }
        editor.apply();
        Toast.makeText(this, "配置已保存，正在发起重连", Toast.LENGTH_SHORT).show();
        LogCollector.log("CONFIG", "保存新网关地址: " + endpoint + (token != null && !token.trim().isEmpty() ? " (含Token)" : ""));
        startAgent();
        updateOverviewState();
    }

    private boolean applyConfigString(String raw) {
        if (raw == null || raw.trim().isEmpty()) return false;
        raw = raw.trim();
        try {
            if (raw.startsWith("{") && raw.endsWith("}")) {
                JSONObject obj = new JSONObject(raw);
                String ep = obj.optString("endpoint", "").trim();
                String tk = obj.optString("token", "").trim();
                String pc = obj.optString("pairingCode", "").trim();
                if (!ep.isEmpty()) {
                    if (gatewayInput != null) gatewayInput.setText(ep);
                    String tokenToUse = !tk.isEmpty() ? tk : pc;
                    if (tokenInput != null) tokenInput.setText(tokenToUse);
                    applyConfig(ep, tokenToUse);
                    return true;
                }
            } else if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
                String ep = raw;
                String tk = "";
                if (ep.contains("?token=") || ep.contains("&token=")) {
                    try {
                        Uri u = Uri.parse(ep);
                        tk = u.getQueryParameter("token");
                    } catch (Exception ignored) {
                    }
                }
                if (gatewayInput != null) gatewayInput.setText(ep);
                if (tk != null && !tk.isEmpty() && tokenInput != null) tokenInput.setText(tk);
                applyConfig(ep, tk != null ? tk : "");
                return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private void handleScanFailure() {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        String clipText = "";
        if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
            CharSequence cs = cm.getPrimaryClip().getItemAt(0).getText();
            if (cs != null) clipText = cs.toString().trim();
        }

        final String finalClip = clipText;
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("未检测到条码扫描器");
        builder.setMessage("平板未安装独立扫描应用。\n\n你可以：\n1. 直接在上方输入网关地址和 Token；\n2. 使用微信或系统相机扫描电脑屏幕二维码，复制扫描结果后点击下方【从剪贴板读取】。");
        builder.setPositiveButton("从剪贴板读取", (d, w) -> {
            if (!applyConfigString(finalClip)) {
                Toast.makeText(this, "剪贴板未包含有效配对数据，请手动复制或输入", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, "已从剪贴板成功加载网关配置！", Toast.LENGTH_SHORT).show();
            }
        });
        builder.setNegativeButton("手动输入", null);
        builder.show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 300 && resultCode == RESULT_OK && data != null) {
            String scanResult = data.getStringExtra(QrScanActivity.EXTRA_QR_RESULT);
            if (scanResult == null) {
                scanResult = data.getStringExtra("SCAN_RESULT");
            }
            if (scanResult != null && !scanResult.isEmpty()) {
                if (!applyConfigString(scanResult)) {
                    Toast.makeText(this, "扫描内容格式不符: " + scanResult, Toast.LENGTH_SHORT).show();
                }
            }
        }
    }

}
