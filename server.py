"""
零食店效期管家 —— OCR 识别 API 服务

图片识别能力移植自 F:\\cc\\ocr_python（PaddleOCR 3.x + FastAPI），
这里只保留「通用图片文字识别」接口，并在同一服务上托管前端静态页面。

启动：
    python server.py                # 默认 http://127.0.0.1:8765 ，自动打开浏览器
    python server.py --port 9000 --no-browser
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import threading
import time
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Optional

# ========== 线程配置 ==========
# Paddle/onnxruntime 默认会占满所有逻辑核，实际推理收益有限，限制为核心数一半。
if "OMP_NUM_THREADS" not in os.environ:
    _cores = os.cpu_count() or 8
    os.environ["OMP_NUM_THREADS"] = str(max(4, _cores // 2))

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps

# ========== 路径与日志 ==========
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = BASE_DIR / ".uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("snack-expiry-ocr")
# paddlex 的模型初始化日志比较吵，降到 WARNING
logging.getLogger("paddlex").setLevel(logging.WARNING)

# ========== 常量 ==========
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff", ".tif"}

# 语言代码 → 中文名（只保留常用项，PaddleOCR 本身支持更多）
LANG_MAP: dict[str, dict] = {
    "auto": {"name": "自动检测", "direction": "ltr"},
    "ch": {"name": "简体中文", "direction": "ltr"},
    "chinese_cht": {"name": "繁体中文", "direction": "ltr"},
    "en": {"name": "英文", "direction": "ltr"},
    "japan": {"name": "日文", "direction": "ltr"},
    "korean": {"name": "韩文", "direction": "ltr"},
}
SUPPORTED_LANGS = list(LANG_MAP.keys())

# 实际监听地址（由 main() 写入），用于判断手机是否可通过局域网访问
BIND_HOST = "0.0.0.0"


def _get_lan_ip() -> Optional[str]:
    """获取本机局域网 IP（用于提示手机访问地址）。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(0.3)
            # UDP connect 不会真正发包，只用于让系统选择出口网卡
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass

    try:
        ip = socket.gethostbyname(socket.gethostname())
        return ip if ip and not ip.startswith("127.") else None
    except OSError:
        return None


# ========== PaddleOCR 兼容层 ==========
ocr_engines: dict[str, "PaddleOCR"] = {}
_engine_lock = threading.Lock()
_paddleocr_version: Optional[str] = None
_ocr_import_error: Optional[str] = None

# paddlex 在部分环境下会缓存 onnxruntime 的依赖检测结果为 False，先打补丁。
try:
    import importlib.util as _importlib_util
    import paddlex.utils.deps as _paddlex_deps

    _original_is_dep_available = _paddlex_deps.is_dep_available

    @_paddlex_deps.lru_cache()  # type: ignore[attr-defined]
    def _patched_is_dep_available(dep, /, check_version=False):
        if dep == "onnxruntime":
            return _importlib_util.find_spec("onnxruntime") is not None
        return _original_is_dep_available(dep, check_version=check_version)

    _paddlex_deps.is_dep_available = _patched_is_dep_available
except Exception:  # pragma: no cover - 没有安装 paddlex 时由 OCR 接口返回友好错误
    pass


def _detect_paddleocr() -> tuple[bool, str]:
    """检测 PaddleOCR 是否可用，并缓存版本号。"""
    global _paddleocr_version, _ocr_import_error
    if _paddleocr_version or _ocr_import_error:
        return (_paddleocr_version is not None), _paddleocr_version or (_ocr_import_error or "")
    try:
        import paddleocr as _pkg  # noqa: F401

        _paddleocr_version = getattr(_pkg, "__version__", "unknown")
        return True, _paddleocr_version
    except Exception as exc:  # pragma: no cover
        _ocr_import_error = str(exc)
        return False, str(exc)


def _check_paddleocr_v3() -> bool:
    ok, version = _detect_paddleocr()
    if not ok:
        return False
    try:
        return int(str(version).split(".")[0]) >= 3
    except Exception:
        return False


def get_ocr(lang: Optional[str] = None) -> "PaddleOCR":
    """惰性创建并缓存 PaddleOCR 引擎（按语言）。"""
    ok, detail = _detect_paddleocr()
    if not ok:
        raise RuntimeError(
            "未检测到 PaddleOCR，请先安装依赖：pip install -r requirements.txt"
            f"（{detail}）"
        )

    cache_key = lang or "_auto"
    if cache_key in ocr_engines:
        return ocr_engines[cache_key]

    with _engine_lock:
        if cache_key in ocr_engines:
            return ocr_engines[cache_key]

        from paddleocr import PaddleOCR as _PaddleOCR

        logger.info("初始化 OCR 引擎：lang=%s", lang or "auto")
        started = time.time()
        try:
            if _check_paddleocr_v3():
                ocr_lang = None if lang in (None, "auto") else lang
                engine = _PaddleOCR(
                    lang=ocr_lang,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    engine="onnxruntime",
                )
            else:  # PaddleOCR 2.x
                engine = _PaddleOCR(use_angle_cls=True, lang=lang or "ch")
        except Exception as exc:
            logger.exception("OCR 引擎初始化失败")
            raise RuntimeError(f"OCR 引擎初始化失败：{exc}") from exc

        ocr_engines[cache_key] = engine
        logger.info("OCR 引擎初始化完成，用时 %.2fs", time.time() - started)
        return engine


def _parse_ocr_result_v3(result) -> tuple[list[str], list[dict], list[float]]:
    """解析 PaddleOCR 3.x predict() 的返回结果。"""
    all_text: list[str] = []
    details: list[dict] = []
    confidences: list[float] = []

    if not result:
        return all_text, details, confidences

    for res in result:
        if not isinstance(res, dict):
            continue
        dt_polys = res.get("dt_polys", []) or []
        rec_texts = res.get("rec_texts", []) or []
        rec_scores = res.get("rec_scores", []) or []

        for i, text in enumerate(rec_texts):
            if text is None or not str(text).strip():
                continue
            score = float(rec_scores[i]) if i < len(rec_scores) else 0.0
            if score <= 0.0:
                continue

            poly = dt_polys[i] if i < len(dt_polys) else None
            bbox: list[list[float]] = []
            if poly is not None and len(poly) > 0:
                bbox = [[float(p[0]), float(p[1])] for p in poly]

            all_text.append(str(text))
            confidences.append(score)
            details.append(
                {
                    "text": str(text),
                    "confidence": round(score, 4),
                    "bbox": bbox,
                    "box": _bbox_to_rect(bbox),
                }
            )

    return all_text, details, confidences


def _parse_ocr_result_v2(result) -> tuple[list[str], list[dict], list[float]]:
    """解析 PaddleOCR 2.x ocr() 的返回结果。"""
    all_text: list[str] = []
    details: list[dict] = []
    confidences: list[float] = []

    if not result or not result[0]:
        return all_text, details, confidences

    for line in result[0]:
        bbox = line[0] or []
        text = line[1][0]
        confidence = float(line[1][1])
        if not str(text).strip() or confidence <= 0:
            continue
        all_text.append(str(text))
        confidences.append(confidence)
        details.append(
            {
                "text": str(text),
                "confidence": round(confidence, 4),
                "bbox": bbox,
                "box": _bbox_to_rect(bbox),
            }
        )

    return all_text, details, confidences


def _bbox_to_rect(bbox: list) -> list[float]:
    """四点 bbox → 外接矩形 [x1, y1, x2, y2]。"""
    if not bbox or len(bbox) < 4:
        return []
    xs = [float(p[0]) for p in bbox]
    ys = [float(p[1]) for p in bbox]
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]


def do_ocr(engine: "PaddleOCR", img_path: str) -> tuple[list[str], list[dict], list[float]]:
    """执行 OCR，兼容 PaddleOCR 2.x / 3.x。"""
    if _check_paddleocr_v3():
        result = engine.predict(img_path)
        return _parse_ocr_result_v3(result)
    result = engine.ocr(img_path, cls=True)
    return _parse_ocr_result_v2(result)


# ========== 图片预处理 ==========
def _prepare_image(src: Path, dst: Path) -> tuple[int, int]:
    """纠正 EXIF 方向、统一色彩模式，并对过小/过大的图片做缩放。

    返回 OCR 实际使用的图片尺寸（bbox 坐标基于该尺寸）。
    """
    with Image.open(src) as opened:
        img = ImageOps.exif_transpose(opened)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        width, height = img.size
        longest = max(width, height)
        if longest > 2600:
            ratio = 2600 / longest
            img = img.resize((round(width * ratio), round(height * ratio)), Image.LANCZOS)
        elif longest < 1000:
            ratio = min(2.5, 1800 / max(longest, 1))
            img = img.resize((round(width * ratio), round(height * ratio)), Image.LANCZOS)

        img.save(dst, "JPEG", quality=94)
        return img.size


def _save_upload(content: bytes, suffix: str) -> Path:
    path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    path.write_bytes(content)
    return path


# ========== FastAPI ==========
app = FastAPI(
    title="零食店效期管家 OCR 服务",
    description="基于 PaddleOCR 的图片文字识别 API（仅提供识别能力）",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    """健康检查：不加载模型，返回依赖是否可用。"""
    ok, detail = _detect_paddleocr()
    return JSONResponse(
        content={
            "status": "ok" if ok else "degraded",
            "service": "零食店效期管家 OCR 服务",
            "ocr_available": ok,
            "paddleocr_version": detail if ok else None,
            "engine_loaded": bool(ocr_engines),
            "loaded_languages": list(ocr_engines.keys()),
            "supported_languages": SUPPORTED_LANGS,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }
    )


@app.get("/api/languages")
def get_supported_languages():
    return JSONResponse(
        content={
            "languages": [
                {"code": code, "name": info["name"], "direction": info["direction"]}
                for code, info in LANG_MAP.items()
            ]
        }
    )


@app.get("/api/network")
def network_info(request: Request):
    """返回本机与手机访问地址，供页面展示「手机访问」入口。"""
    port = request.url.port or 80
    lan_ip = _get_lan_ip()
    lan_enabled = BIND_HOST not in ("127.0.0.1", "localhost", "::1")
    return JSONResponse(
        content={
            "lan_ip": lan_ip,
            "port": port,
            "lan_enabled": lan_enabled,
            "pc_url": f"http://127.0.0.1:{port}/",
            "mobile_url": f"http://{lan_ip}:{port}/mobile" if lan_ip and lan_enabled else None,
            "preview_url": f"http://127.0.0.1:{port}/mobile",
        }
    )


@app.post("/api/ocr")
def ocr_image(
    file: UploadFile = File(..., description="要识别的图片"),
    lang: str = Form("auto", description="语言：auto/ch/en/japan/korean/chinese_cht"),
):
    """
    上传图片，返回识别到的文字、置信度与坐标。

    - `data.text`：按识别顺序拼接的全文
    - `data.lines`：逐行文本，包含 `text / confidence / box / bbox`
    - `data.width / height`：OCR 时使用的图片尺寸（坐标基准）
    """
    if lang not in SUPPORTED_LANGS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的语言代码：{lang}，支持：{', '.join(SUPPORTED_LANGS)}",
        )

    suffix = Path(file.filename or "image.jpg").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片格式：{suffix or '未知'}，支持：{', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传的文件为空")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="图片大小超过限制（10MB）")

    src_path = _save_upload(content, suffix)
    prepared_path = UPLOAD_DIR / f"{uuid.uuid4().hex}.jpg"

    try:
        # 验证图片是否可以正常解码
        try:
            width, height = _prepare_image(src_path, prepared_path)
        except Exception as exc:
            logger.warning("图片解析失败：%s", exc)
            raise HTTPException(status_code=400, detail="无法解析该图片，请更换 JPG/PNG 格式后重试")

        started = time.time()
        engine = get_ocr(lang)
        all_text, details, confidences = do_ocr(engine, str(prepared_path))

        full_text = "\n".join(all_text)
        avg_conf = round(float(np.mean(confidences)), 4) if confidences else 0.0
        logger.info(
            "识别完成：%s，%d 行，平均置信度 %.2f%%，用时 %.2fs",
            file.filename,
            len(details),
            avg_conf * 100,
            time.time() - started,
        )

        lang_info = LANG_MAP.get(lang, LANG_MAP["auto"])
        return JSONResponse(
            content={
                "success": True,
                "data": {
                    "text": full_text,
                    "lines": details,
                    "total_blocks": len(details),
                    "average_confidence": avg_conf,
                    "width": width,
                    "height": height,
                },
                "lang": lang,
                "lang_name": lang_info["name"],
                "filename": file.filename,
            }
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        logger.error("OCR 运行失败：%s", exc)
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.exception("OCR 识别异常")
        raise HTTPException(status_code=500, detail=f"OCR 识别失败：{exc}")
    finally:
        for path in (src_path, prepared_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


# ========== 静态前端 ==========
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", include_in_schema=False)
def index():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="前端页面不存在，请确认 static/index.html")
    return FileResponse(index_file)


@app.get("/mobile", include_in_schema=False)
def mobile_page():
    mobile_file = STATIC_DIR / "mobile.html"
    if not mobile_file.exists():
        raise HTTPException(status_code=404, detail="移动端页面不存在，请确认 static/mobile.html")
    return FileResponse(mobile_file)


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    icon = STATIC_DIR / "favicon.svg"
    if icon.exists():
        return FileResponse(icon, media_type="image/svg+xml")
    raise HTTPException(status_code=404)


# ========== 启动入口 ==========
def main() -> None:
    global BIND_HOST
    parser = argparse.ArgumentParser(description="零食店效期管家 OCR 服务")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="监听地址，默认 0.0.0.0（允许手机通过局域网访问）；仅电脑访问可设为 127.0.0.1",
    )
    parser.add_argument("--port", type=int, default=8765, help="监听端口，默认 8765")
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    args = parser.parse_args()
    BIND_HOST = args.host

    lan_ip = _get_lan_ip() if args.host in ("0.0.0.0", "::", "") else None
    pc_url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::', '') else args.host}:{args.port}"

    logger.info("=" * 62)
    logger.info("零食店效期管家已启动")
    logger.info("电脑访问：%s", pc_url)
    if lan_ip:
        logger.info("手机访问：http://%s:%s/mobile", lan_ip, args.port)
        logger.info("手机与电脑需连接同一个 Wi-Fi；首次访问请在 Windows 防火墙中允许 Python")
    else:
        logger.warning("未检测到局域网 IP；手机端可能无法访问")
    logger.info("OCR 接口文档：%s/docs", pc_url)
    logger.info("按 Ctrl+C 停止服务")
    logger.info("=" * 62)

    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(pc_url)).start()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
