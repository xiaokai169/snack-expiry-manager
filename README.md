# 零食效期管家

根据《零食店效期管理产品需求文档（PRD v1.0）》实现的网页版应用。

整体形态是 **纯前端页面 + 本机 OCR 识别 API**：

- 商品数据、档位设置全部保存在浏览器 LocalStorage，不上传云端；
- 图片识别由本机 Python 服务（FastAPI + PaddleOCR）完成，只提供「图片文字识别」能力；
- 前端页面也由这个 Python 服务托管，双击 `start.bat` 即可使用。

---

## 一、已实现功能

| 模块 | 功能 |
|------|------|
| 数据存储 | LocalStorage 自动保存、Excel 导出 / 导入、档位随文件一起备份、每周备份提醒 |
| 商品管理 | 新增、编辑、删除（二次确认）、表格展示、横向滚动、搜索与筛选 |
| 效期计算 | 按真实日历计算到期日；按月数计算保质期天数；按档位计算临期下架日 |
| 档位规则 | 设置页可增删改档位，保存后自动重算所有商品 |
| 临期预警 | 首页置顶预警列表、按紧迫程度排序、列表标红高亮、剩余天数 |
| 下架管理 | 在售 / 已下架分区；一键下架、恢复在售、彻底删除 |
| 数据统计 | 库存总览、临期分布、状态占比、下架统计、近 6 个月入库 / 下架趋势 |
| 拍照识别 | 电脑端上传包装照片；手机端可**直接拍照**或从相册选择，识别商品名称、生产日期、保质期并填表，人工核对后保存 |
| 表格识别 | 上传 / 拍摄手写、打印表格照片，按坐标还原行列，生成可编辑预览表，确认后批量导入 |
| 移动端 | 独立手机页面：底部导航、商品卡片、大按钮、拍照录入；手机访问时自动跳转移动版 |
| 其他 | 响应式布局、键盘 Esc 关闭弹窗、跨标签页数据同步、本地识别服务状态检测 |

> 说明：「无需下架」表示在售但不参与临期预警；「已下架」不计入在售库存与临期统计。

---

## 二、快速开始

### 环境要求

- Windows 10 / 11
- Python 3.10+（当前验证版本：3.11.9）
- Chrome / Edge / Firefox（推荐 Chrome / Edge）

### 方式 1：一键启动（推荐）

双击 **`start.bat`**。

脚本会按顺序寻找可用的 Python 环境：

1. 环境变量 `SNACK_PYTHON` 指向的 Python
2. 项目目录下 `python-path.txt` 中记录的 Python（本机自定义环境，不提交到 Git）
3. 项目目录下 `.venv\Scripts\python.exe`（由 `setup.bat` 创建）
4. 系统 `python`

> 如果本机已经有一个装好 PaddleOCR 的虚拟环境，可以在项目根目录新建 `python-path.txt`，写入该环境的 `python.exe` 完整路径。

服务启动后会自动打开电脑端页面：

```
http://127.0.0.1:8765
```

启动窗口里还会打印手机访问地址，例如：

```
手机访问：http://192.168.x.x:8765/mobile
```

手机与电脑连接**同一个 Wi-Fi** 后，在手机浏览器打开这个地址即可进入移动版。首次访问如果打不开，请在 Windows 防火墙中允许 Python 访问专用网络。

> 请保持黑色命令行窗口开启；关闭窗口或按 `Ctrl+C` 即停止服务。  
> 如果默认端口上已有本服务在运行，`start.bat` 会直接打开浏览器，不会重复启动。

### 方式 2：安装独立运行环境

如果当前机器没有可复用的 PaddleOCR 环境，双击 **`setup.bat`**：

- 创建项目内 `.venv`
- 安装 `requirements.txt` 中的依赖（PaddleOCR 等，下载量约 1GB，耗时较长）
- 安装完成后运行 `start.bat`

### 方式 3：手动启动

```bash
python server.py                          # 默认监听 0.0.0.0:8765，电脑和手机都可访问
python server.py --host 127.0.0.1         # 只允许本机访问
python server.py --port 9000              # 指定端口
python server.py --no-browser             # 不自动打开浏览器
```

> ⚠️ 请不要直接双击 `static/index.html` 打开页面。前端使用 ES Module，浏览器在 `file://` 下会拦截脚本加载；请始终通过 `start.bat` / `python server.py` 访问。电脑端的网页摄像头要求 `localhost`；移动端拍照使用手机系统相机，不要求 HTTPS。

### 首次识别

PaddleOCR 模型默认缓存到：

```
C:\Users\<用户名>\.paddlex\official_models
```

- 本机已有模型缓存时会直接加载；
- 没有缓存时，首次识别会联网下载模型（约 200MB），之后即可离线使用；
- 不进行拍照识别时，除 OCR 外的所有功能均可正常使用。

---

## 三、目录结构

```
my_code_home/
├─ server.py                 # FastAPI 服务：OCR API + 前端静态托管
├─ requirements.txt          # Python 依赖
├─ start.bat                 # 一键启动（电脑 / 局域网使用）
├─ setup.bat                 # 创建独立虚拟环境并安装依赖
├─ Dockerfile                # 服务器镜像构建
├─ docker-compose.yml        # 服务器容器编排
├─ deploy/
│  ├─ README.md              # 服务器部署详细步骤
│  ├─ nginx-snack-expiry.conf
│  └─ snack-expiry.service
├─ static/
│  ├─ index.html             # 电脑端页面
│  ├─ mobile.html            # 移动端页面
│  ├─ favicon.svg
│  ├─ css/
│  │  ├─ styles.css          # 电脑端样式
│  │  └─ mobile.css          # 移动端样式
│  ├─ vendor/
│  │  └─ xlsx.full.min.js    # SheetJS，用于 Excel 导入导出
│  └─ js/
│     ├─ app.js              # 电脑端入口、路由、交互
│     ├─ mobile-app.js       # 移动端入口、拍照、路由、交互
│     ├─ views.js            # 电脑端视图
│     ├─ store.js            # LocalStorage、效期计算、统计、导入
│     ├─ excel.js            # Excel 导出 / 解析 / 模板
│     ├─ ocr.js              # OCR API 调用、包装信息解析、表格行列还原
│     ├─ charts.js           # SVG 图表（无第三方图表库）
│     ├─ ui.js               # 弹窗、Toast、确认框、徽章
│     └─ utils.js            # 日期、文件、压缩、格式化等工具
├─ .uploads/                 # 运行时临时上传目录（自动清理）
└─ README.md
```

---

## 四、效期计算规则

### 到期日

`生产日期 + 保质期（月）`，按真实日历月份推算：

- 1/31 + 1 个月 = 2/28（或闰年 2/29）
- 支持 0.5 个月等小数：整数月按日历，小数部分按 30.4375 天折算

### 保质期（天）

自动计算生产日期到到期日之间的真实天数。

### 临期下架日

根据「保质期（天）」匹配档位，从到期日向前推：

| 保质期（天） | 提前下架天数 |
|---|---|
| 0 – 3 | 0 |
| 4 – 10 | 1 |
| 11 – 30 | 2 |
| 31 – 60 | 5 |
| 61 – 180 | 7 |
| 181 – 9999 | 15 |

档位可在「设置」页修改。保存后会重新计算所有商品的临期下架日。

---

## 五、OCR API

服务地址：`http://127.0.0.1:8765`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查、OCR 是否可用、引擎加载状态 |
| GET | `/api/languages` | 支持的语言列表 |
| POST | `/api/ocr` | 图片文字识别 |
| GET | `/api/network` | 返回电脑 / 手机访问地址 |
| GET | `/docs` | Swagger 接口文档 |

### 识别接口

```bash
curl -X POST "http://127.0.0.1:8765/api/ocr" \
  -F "file=@包装照片.jpg" \
  -F "lang=auto"
```

返回结构：

```json
{
  "success": true,
  "data": {
    "text": "乐事薯片 黄瓜味\n生产日期：2026/08/21\n保质期：9个月",
    "lines": [
      {
        "text": "生产日期：2026/08/21",
        "confidence": 0.999,
        "box": [118, 428, 793, 498],
        "bbox": [[118, 428], [793, 428], [793, 498], [118, 498]]
      }
    ],
    "total_blocks": 3,
    "average_confidence": 0.995,
    "width": 1800,
    "height": 1200
  },
  "lang": "auto",
  "lang_name": "自动检测",
  "filename": "包装照片.jpg"
}
```

- `box` 为外接矩形 `[x1, y1, x2, y2]`，`bbox` 为四点坐标；
- 表格识别由前端根据坐标还原行 / 列，不依赖云端接口；
- 单张图片限制 10MB，支持 JPG / PNG / BMP / WEBP / TIFF。

---

## 六、数据安全与备份

1. 所有商品与设置保存在浏览器 LocalStorage，键名：
   `snack-expiry-manager.v1`
2. 每次新增、编辑、下架、导入等操作都会立即写入本地；
3. **电脑端和手机端各自保存在所在浏览器的本地存储中**，不会自动互相同步；需要迁移时请用 Excel 导出 / 导入；
4. 开启「每周备份提醒」后，超过 7 天未导出会在首页提示；
5. 导出的 Excel 包含：
   - `商品数据`：全部商品明细
   - `档位设置`：当前临期档位（导入时可选择恢复）
   - `备份说明`：导出时间与使用说明
6. 清理浏览器站点数据、切换浏览器 / 电脑会导致本地数据丢失，**请定期导出备份**。

---

## 七、使用小贴士

- **录入**：生产日期 + 保质期（月）+ 数量即可，其它日期自动计算；
- **临期**：首页预警按到期日从近到远排序；商品列表中深红色 = 已过期，浅红色 = 已进入临期下架期；
- **下架**：在售列表或预警列表点「标记下架」，商品自动进入「已下架」；
- **识别包装**：尽量正对包装，拍清「生产日期」「保质期」区域；识别结果务必核对后保存；
- **识别表格**：尽量正对表格拍摄、保证表头和一列列文字清晰；预览表可逐格修改、增删行；
- **手机拍照**：移动端「拍照识别」直接调用手机系统相机，不依赖 HTTPS；也可以从相册选择照片；
- **手机访问**：手机和电脑连同一个 Wi-Fi，用启动窗口打印的 `http://局域网IP:8765/mobile` 打开；手机访问电脑端地址时会自动跳到移动版，点击移动版右上角「电脑版」可切回。

---

## 八、常见问题

**Q：页面提示「识别服务未连接」？**  
A：确认已运行 `start.bat`，且命令行窗口未关闭。点击页面右上角状态或设置页「重新检测」重试。

**Q：启动提示端口被占用？**  
A：换一个端口启动：`python server.py --port 9000`，然后访问 `http://127.0.0.1:9000`。

**Q：识别很慢 / 第一次识别卡住？**  
A：首次识别需要加载模型或联网下载模型，请耐心等待；后续识别通常 1–3 秒。

**Q：提示缺少 `paddleocr` / `onnxruntime`？**  
A：运行 `setup.bat` 安装依赖，或让 `start.bat` 使用已有的 PaddleOCR 虚拟环境。

**Q：手写表格识别不准？**  
A：手写字体和拍摄角度对 OCR 影响较大。请在预览表中直接修改错误单元格，或补全缺失行后再导入。

**Q：换电脑 / 换手机后数据没了？**  
A：LocalStorage 不跨设备同步。请用「设置 → 导出 Excel」备份，并在新设备上「导入 Excel」。

**Q：手机打不开移动端页面？**  
A：确认手机和电脑连接同一个 Wi-Fi；确认启动窗口打印的手机地址正确；在 Windows 防火墙中允许 Python 访问专用网络；公司 / 商场网络若开启了 AP 隔离，设备之间可能无法互访。

**Q：手机拍照按钮没有打开相机？**  
A：移动端使用浏览器原生拍照能力，请通过手机浏览器访问页面，并在系统弹窗中允许相机 / 文件访问。若浏览器不支持，可直接用「从相册选择」。

---

## 九、技术说明

- 后端：FastAPI + Uvicorn，OCR 使用 PaddleOCR 3.x（ONNX Runtime 引擎，中英自动识别）；
- 前端：原生 HTML / CSS / JavaScript（ES Modules），无构建步骤；
- 图表：手写 SVG / CSS，无图表库依赖；
- Excel：本地内置 SheetJS（`xlsx.full.min.js`）；
- 图片识别完全在本机 Python 进程中执行，图片不会上传到互联网；
- 为支持手机访问，服务默认监听 `0.0.0.0`（局域网内可访问）。如果只想在本机使用，可运行 `python server.py --host 127.0.0.1`；
- 服务没有账号体系，请只在可信的门店 Wi-Fi / 局域网内使用。

---

## 十、PRD 功能对照

F1–F5 数据存储与导入导出、F6–F11 商品管理、F12–F13 包装拍照识别、
F14–F15 表格拍照识别、F16–F19 临期预警、F20–F24 下架管理、
F25–F29 数据统计、N1–N5 非功能要求，均已在当前版本实现。

其中：

- F28 时间趋势按「近 6 个月」按月统计；
- F29 图表使用内联 SVG / CSS 实现；
- N2 备份提醒按 7 天周期提示，可在设置页关闭。


---

## 十一、服务器部署（公网 / 云服务器）

项目已经附带 Docker 和 Nginx 部署文件，推荐流程：

1. 一台 Ubuntu 22.04 / 24.04 服务器（建议 4GB 内存、10GB 磁盘）；
2. 使用 `Dockerfile` / `docker-compose.yml` 构建并启动服务（容器只监听 `127.0.0.1:8765`）；
3. 用 Nginx 反向代理并加 **Basic Auth 登录保护**；
4. 用 certbot 配置 HTTPS；
5. 电脑和手机访问 `https://你的域名/`，手机自动进入移动版。

快速命令（完整步骤见 [`deploy/README.md`](deploy/README.md)）：

```bash
cd /opt
sudo git clone https://github.com/xiaokai169/snack-expiry-manager.git snack-expiry-manager
cd snack-expiry-manager
sudo docker compose up -d --build
curl http://127.0.0.1:8765/api/health

sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx
sudo htpasswd -c /etc/nginx/.htpasswd snackadmin
# 修改 deploy/nginx-snack-expiry.conf 的域名后启用
sudo certbot --nginx -d 你的域名
```

> ⚠️ 重要：**服务器只负责页面和 OCR，商品数据仍然保存在每个浏览器各自的 LocalStorage 中**。
> 电脑端和手机端不会自动同步；换设备请用 Excel 导出 / 导入。如果要做多设备共享数据，
> 需要额外开发服务端数据接口。
>
> 应用本身没有账号体系，公网部署**必须**加 Basic Auth 或 Cloudflare Access，
> 并且不要把 8765 端口直接暴露到公网。

如果不想开放公网端口，也可以使用 Tailscale 或 Cloudflare Tunnel，详见部署文档。
