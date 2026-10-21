/* =========================================================
   通用工具函数
   ========================================================= */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Date → 本地时区 YYYY-MM-DD */
export function toISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Date → YYYY/MM/DD（与 PRD 展示格式一致） */
export function fmtDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return '—';
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

/** 任意常见日期格式 → 本地零点 Date；无效返回 null */
export function parseDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === 'number') {
    // Excel 序列日期（1900 日期系统）
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null;
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    if (Number.isNaN(utc.getTime())) return null;
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  const normalized = text
    .replace(/[年月]/g, '-')
    .replace(/[日号]/g, '')
    .replace(/[./]/g, '-')
    .replace(/\s+/g, '');

  let match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, y, m, d] = match;
    return buildValidDate(Number(y), Number(m), Number(d));
  }

  match = normalized.match(/^(\d{8})$/);
  if (match) {
    const raw = match[1];
    return buildValidDate(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8)));
  }

  // 两位年份：26/08/21
  match = normalized.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, y, m, d] = match;
    const year = Number(y) > 70 ? 1900 + Number(y) : 2000 + Number(y);
    return buildValidDate(year, Number(m), Number(d));
  }

  return null;
}

function buildValidDate(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function todayISO() {
  return toISODate(todayDate());
}

export function addDays(value, days) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

/**
 * 按真实日历加月份，日期超出月末时取月末（如 1/31 + 1 月 = 2/28）。
 * 支持小数月份：整数部分按日历月份，小数部分按 30.4375 天折算。
 */
export function addMonthsClamped(value, months) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  if (!date) return null;
  const amount = Number(months);
  if (!Number.isFinite(amount)) return null;

  const whole = Math.trunc(amount);
  const fraction = amount - whole;

  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + whole);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, lastDay));

  if (fraction) {
    date.setDate(date.getDate() + Math.round(fraction * 30.4375));
  }
  return date;
}

/** 两个日期之间相差的整天数（end - start），使用 UTC 避免夏令时误差 */
export function daysBetween(start, end) {
  const a = start instanceof Date ? start : parseDate(start);
  const b = end instanceof Date ? end : parseDate(end);
  if (!a || !b) return null;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatCnDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return '';
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${weekdays[date.getDay()]}`;
}

export function uid(prefix = 'p') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function debounce(fn, delay = 180) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('zh-CN');
}

/** 全角字符 → 半角，压缩空白，便于 OCR 文本解析 */
export function normalizeOcrText(input) {
  return String(input ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .replace(/\r/g, '\n');
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nowStamp() {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
}

/** 读取 File 为 dataURL */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 用 canvas 旋转图片，返回新的 Blob（用于 OCR 前纠正方向） */
export function rotateImageFile(file, degrees = 90) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const angle = ((degrees % 360) + 360) % 360;
      const swap = angle === 90 || angle === 270;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? image.naturalHeight : image.naturalWidth;
      canvas.height = swap ? image.naturalWidth : image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) {
            reject(new Error('图片处理失败'));
            return;
          }
          const safeName = (file.name || 'image.jpg').replace(/\.[^.]+$/, '');
          resolve(new File([blob], `${safeName}.jpg`, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.94
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    image.src = url;
  });
}

/** 将超长文本截断 */
export function truncate(text, length = 60) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * 移动端上传前压缩图片：超过阈值时缩放到最长边 maxDimension 并转成 JPEG。
 * 可显著减少手机原图的体积与上传时间；失败时退回原文件。
 */
export async function compressImageFile(
  file,
  { maxDimension = 2200, quality = 0.9, skipBelowBytes = 1.5 * 1024 * 1024 } = {}
) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.size <= skipBelowBytes) return file;

  try {
    let bitmap;
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        bitmap = await createImageBitmap(file);
      }
    }
    if (!bitmap) return file;

    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;

    const name = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch (error) {
    console.warn('图片压缩失败，使用原图', error);
    return file;
  }
}
