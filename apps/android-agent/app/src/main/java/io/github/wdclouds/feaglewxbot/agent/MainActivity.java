package io.github.wdclouds.feaglewxbot.agent;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;
import java.util.UUID;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int REQUEST_QR_SCAN = 300;

    // Modern Terminal / Cyber Dark Palette
    private static final int COLOR_BG = 0xFF090D16;          // Deep Navy Black
    private static final int COLOR_CARD = 0xFF131B2E;        // Dark Slate Blue
    private static final int COLOR_CARD_BORDER = 0xFF1E293B; // Slate Border
    private static final int COLOR_CARD_INNER = 0xFF0D1526;  // Inset Container
    private static final int COLOR_TEXT_PRIMARY = 0xFFF1F5F9;// Bright White
    private static final int COLOR_TEXT_SECONDARY = 0xFF94A3B8;// Muted Silver
    private static final int COLOR_TEXT_MUTED = 0xFF64748B;  // Slate Muted

    private static final int COLOR_SUCCESS = 0xFF10B981;     // Emerald Green
    private static final int COLOR_SUCCESS_BG = 0x1A10B981;  // Emerald Tint
    private static final int COLOR_SUCCESS_BORDER = 0x4D10B981;

    private static final int COLOR_WARNING = 0xFFF59E0B;     // Amber Warning
    private static final int COLOR_WARNING_BG = 0x1AF59E0B;
    private static final int COLOR_WARNING_BORDER = 0x4DF59E0B;

    private static final int COLOR_DANGER = 0xFFEF4444;      // Red Error
    private static final int COLOR_DANGER_BG = 0x1AEF4444;
    private static final int COLOR_DANGER_BORDER = 0x4DEF4444;

    private static final int COLOR_ACCENT = 0xFF38BDF8;      // Cyan Accent
    private static final int COLOR_ACCENT_BG = 0x1A38BDF8;
    private static final int COLOR_ACCENT_BORDER = 0x4D38BDF8;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;

    // Dynamic Topology Nodes
    private TextView nodeWechatBadge;
    private TextView nodeAgentBadge;
    private TextView nodeBridgeBadge;
    private TextView nodeAstrbotBadge;

    private TextView topologyDetailText;

    // Traffic Counters
    private TextView statInboundText;
    private TextView statOutboundText;
    private TextView statLastInboundText;
    private TextView statLastOutboundText;

    // Config & Actions
    private EditText endpointInput;
    private EditText pairingCodeInput;
    private TextView deviceIdView;
    private Button startButton;

    private final Runnable refreshStatus = new Runnable() {
        @Override
        public void run() {
            if (isFinishing() || isDestroyed()) return;

            String status = prefs.getString(AgentProtocol.KEY_STATUS, "未启动 / stopped");
            String hook = prefs.getString(AgentProtocol.KEY_HOOK_STATUS, "未连接 / disconnected");
            boolean isPaired = !prefs.getString(AgentProtocol.KEY_TOKEN, "").isEmpty();
            String endpoint = prefs.getString(AgentProtocol.KEY_ENDPOINT, "");

            boolean bridgeOnline = status.contains("已连接") || status.toLowerCase().contains("online") || status.toLowerCase().contains("connected");
            boolean hookActive = hook.contains("已连接") || hook.contains("active") || hook.toLowerCase().contains("connected");

            // 1. WeChat Node
            if (hookActive) {
                updateBadge(nodeWechatBadge, "● 微信 8.0.78 (HOOK ACTIVE)", COLOR_SUCCESS, COLOR_SUCCESS_BG, COLOR_SUCCESS_BORDER);
            } else if (hook.contains("inactive") || hook.contains("waiting")) {
                updateBadge(nodeWechatBadge, "● 微信通道 (WAITING)", COLOR_WARNING, COLOR_WARNING_BG, COLOR_WARNING_BORDER);
            } else {
                updateBadge(nodeWechatBadge, "○ 微信未连接", COLOR_DANGER, COLOR_DANGER_BG, COLOR_DANGER_BORDER);
            }

            // 2. Agent Node (self service)
            boolean serviceRunning = isBridgeServiceRunning();
            if (serviceRunning) {
                updateBadge(nodeAgentBadge, "● 本地服务 (RUNNING)", COLOR_SUCCESS, COLOR_SUCCESS_BG, COLOR_SUCCESS_BORDER);
            } else {
                updateBadge(nodeAgentBadge, "○ 本地服务 (STOPPED)", COLOR_DANGER, COLOR_DANGER_BG, COLOR_DANGER_BORDER);
            }

            // 3. Bridge Node
            if (bridgeOnline) {
                updateBadge(nodeBridgeBadge, "● Bridge 6191 (ONLINE)", COLOR_SUCCESS, COLOR_SUCCESS_BG, COLOR_SUCCESS_BORDER);
            } else if (status.contains("连接中") || status.toLowerCase().contains("connecting")) {
                updateBadge(nodeBridgeBadge, "● Bridge 握手中...", COLOR_WARNING, COLOR_WARNING_BG, COLOR_WARNING_BORDER);
            } else {
                updateBadge(nodeBridgeBadge, "○ Bridge 离线", COLOR_DANGER, COLOR_DANGER_BG, COLOR_DANGER_BORDER);
            }

            // 4. AstrBot / Gateway Node
            if (bridgeOnline && isPaired) {
                updateBadge(nodeAstrbotBadge, "● AstrBot 网关 (READY)", COLOR_SUCCESS, COLOR_SUCCESS_BG, COLOR_SUCCESS_BORDER);
            } else {
                updateBadge(nodeAstrbotBadge, "○ 网关待命", COLOR_TEXT_MUTED, 0x1A64748B, COLOR_CARD_BORDER);
            }

            // Topology Detail
            if (topologyDetailText != null) {
                StringBuilder sb = new StringBuilder();
                sb.append("WS 端口: ").append(endpoint.isEmpty() ? "未配置" : endpoint).append("\n");
                sb.append("IPC 状态: ").append(hookActive ? "微信 Hook 双向 IPC 正常" : "等待微信主进程连接").append("\n");
                sb.append("会话鉴权: ").append(isPaired ? "Token 已装载 (已通过鉴权)" : "待配对鉴权");
                topologyDetailText.setText(sb.toString());
            }

            // Traffic Stats
            int inCount = prefs.getInt("stat_inbound_count", 0);
            int outCount = prefs.getInt("stat_outbound_count", 0);
            long lastIn = prefs.getLong("stat_last_inbound_time", 0);
            long lastOut = prefs.getLong("stat_last_outbound_time", 0);

            if (statInboundText != null) statInboundText.setText(String.valueOf(inCount));
            if (statOutboundText != null) statOutboundText.setText(String.valueOf(outCount));

            SimpleDateFormat sdf = new SimpleDateFormat("HH:mm:ss", Locale.getDefault());
            if (statLastInboundText != null) {
                statLastInboundText.setText(lastIn > 0 ? sdf.format(new Date(lastIn)) : "无");
            }
            if (statLastOutboundText != null) {
                statLastOutboundText.setText(lastOut > 0 ? sdf.format(new Date(lastOut)) : "无");
            }

            if (startButton != null) {
                startButton.setText(serviceRunning ? "重新连接 / 刷新 (Restart)" : "启动服务 (Start)");
            }

            handler.postDelayed(this, 1500);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("agent", MODE_PRIVATE);
        initDeviceId();

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(COLOR_BG);
        scroll.setFillViewport(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(16), dp(16), dp(24));
        scroll.addView(root);

        // 1. Minimal Header
        root.addView(buildHeader());

        // 2. Topology Monitor Card (Main Focus)
        root.addView(buildTopologyCard());

        // 3. Traffic & Packet Monitor Card
        root.addView(buildTrafficStatsCard());

        // 4. Quick Actions Card
        root.addView(buildActionsCard());

        // 5. Endpoint & Auth Configuration Card
        root.addView(buildConfigCard());

        setContentView(scroll);
        requestNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(refreshStatus);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(refreshStatus);
    }

    private View buildHeader() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(4), 0, dp(14));

        LinearLayout textCol = new LinearLayout(this);
        textCol.setOrientation(LinearLayout.VERTICAL);

        TextView title = new TextView(this);
        title.setText("FEAGLE AGENT · 链路监控");
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(COLOR_TEXT_PRIMARY);
        textCol.addView(title);

        TextView sub = new TextView(this);
        sub.setText("端到端端口连通性 & 协议状态指示器");
        sub.setTextSize(11);
        sub.setTextColor(COLOR_TEXT_MUTED);
        sub.setPadding(0, dp(2), 0, 0);
        textCol.addView(sub);

        row.addView(textCol, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        TextView scanBtn = new TextView(this);
        scanBtn.setText("📷 扫码接入");
        scanBtn.setTextSize(12);
        scanBtn.setTypeface(Typeface.DEFAULT_BOLD);
        scanBtn.setTextColor(COLOR_ACCENT);
        scanBtn.setBackground(createPillDrawable(COLOR_ACCENT_BG, COLOR_ACCENT_BORDER, dp(8)));
        scanBtn.setPadding(dp(12), dp(8), dp(12), dp(8));
        scanBtn.setOnClickListener(v -> {
            Intent scanIntent = new Intent(MainActivity.this, QrScanActivity.class);
            startActivityForResult(scanIntent, REQUEST_QR_SCAN);
        });
        row.addView(scanBtn);

        return row;
    }

    private View buildTopologyCard() {
        LinearLayout card = createCardContainer();

        TextView title = createSectionTitle("⚡ 全链路拓扑指示 / END-TO-END TOPOLOGY");
        card.addView(title);

        // Topology Pipeline Visualizer
        LinearLayout pipeline = new LinearLayout(this);
        pipeline.setOrientation(LinearLayout.VERTICAL);
        pipeline.setBackground(createPillDrawable(COLOR_CARD_INNER, COLOR_CARD_BORDER, dp(10)));
        pipeline.setPadding(dp(12), dp(12), dp(12), dp(12));

        nodeWechatBadge = createNodeView("○ 微信 8.0.78");
        pipeline.addView(nodeWechatBadge);

        pipeline.addView(createPipeArrow("↕ LSPosed IPC 进程管道 (Hook 双向映射)"));

        nodeAgentBadge = createNodeView("○ 平板 Agent 本地服务");
        pipeline.addView(nodeAgentBadge);

        pipeline.addView(createPipeArrow("↕ WebSocket 客户端通道 (feagle.android.v1)"));

        nodeBridgeBadge = createNodeView("○ Windows Bridge (6191/android)");
        pipeline.addView(nodeBridgeBadge);

        pipeline.addView(createPipeArrow("↕ 反向 WebSocket (OneBot v11 / 6190)"));

        nodeAstrbotBadge = createNodeView("○ AstrBot 机器人网关");
        pipeline.addView(nodeAstrbotBadge);

        card.addView(pipeline);

        // Topology Detail Panel
        topologyDetailText = new TextView(this);
        topologyDetailText.setTextSize(11);
        topologyDetailText.setTextColor(COLOR_TEXT_SECONDARY);
        topologyDetailText.setPadding(dp(4), dp(10), dp(4), 0);
        topologyDetailText.setLineSpacing(dp(3), 1f);
        card.addView(topologyDetailText);

        return card;
    }

    private View buildTrafficStatsCard() {
        LinearLayout card = createCardContainer();

        TextView title = createSectionTitle("📊 消息吞吐与实时计数 / TRAFFIC METRICS");
        card.addView(title);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);

        // Inbound block
        LinearLayout inCol = createMetricBox("接收入站 (Inbound)", "0", "上次: 无");
        statInboundText = (TextView) inCol.getChildAt(1);
        statLastInboundText = (TextView) inCol.getChildAt(2);
        row.addView(inCol, halfWidthParams(4));

        // Outbound block
        LinearLayout outCol = createMetricBox("发信出站 (Outbound)", "0", "上次: 无");
        statOutboundText = (TextView) outCol.getChildAt(1);
        statLastOutboundText = (TextView) outCol.getChildAt(2);
        row.addView(outCol, halfWidthParams(0));

        card.addView(row);
        return card;
    }

    private View buildActionsCard() {
        LinearLayout card = createCardContainer();

        TextView title = createSectionTitle("🛠️ 诊断与控制 / CONTROLS");
        card.addView(title);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);

        startButton = createButton("启动服务", 0xFF2563EB, 0xFF1D4ED8, Color.WHITE);
        startButton.setOnClickListener(v -> startAgent());
        row.addView(startButton, halfWidthParams(4));

        Button stopBtn = createButton("停止服务", 0xFF334155, 0xFF1E293B, COLOR_DANGER);
        stopBtn.setOnClickListener(v -> stopAgent());
        row.addView(stopBtn, halfWidthParams(0));

        card.addView(row);

        // Quick restart WeChat button
        LinearLayout row2 = new LinearLayout(this);
        row2.setOrientation(LinearLayout.HORIZONTAL);
        row2.setPadding(0, dp(6), 0, 0);

        Button restartWxBtn = createButton("重启微信测试 Hook", 0xFF1E293B, 0xFF0F172A, COLOR_ACCENT);
        restartWxBtn.setOnClickListener(v -> {
            try {
                Runtime.getRuntime().exec(new String[]{"su", "-c", "am force-stop com.tencent.mm && sleep 1 && am start -n com.tencent.mm/.ui.LauncherUI"});
                Toast.makeText(MainActivity.this, "已执行微信热重启 (Root)", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "重启失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
        row2.addView(restartWxBtn, fullWidthParams());
        card.addView(row2);

        return card;
    }

    private View buildConfigCard() {
        LinearLayout card = createCardContainer();

        TextView title = createSectionTitle("⚙️ 端点与鉴权配置 / CONFIGURATION");
        card.addView(title);

        TextView endLabel = createInputLabel("Bridge WebSocket 端口终端");
        card.addView(endLabel);

        endpointInput = createStyledInput("ws://10.57.205.246:6191/android", false);
        endpointInput.setText(prefs.getString(AgentProtocol.KEY_ENDPOINT, "ws://10.57.205.246:6191/android"));
        card.addView(endpointInput);

        TextView codeLabel = createInputLabel("一次性配对码 (若已装载 Token 可留空)");
        card.addView(codeLabel);

        pairingCodeInput = createStyledInput("8 位数字配对码", true);
        card.addView(pairingCodeInput);

        Button saveBtn = createButton("保存配置并立即重连", 0xFF2563EB, 0xFF1D4ED8, Color.WHITE);
        saveBtn.setOnClickListener(v -> startAgent());
        LinearLayout.LayoutParams sParams = fullWidthParams();
        sParams.setMargins(0, dp(10), 0, 0);
        card.addView(saveBtn, sParams);

        // Device ID with click-to-copy
        String deviceId = prefs.getString(AgentProtocol.KEY_DEVICE_ID, "");
        deviceIdView = new TextView(this);
        deviceIdView.setText("设备 ID: " + maskDeviceId(deviceId) + " (点击复制)");
        deviceIdView.setTextSize(11);
        deviceIdView.setTextColor(COLOR_TEXT_MUTED);
        deviceIdView.setPadding(0, dp(10), 0, 0);
        deviceIdView.setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("Device ID", deviceId));
                Toast.makeText(MainActivity.this, "已复制设备 ID", Toast.LENGTH_SHORT).show();
            }
        });
        card.addView(deviceIdView);

        return card;
    }

    // UI Utilities
    private LinearLayout createCardContainer() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(createPillDrawable(COLOR_CARD, COLOR_CARD_BORDER, dp(12)));

        LinearLayout.LayoutParams params = fullWidthParams();
        params.setMargins(0, 0, 0, dp(12));
        card.setLayoutParams(params);
        return card;
    }

    private TextView createSectionTitle(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(11);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setTextColor(COLOR_TEXT_MUTED);
        view.setPadding(0, 0, 0, dp(8));
        return view;
    }

    private TextView createNodeView(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(13);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setPadding(dp(12), dp(9), dp(12), dp(9));
        view.setBackground(createPillDrawable(0x1A64748B, COLOR_CARD_BORDER, dp(8)));
        view.setTextColor(COLOR_TEXT_MUTED);
        return view;
    }

    private TextView createPipeArrow(String text) {
        TextView view = new TextView(this);
        view.setText("  ↓  " + text);
        view.setTextSize(10);
        view.setTextColor(COLOR_TEXT_MUTED);
        view.setPadding(dp(8), dp(4), dp(8), dp(4));
        return view;
    }

    private LinearLayout createMetricBox(String title, String count, String sub) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackground(createPillDrawable(COLOR_CARD_INNER, COLOR_CARD_BORDER, dp(8)));
        col.setPadding(dp(12), dp(10), dp(12), dp(10));

        TextView tView = new TextView(this);
        tView.setText(title);
        tView.setTextSize(11);
        tView.setTextColor(COLOR_TEXT_SECONDARY);
        col.addView(tView);

        TextView cView = new TextView(this);
        cView.setText(count);
        cView.setTextSize(22);
        cView.setTypeface(Typeface.DEFAULT_BOLD);
        cView.setTextColor(COLOR_TEXT_PRIMARY);
        cView.setPadding(0, dp(2), 0, 0);
        col.addView(cView);

        TextView sView = new TextView(this);
        sView.setText(sub);
        sView.setTextSize(10);
        sView.setTextColor(COLOR_TEXT_MUTED);
        sView.setPadding(0, dp(2), 0, 0);
        col.addView(sView);

        return col;
    }

    private void updateBadge(TextView view, String text, int textColor, int bgColor, int borderColor) {
        if (view == null) return;
        view.setText(text);
        view.setTextColor(textColor);
        view.setBackground(createPillDrawable(bgColor, borderColor, dp(8)));
    }

    private TextView createInputLabel(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(11);
        view.setTextColor(COLOR_TEXT_SECONDARY);
        view.setPadding(0, dp(6), 0, dp(3));
        return view;
    }

    private EditText createStyledInput(String hint, boolean isPassword) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(COLOR_TEXT_MUTED);
        input.setTextColor(COLOR_TEXT_PRIMARY);
        input.setTextSize(12);
        input.setSingleLine(true);
        input.setBackground(createPillDrawable(COLOR_CARD_INNER, COLOR_CARD_BORDER, dp(8)));
        input.setPadding(dp(10), dp(8), dp(10), dp(8));
        if (isPassword) {
            input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        } else {
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        }
        return input;
    }

    private Button createButton(String text, int normalColor, int pressedColor, int textColor) {
        Button btn = new Button(this);
        btn.setText(text);
        btn.setTextSize(12);
        btn.setTypeface(Typeface.DEFAULT_BOLD);
        btn.setTextColor(textColor);
        btn.setPadding(dp(10), dp(8), dp(10), dp(8));

        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_pressed}, createPillDrawable(pressedColor, pressedColor, dp(8)));
        states.addState(new int[]{}, createPillDrawable(normalColor, COLOR_CARD_BORDER, dp(8)));
        btn.setBackground(states);
        return btn;
    }

    private GradientDrawable createPillDrawable(int bgColor, int strokeColor, int cornerRadius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(bgColor);
        drawable.setStroke(dp(1), strokeColor);
        drawable.setCornerRadius(cornerRadius);
        return drawable;
    }

    private LinearLayout.LayoutParams fullWidthParams() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams halfWidthParams(int rightMarginDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        p.setMargins(0, 0, dp(rightMarginDp), 0);
        return p;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void initDeviceId() {
        if (!prefs.contains(AgentProtocol.KEY_DEVICE_ID)) {
            String generated = UUID.randomUUID().toString().replace("-", "");
            prefs.edit().putString(AgentProtocol.KEY_DEVICE_ID, generated).apply();
        }
    }

    private String maskDeviceId(String id) {
        if (id == null || id.length() <= 8) return id == null ? "" : id;
        return id.substring(0, 4) + "***" + id.substring(id.length() - 4);
    }

    private boolean isBridgeServiceRunning() {
        String status = prefs.getString(AgentProtocol.KEY_STATUS, "");
        return status.contains("已连接") || status.contains("online") || status.contains("connecting") || status.contains("连接中");
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }
    }

    private void startAgent() {
        String endpoint = endpointInput != null ? endpointInput.getText().toString().trim() : "";
        String pairingCode = pairingCodeInput != null ? pairingCodeInput.getText().toString().trim() : "";

        SharedPreferences.Editor editor = prefs.edit();
        if (!endpoint.isEmpty()) {
            editor.putString(AgentProtocol.KEY_ENDPOINT, endpoint);
        }
        if (!pairingCode.isEmpty()) {
            editor.putString(AgentProtocol.KEY_PAIRING_CODE, pairingCode);
        }
        editor.apply();

        Intent intent = new Intent(this, BridgeForegroundService.class);
        intent.setAction(AgentProtocol.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
        Toast.makeText(this, "Agent 服务已启动", Toast.LENGTH_SHORT).show();
    }

    private void stopAgent() {
        Intent intent = new Intent(this, BridgeForegroundService.class);
        intent.setAction(AgentProtocol.ACTION_STOP);
        startService(intent);
        Toast.makeText(this, "Agent 服务已停止", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_QR_SCAN && resultCode == RESULT_OK && data != null) {
            String qrResult = data.getStringExtra(QrScanActivity.EXTRA_QR_RESULT);
            if (qrResult != null && !qrResult.trim().isEmpty()) {
                handleQrPayload(qrResult.trim());
            }
        }
    }

    private void handleQrPayload(String raw) {
        try {
            JSONObject json = new JSONObject(raw);
            String endpoint = json.optString("endpoint", "").trim();
            String token = json.optString("token", "").trim();
            String pairingCode = json.optString("pairingCode", "").trim();
            if (!endpoint.isEmpty()) {
                if (endpointInput != null) endpointInput.setText(endpoint);
                SharedPreferences.Editor editor = prefs.edit().putString(AgentProtocol.KEY_ENDPOINT, endpoint);
                if (!token.isEmpty()) {
                    editor.putString(AgentProtocol.KEY_TOKEN, token)
                            .remove(AgentProtocol.KEY_PAIRING_CODE);
                } else if (!pairingCode.isEmpty()) {
                    editor.putString(AgentProtocol.KEY_PAIRING_CODE, pairingCode);
                    if (pairingCodeInput != null) pairingCodeInput.setText(pairingCode);
                }
                editor.apply();
                startAgent();
                Toast.makeText(this, "扫码配置成功，正在连接", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "解析配对二维码失败", Toast.LENGTH_SHORT).show();
        }
    }
}
