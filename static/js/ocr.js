/* =========================================================
   OCR 接入与结果解析
   - 识别能力由本机 Python 服务提供（POST /api/ocr）
   - 包装图：解析名称 / 生产日期 / 保质期
   - 表格图：按坐标还原行与列，生成可编辑预览
   ========================================================= */
import {
  daysBetween,
  normalizeOcrText,
  parseDate,
  toISODate,
  todayISO
} from './utils.js';

/** 直接双击打开 HTML 时，默认连接到本机 8765 端口 */
export const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => window.clearTimeout(timer) };
}

/* ========================= 服务状态 ========================= */
export async function checkHealth() {
  const timeout = withTimeout(4500);
  try {
    const response = await fetch(`${API_BASE}/api/health`, { signal: timeout.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { ok: Boolean(data.ocr_available), data };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error.name === 'AbortError' ? '连接超时' : error.message
    };
  } finally {
    timeout.clear();
  }
}

/* ========================= 调用识别接口 ========================= */
export async function recognizeImage(file, { lang = 'auto' } = {}) {
  if (!file) throw new Error('请先选择图片');
  if (!file.type.startsWith('image/')) throw new Error('请选择 JPG / PNG 等图片文件');
  if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，请压缩后再试');

  const formData = new FormData();
  formData.append('file', file, file.name || 'photo.jpg');
  formData.append('lang', lang);

  const timeout = withTimeout(120000);
  let response;
  try {
    response = await fetch(`${API_BASE}/api/ocr`, {
      method: 'POST',
      body: formData,
      signal: timeout.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('识别超时，请换一张更清晰的图片重试');
    throw new Error('无法连接识别服务，请确认已运行 start.bat，并保持服务窗口开启');
  } finally {
    timeout.clear();
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.detail || `识别服务返回错误（HTTP ${response.status}）`;
    throw new Error(detail);
  }
  if (!payload?.success || !payload?.data) {
    throw new Error(payload?.detail || '识别失败，请稍后重试');
  }
  return payload.data;
}

/* ========================= 通用文本解析 ========================= */
const DATE_WITH_SEPARATOR = /(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/;
const DATE_COMPACT = /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/;

function toHalfWidthDate(text) {
  return normalizeOcrText(text)
    .replace(/[OoОо]/g, '0')
    .replace(/[lI|]/g, '1');
}

/** 从一段文字中提取第一个合法日期，返回 YYYY-MM-DD */
export function extractDateFromText(text) {
  const normalized = toHalfWidthDate(text);
  let match = normalized.match(DATE_WITH_SEPARATOR);
  if (match) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const date = parseDate(iso);
    if (date) return toISODate(date);
  }

  match = normalized.match(DATE_COMPACT);
  if (match) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const date = parseDate(iso);
    if (date) return toISODate(date);
  }

  return null;
}

function allDatesInText(text) {
  const normalized = toHalfWidthDate(text);
  const results = [];
  const regex = new RegExp(DATE_WITH_SEPARATOR.source, 'g');
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const date = parseDate(iso);
    if (date) results.push(toISODate(date));
  }

  if (!results.length) {
    const compactRegex = new RegExp(DATE_COMPACT.source, 'g');
    while ((match = compactRegex.exec(normalized)) !== null) {
      const iso = `${match[1]}-${match[2]}-${match[3]}`;
      const date = parseDate(iso);
      if (date) results.push(toISODate(date));
    }
  }
  return [...new Set(results)];
}

function isPlausibleProduction(iso) {
  const date = parseDate(iso);
  if (!date) return false;
  const age = daysBetween(date, todayISO());
  return age !== null && age >= -7 && age <= 3650;
}

/** 天数 → 月数（保留 0.5 档，用于回填表单） */
export function daysToMonths(days) {
  const value = Math.max(0.5, Math.round((Number(days) / 30.4375) * 2) / 2);
  return Math.min(240, value);
}

/** 从文字中解析保质期（月） */
export function extractShelfLifeMonths(text, unitHint = '') {
  const normalized = toHalfWidthDate(text);
  // 去掉日期片段，避免把「2026年8月」里的 8 误当成 8 个月
  const withoutDates = normalized
    .replace(new RegExp(DATE_WITH_SEPARATOR.source, 'g'), ' ')
    .replace(new RegExp(DATE_COMPACT.source, 'g'), ' ');

  let match = normalized.match(/(?:保质期|保存期|有效期|最佳食用期)[^0-9]{0,10}(\d{1,4}(?:\.\d+)?)\s*(个月|月)/);
  if (!match) {
    match = withoutDates.match(/(\d{1,4}(?:\.\d+)?)\s*(个月|月)/);
  }
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return Math.min(240, value);
  }

  match = normalized.match(/(?:保质期|保存期|有效期|最佳食用期)[^0-9]{0,10}(\d{1,4})\s*(天|日)/);
  if (!match) {
    match = withoutDates.match(/(\d{1,4})\s*(天|日)/);
  }
  if (match) {
    const days = Number(match[1]);
    if (Number.isFinite(days) && days > 0) return daysToMonths(days);
  }

  if (unitHint === 'day' || unitHint === 'month') {
    const numberMatch = withoutDates.match(/(\d{1,4}(?:\.\d+)?)/);
    if (numberMatch) {
      const value = Number(numberMatch[1]);
      if (Number.isFinite(value) && value > 0) {
        return unitHint === 'day' ? daysToMonths(value) : Math.min(240, value);
      }
    }
  }

  return null;
}

function extractQuantity(text) {
  const match = toHalfWidthDate(text).match(/(?:数量|库存|件数)?[^0-9]{0,4}(\d{1,6})/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hasCjk(text) {
  return /[一-鿿]/.test(text);
}

function cleanName(text) {
  return String(text || '')
    .replace(/^[\s:：·•\-–—]+/, '')
    .replace(/[™®©]/g, '')
    .replace(/[|｜]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,。.;；]+$/, '')
    .trim()
    .slice(0, 40);
}

/* ========================= 包装图解析 ========================= */
export function parsePackageResult(result) {
  const rawText = String(result?.text || '');
  const lines = (Array.isArray(result?.lines) ? result.lines : [])
    .map((line) => ({
      text: String(line.text || '').trim(),
      confidence: Number(line.confidence) || 0,
      box: Array.isArray(line.box) ? line.box : [],
      centerY: Array.isArray(line.box) && line.box.length >= 4 ? (line.box[1] + line.box[3]) / 2 : 0,
      centerX: Array.isArray(line.box) && line.box.length >= 4 ? (line.box[0] + line.box[2]) / 2 : 0,
      height: Array.isArray(line.box) && line.box.length >= 4 ? Math.abs(line.box[3] - line.box[1]) : 20
    }))
    .filter((line) => line.text);

  const sortedLines = lines.length
    ? [...lines].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX)
    : rawText.split('\n').filter(Boolean).map((text) => ({
      text,
      confidence: 0,
      box: [],
      centerY: 0,
      centerX: 0,
      height: 20
    }));

  const notes = [];

  /* ---- 生产日期 ---- */
  let productionDate = extractLabeledDate(sortedLines);
  if (!productionDate) {
    const dates = allDatesInText(rawText);
    const plausible = dates.filter(isPlausibleProduction).sort();
    productionDate = plausible[0] || dates.sort()[0] || null;
  }
  if (!productionDate) notes.push('未识别到生产日期，请手动填写');

  /* ---- 保质期 ---- */
  let shelfLifeMonths = extractShelfLifeMonths(rawText);
  if (!shelfLifeMonths) {
    const expiryDate = extractLabeledExpiry(sortedLines);
    if (expiryDate && productionDate && expiryDate > productionDate) {
      const days = daysBetween(productionDate, expiryDate);
      if (days && days > 0) {
        shelfLifeMonths = daysToMonths(days);
        notes.push(`保质期根据到期日 ${expiryDate.replace(/-/g, '/')} 推算，请核对`);
      }
    }
  }
  if (shelfLifeMonths) {
    if (/保质期[^0-9]{0,10}\d{1,4}\s*(天|日)/.test(toHalfWidthDate(rawText))) {
      notes.push('包装标注为「天」，已换算为月数，请核对');
    }
  } else {
    notes.push('未识别到保质期，请手动填写');
  }

  /* ---- 商品名称 ---- */
  const name = extractProductName(sortedLines);
  if (!name) notes.push('未识别到商品名称，请手动填写');

  /* ---- 数量（包装上通常没有，识别到才填） ---- */
  const quantityMatch = toHalfWidthDate(rawText).match(/(?:数量|库存)[^0-9]{0,6}(\d{1,6})/);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : null;

  const confidence = Number(result?.average_confidence) || 0;
  if (confidence && confidence < 0.72) {
    notes.push('整体识别置信度偏低，请仔细核对识别结果');
  }

  return {
    name: name || '',
    productionDate: productionDate || '',
    shelfLifeMonths: shelfLifeMonths || '',
    quantity: quantity ?? '',
    notes,
    rawText,
    confidence
  };
}

function extractLabeledDate(lines) {
  const labelRe = /(生产日期|生产日|制造日期|灌装日期|打码日期|生产批号)/;
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].text;
    if (!labelRe.test(text)) continue;

    const date = extractDateFromText(text);
    if (date) return date;

    for (let next = 1; next <= 2 && i + next < lines.length; next += 1) {
      const nearby = lines[i + next].text;
      const nearbyDate = extractDateFromText(nearby);
      if (nearbyDate) return nearbyDate;
    }
  }
  return null;
}

function extractLabeledExpiry(lines) {
  const labelRe = /(保质期至|有效期至|最佳食用期至|到期日|到期日期)/;
  for (const line of lines) {
    if (!labelRe.test(line.text)) continue;
    const date = extractDateFromText(line.text);
    if (date) return date;
  }
  return null;
}

function extractProductName(lines) {
  const labelRe = /(?:品名|商品名称|产品名称|名称)[：:\s]+(.{2,40})/;
  for (const line of lines) {
    const match = normalizeOcrText(line.text).match(labelRe);
    if (match) {
      const name = cleanName(match[1]);
      if (name) return name;
    }
  }

  const noiseRe = /(生产日期|生产日|保质期|保存期|有效期|净含量|配料|营养成分|营养|储存|保存|生产商|制造商|地址|电话|传真|邮箱|网址|邮编|条形码|条码|执行标准|许可证|温馨提示|过敏原|食用方法|经销商|产地|规格|含量|http|www|日期|批号)/i;

  const candidates = [];
  let previousY = null;
  for (const line of lines) {
    const text = cleanName(line.text);
    if (!text || text.length < 2) continue;
    if (noiseRe.test(text)) continue;
    if (extractDateFromText(text)) continue;
    if (!/[\p{L}]/u.test(text)) continue;

    const digitCount = (text.match(/\d/g) || []).length;
    if (digitCount / text.length > 0.55) continue;
    if (!hasCjk(text) && text.length < 3) continue;

    const gap = previousY === null ? 0 : Math.abs(line.centerY - previousY);
    candidates.push({ ...line, text, gap });
    previousY = line.centerY;
    if (candidates.length >= 6) break;
  }

  if (!candidates.length) return '';

  const chineseCandidates = candidates.filter((candidate) => hasCjk(candidate.text));
  const pool = chineseCandidates.length ? chineseCandidates : candidates;
  const best = pool[0];

  // 品牌名与商品名常被识别成相邻两行，尝试合并（如「乐事」+「薯片 黄瓜味」）
  if (best && best.text.length <= 6) {
    const next = pool[1];
    if (
      next
      && Math.abs(next.centerY - best.centerY) < Math.max(best.height, 20) * 2.2
      && next.text.length <= 22
      && !extractDateFromText(next.text)
    ) {
      const combined = cleanName(`${best.text} ${next.text}`);
      if (combined.length <= 32) return combined;
    }
  }

  return best ? best.text : '';
}

/* ========================= 表格图解析 ========================= */
function lineHeightStats(lines) {
  const heights = lines.map((line) => line.height).filter((height) => height > 0).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)] : 18;
}

function groupLinesIntoRows(lines, tolerance) {
  const sorted = [...lines].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
  const rows = [];

  for (const line of sorted) {
    let row = rows[rows.length - 1];
    if (row && Math.abs(line.centerY - row.centerY) <= tolerance) {
      row.cells.push(line);
      row.centerY = (row.centerY * (row.cells.length - 1) + line.centerY) / row.cells.length;
    } else {
      rows.push({ centerY: line.centerY, cells: [line] });
    }
  }

  for (const row of rows) {
    row.cells.sort((a, b) => a.centerX - b.centerX);
  }

  // 合并疑似被拆成两行的单元格（仅当下一行只有一个单元格，且与上一行很靠近）
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const row = rows[i];
    const previous = rows[i - 1];
    if (row.cells.length !== 1 || previous.cells.length < 2) continue;
    const gap = row.centerY - previous.centerY;
    if (gap > tolerance * 2.2) continue;
    const cell = row.cells[0];
    if (extractDateFromText(cell.text) || /^\d+(\.\d+)?$/.test(cell.text)) continue;
    previous.cells.push(cell);
    rows.splice(i, 1);
  }

  return rows;
}

function normalizeHeader(text) {
  return normalizeOcrText(text).replace(/[\s()（）【】\[\]:：]/g, '');
}

function detectHeader(row) {
  const map = {};
  for (const cell of row.cells) {
    const text = normalizeHeader(cell.text);
    if (!text) continue;

    if (!map.name && /商品名称|商品名|品名|货品名称|产品名称|名称/.test(text)) {
      map.name = cell;
    } else if (!map.productionDate && /生产日期|生产日|制造日期|灌装日期|日期/.test(text) && !/保质期/.test(text)) {
      map.productionDate = cell;
    } else if (!map.months && /保质期|效期|月数|保质天数/.test(text)) {
      map.months = { ...cell, unit: /天/.test(text) ? 'day' : 'month' };
    } else if (!map.quantity && /数量|库存|件数|箱数/.test(text)) {
      map.quantity = cell;
    } else if (!map.remark && /备注|说明|其他/.test(text)) {
      map.remark = cell;
    }
  }

  return Object.keys(map).length >= 2 && (map.name || map.productionDate) ? map : null;
}

function nearestColumn(cell, columns) {
  let best = null;
  let bestDistance = Infinity;
  for (const column of columns) {
    const distance = Math.abs(cell.centerX - column.centerX);
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return best;
}

function parseTableRowByHeader(row, headerMap) {
  const columns = Object.entries(headerMap).map(([field, cell]) => ({
    field,
    centerX: cell.centerX,
    unit: cell.unit || ''
  }));

  const buckets = {};
  for (const cell of row.cells) {
    const column = nearestColumn(cell, columns);
    if (!column) continue;
    buckets[column.field] = buckets[column.field]
      ? `${buckets[column.field]} ${cell.text}`
      : cell.text;
  }

  const name = cleanName(buckets.name || '');
  if (!name && !buckets.productionDate && !buckets.months && !buckets.quantity) return null;

  const productionDate = extractDateFromText(buckets.productionDate || '') || '';
  const monthHint = headerMap.months?.unit || '';
  const shelfLifeMonths = extractShelfLifeMonths(buckets.months || '', monthHint) || '';
  const quantity = extractQuantity(buckets.quantity || '') ?? '';

  return {
    name,
    productionDate,
    shelfLifeMonths,
    quantity,
    remark: cleanName(buckets.remark || '')
  };
}

function parseTableRowHeuristically(row) {
  const cells = row.cells.map((cell) => ({ ...cell, text: normalizeOcrText(cell.text).trim() })).filter((cell) => cell.text);
  if (!cells.length) return null;

  const joined = cells.map((cell) => cell.text).join(' ');
  const productionDate = extractDateFromText(joined) || '';

  let name = '';
  let months = '';
  let quantity = '';
  let remark = '';

  const nonDateCells = [];
  for (const cell of cells) {
    if (extractDateFromText(cell.text)) continue;
    if (/^\d+(\.\d+)?\s*(个月|月|天|日)?$/.test(cell.text)) continue;
    if (!/[\p{L}]/u.test(cell.text)) continue;
    if (!name && hasCjk(cell.text)) {
      name = cleanName(cell.text);
      continue;
    }
    nonDateCells.push(cell);
  }

  if (!name) {
    const firstText = cells.find((cell) => /[\p{L}]/u.test(cell.text));
    name = cleanName(firstText?.text || '');
  }

  const numericCells = cells
    .filter((cell) => !extractDateFromText(cell.text))
    .map((cell) => {
      const monthsFromText = extractShelfLifeMonths(cell.text);
      const numberMatch = cell.text.match(/(\d{1,5}(?:\.\d+)?)/);
      return {
        cell,
        number: numberMatch ? Number(numberMatch[1]) : null,
        monthsFromText
      };
    })
    .filter((item) => item.number !== null || item.monthsFromText);

  if (numericCells.length) {
    const monthCandidate = numericCells.find((item) => item.monthsFromText)
      || numericCells.find((item) => item.number >= 1 && item.number <= 240 && /^[\d.]+\s*(个月|月|天|日)?$/.test(item.cell.text.trim()));
    if (monthCandidate) {
      months = monthCandidate.monthsFromText || Math.min(240, monthCandidate.number);
    }

    const quantityCandidate = numericCells
      .filter((item) => item !== monthCandidate
        && Number.isInteger(item.number)
        && item.number >= 0
        && item.number <= 99999)
      .sort((a, b) => (a.cell.centerX > b.cell.centerX ? 1 : -1))[0];
    if (quantityCandidate) quantity = quantityCandidate.number;
  }

  const remarkCell = cells[cells.length - 1];
  if (remarkCell && remarkCell.text !== name && !extractDateFromText(remarkCell.text)) {
    const maybeRemark = cleanName(remarkCell.text);
    if (maybeRemark && maybeRemark !== String(months) && maybeRemark !== String(quantity) && !/^\d+$/.test(maybeRemark)) {
      remark = maybeRemark;
    }
  }

  return {
    name,
    productionDate,
    shelfLifeMonths: months,
    quantity: quantity === '' ? '' : Number(quantity),
    remark
  };
}

export function parseTableResult(result) {
  const rawText = String(result?.text || '');
  const lines = (Array.isArray(result?.lines) ? result.lines : [])
    .map((line) => ({
      text: String(line.text || '').trim(),
      box: Array.isArray(line.box) ? line.box : [],
      centerY: Array.isArray(line.box) && line.box.length >= 4 ? (line.box[1] + line.box[3]) / 2 : 0,
      centerX: Array.isArray(line.box) && line.box.length >= 4 ? (line.box[0] + line.box[2]) / 2 : 0,
      height: Array.isArray(line.box) && line.box.length >= 4 ? Math.abs(line.box[3] - line.box[1]) : 18
    }))
    .filter((line) => line.text);

  if (!lines.length) {
    return { rows: [], rawText, headerFound: false };
  }

  const medianHeight = lineHeightStats(lines);
  const tolerance = Math.max(8, medianHeight * 0.62);
  const rows = groupLinesIntoRows(lines, tolerance);

  let headerIndex = -1;
  let headerMap = null;
  const scanLimit = Math.min(rows.length, 3);
  for (let i = 0; i < scanLimit; i += 1) {
    const map = detectHeader(rows[i]);
    if (map) {
      headerIndex = i;
      headerMap = map;
      break;
    }
  }

  const parsed = [];
  if (headerMap) {
    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const parsedRow = parseTableRowByHeader(rows[i], headerMap);
      if (parsedRow) parsed.push(parsedRow);
    }
  } else {
    for (const row of rows) {
      const parsedRow = parseTableRowHeuristically(row);
      if (parsedRow) parsed.push(parsedRow);
    }
  }

  // 过滤明显无效的行（例如只有页码、合计等）
  const filtered = parsed.filter((row) => {
    if (!row) return false;
    const hasContent = row.name || row.productionDate || row.shelfLifeMonths || row.quantity !== '';
    if (!hasContent) return false;
    if (/^(合计|总计|小计|备注|说明)$/.test(row.name)) return false;
    return true;
  });

  return {
    rows: filtered.map((row) => ({
      ...row,
      name: row.name || '',
      productionDate: row.productionDate || '',
      shelfLifeMonths: row.shelfLifeMonths === null ? '' : row.shelfLifeMonths,
      quantity: row.quantity === null ? '' : row.quantity,
      remark: row.remark || ''
    })),
    rawText,
    headerFound: Boolean(headerMap)
  };
}

/** 表格行是否可用于导入 */
export function validateTableRow(row) {
  const name = String(row.name || '').trim();
  const rawDate = String(row.productionDate || '').trim();
  const rawMonths = String(row.shelfLifeMonths ?? '').trim();
  const rawQuantity = String(row.quantity ?? '').trim();

  const production = parseDate(rawDate);
  const months = Number(rawMonths);
  const quantity = Number(rawQuantity);

  if (!name) return { valid: false, message: '缺少商品名称' };
  if (!rawDate || !production) return { valid: false, message: '生产日期无效' };
  if (!rawMonths || !Number.isFinite(months) || months <= 0) return { valid: false, message: '保质期无效' };
  if (!rawQuantity || !Number.isFinite(quantity) || quantity < 0) return { valid: false, message: '数量无效' };
  return { valid: true };
}
