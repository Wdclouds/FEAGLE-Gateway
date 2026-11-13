# FEAGLE Systemd 服务模板

生产环境（Ubuntu / Debian ECS）直接引用这里的标准 unit 文件即可：

```bash
# 1. 构建后端 TS 与前端控制台
npm install
npm run build

# 2. 安装 systemd unit
sudo cp deploy/systemd/hermes-wxbridge.service /etc/systemd/system/
sudo cp deploy/systemd/feagle-wx-gateway.service /etc/systemd/system/
sudo cp deploy/systemd/mnemosyne.service /etc/systemd/system/

# 3. 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-wxbridge feagle-wx-gateway
```
