# 服务器部署指南

本项目 = 静态网页 + PaddleOCR 的 Python 服务。部署到服务器后：

- 电脑、手机都可以通过公网地址访问；
- 手机端仍然可以直接调用手机相机拍照识别；
- **商品数据仍然保存在每台设备自己的浏览器 LocalStorage 中，服务器只负责页面和 OCR**；
- 如果需要电脑/手机共享同一份商品数据，需要额外增加服务端数据存储与同步接口（当前未实现）。

> 应用本身没有账号体系。公网部署**必须**在 Nginx 或 Cloudflare Access 上加登录保护，否则任何拿到地址的人都能使用识别接口。

推荐架构：

```
浏览器 ──HTTPS──> Nginx（Basic Auth）──> 127.0.0.1:8765（Docker / systemd）
```

---

## 一、服务器要求

| 项目 | 建议 |
|------|------|
| 系统 | Ubuntu 22.04 / 24.04 LTS（或 Debian 12） |
| 内存 | 4GB 以上（PaddleOCR CPU 推理占用较大） |
| 磁盘 | 10GB 以上（镜像 + 模型 + Python 依赖） |
| CPU | 2 核以上 |
| 网络 | 可访问 PyPI；首次识别需下载 PaddleOCR 模型 |
| 域名 | 可选，但公网强烈建议配域名 + HTTPS |

> 2GB 内存也能跑，但首次加载模型时可能紧张；可加 2GB swap。

---

## 二、推荐方式：Docker + Nginx

### 1. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# 退出 SSH 重新登录，或执行 newgrp docker
docker --version
docker compose version
```

### 2. 从 Git 拉取代码

项目仓库：

```
https://github.com/xiaokai169/snack-expiry-manager.git
```

在服务器上执行：

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/xiaokai169/snack-expiry-manager.git snack-expiry-manager
cd snack-expiry-manager
ls
```

应该能看到 `Dockerfile`、`docker-compose.yml`、`server.py`、`static/`、`deploy/`。

> 仓库是公开的，直接 clone 即可。如果以后改成私有仓库，可以使用 SSH key 或 GitHub Personal Access Token 拉取。

### 3. 构建并启动

```bash
cd /opt/snack-expiry-manager
sudo docker compose up -d --build
sudo docker compose logs -f
```

国内服务器如果构建很慢，可以换 PyPI 镜像：

```bash
sudo PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple docker compose up -d --build
```

检查服务（只监听本机，外网暂时还访问不到）：

```bash
curl http://127.0.0.1:8765/api/health
```

看到 `"ocr_available": true` 表示依赖正常。第一次拍照识别时会下载 PaddleOCR 模型，日志里能看到进度，模型会保存在 Docker 卷 `paddlex_models` 中。

### 4. 配置 Nginx + HTTPS + 登录保护

```bash
sudo apt update
sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx

# 创建登录账号（用户名 snackadmin，按提示输入密码）
sudo htpasswd -c /etc/nginx/.htpasswd snackadmin

# 复制配置并替换域名
sudo cp deploy/nginx-snack-expiry.conf /etc/nginx/sites-available/snack-expiry
sudo sed -i 's/snack.example.com/你的域名/g' /etc/nginx/sites-available/snack-expiry
sudo ln -sf /etc/nginx/sites-available/snack-expiry /etc/nginx/sites-enabled/snack-expiry

sudo nginx -t
sudo systemctl reload nginx

# 申请 HTTPS 证书（先确保域名 A 记录已指向服务器 IP）
sudo certbot --nginx -d 你的域名
```

如果没有域名：

- 可以先用 `server_name _;` 通过服务器 IP 访问，但 **HTTP + Basic Auth 会明文传输密码**，不建议长期使用；
- 更推荐用 Cloudflare Tunnel 或 Tailscale（见第五节）。

### 5. 防火墙

只开放 SSH、80、443，不要对外开放 8765：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Docker Compose 已经将端口绑定为 `127.0.0.1:8765`，外网无法直接访问，只能经过 Nginx。

### 6. 访问

- 电脑：`https://你的域名/`
- 手机：`https://你的域名/`，会自动跳转到 `/mobile`
- 手机可「添加到主屏幕」，作为一个 App 图标使用

登录时会弹出 Basic Auth 用户名/密码输入框。

---

## 三、更新版本

在服务器上拉取最新代码并重新构建：

```bash
cd /opt/snack-expiry-manager
sudo git pull
sudo docker compose up -d --build
```

- PaddleOCR 模型保存在 `paddlex_models` 卷中，重建容器不会重新下载；
- 商品数据在浏览器里，不会因服务器更新而丢失；
- 更新前建议在浏览器里导出一份 Excel 备份。

查看日志：

```bash
sudo docker compose ps
sudo docker compose logs -f --tail=200
```

---

## 四、不用 Docker：Ubuntu + systemd

如果服务器不能安装 Docker，可以直接用 Python 运行。

### 1. 安装系统依赖

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip \
  libgl1 libglib2.0-0 libgomp1 libsm6 libxext6 libxrender1 libxcb1 libx11-6
```

### 2. 创建用户并安装依赖

```bash
sudo useradd -m -s /bin/bash snack
sudo mkdir -p /opt/snack-expiry-manager
sudo chown -R snack:snack /opt/snack-expiry-manager
# 将项目文件上传到 /opt/snack-expiry-manager

cd /opt/snack-expiry-manager
sudo -u snack python3 -m venv .venv
sudo -u snack .venv/bin/pip install --upgrade pip
sudo -u snack .venv/bin/pip install -r requirements.txt
```

### 3. 配置 systemd

```bash
sudo cp deploy/snack-expiry.service /etc/systemd/system/snack-expiry.service
sudo systemctl daemon-reload
sudo systemctl enable --now snack-expiry
sudo systemctl status snack-expiry
```

服务只监听 `127.0.0.1:8765`，Nginx 配置与 Docker 方式相同。

查看日志：

```bash
sudo journalctl -u snack-expiry -f
```

---

## 五、不想开放公网端口：Cloudflare Tunnel / Tailscale

### Tailscale（更简单，私有访问）

- 服务器和手机/电脑都安装 Tailscale，登录同一个账号；
- 手机访问 `http://服务器TailscaleIP:8765/mobile`；
- 不需要域名、不需要开 80/443，也没有公网暴露风险；
- 适合“只给自己用”的场景。

### Cloudflare Tunnel（有域名时体验更好）

```bash
# 临时测试地址（重启后变化，且没有登录保护，仅测试用）
cloudflared tunnel --url http://127.0.0.1:8765
```

正式使用建议创建命名 Tunnel，并在 Cloudflare 控制台配置 **Access**（邮箱验证 / 单点登录），再绑定域名。这样不需要在 Nginx 上做 Basic Auth。

---

## 六、常见问题

**1. 构建时下载 PyPI 很慢 / 失败**  
使用清华镜像重新构建：

```bash
sudo PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple docker compose build --no-cache
```

**2. 构建时报 `Release file ... is expired`**  
通常是服务器时间不准，或者 Debian 镜像缓存了过期的 InRelease。先检查时间：

```bash
date -u
timedatectl
```

如果时间不对，开启 NTP 同步：

```bash
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd
date -u
```

然后拉取最新代码后重新构建（Dockerfile 已默认切到阿里云 Debian 镜像，并跳过过期校验）：

```bash
cd /opt/snack-expiry-manager
sudo git pull
sudo docker compose build --no-cache
sudo docker compose up -d
```

海外服务器可以改用官方源：

```bash
sudo APT_MIRROR=deb.debian.org docker compose build --no-cache
```

**3. 容器启动后 /api/health 显示 `ocr_available: false`**  
看日志：

```bash
sudo docker compose logs --tail=200
```

通常是依赖没有安装完整；可尝试重新构建镜像。

**4. 第一次识别很慢或卡住**  
第一次识别会下载 PaddleOCR 模型（约 200MB），需要服务器能访问模型源。之后会使用 `paddlex_models` 卷中的缓存，通常 1–3 秒出结果。

**5. Nginx 上传图片报 413**  
确认配置里有 `client_max_body_size 15m;` 并重新加载 Nginx。

**6. Nginx 识别时 504 超时**  
确认 `proxy_read_timeout 180s;` 已生效；首次下载模型可能更久。

**7. 手机无法访问 / 打不开**  
- 确认域名解析正确；
- 确认服务器防火墙开放 80/443；
- 如使用 Cloudflare，确认 Tunnel 在运行；
- 如使用局域网 IP，确认手机和电脑在同一 Wi-Fi（这是本地使用方式，不是公网部署）。

**8. 数据在哪里？换手机怎么办？**  
数据在每台设备浏览器的 LocalStorage 中，不在服务器上。换设备请用「导出 Excel」→「导入 Excel」迁移。

**9. 需要电脑和手机共享同一份数据**  
当前版本不支持自动同步，需要增加服务端数据接口（SQLite / JSON + 版本号 + 冲突处理）。这是一个独立的开发项，不要误以为放到服务器上就会自动同步。

---

## 七、安全清单

- [ ] 公网访问已加 Basic Auth 或 Cloudflare Access
- [ ] 使用 HTTPS（certbot 或 Cloudflare）
- [ ] 8765 端口没有直接暴露到公网
- [ ] 防火墙只开放 SSH / 80 / 443
- [ ] 使用强密码
- [ ] 定期查看容器日志和磁盘空间
- [ ] 浏览器端定期导出 Excel 备份

---

## 八、相关文件

```
Dockerfile                          # 镜像构建
docker-compose.yml                  # 容器编排
.dockerignore
deploy/nginx-snack-expiry.conf      # Nginx + Basic Auth 示例
deploy/snack-expiry.service         # systemd 示例
deploy/README.md                    # 本文件
```
