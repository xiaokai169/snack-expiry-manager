/* =========================================================
   Excel 导入 / 导出（使用本地 SheetJS）
   ========================================================= */
import {
  addMonthsClamped,
  daysBetween,
  fmtDate,
  formatDateTime,
  normalizeOcrText,
  nowStamp,
  parseDate,
  toISODate
} from './utils.js';
import { getExportSnapshot, STATUSES } from './store.js';

const SHEET_PRODUCTS = '商品数据';
const SHEET_TIERS = '档位设置';
const SHEET_INFO = '备份说明';

export const EXPORT_HEADERS = [
  '序号',
  '商品名称',
  '生产日期',
  '保质期（月）',
  '保质期（天）',
  '到期日',
  '临期下架日',
  '数量',
  '是否下架',
  '备注',
  '录入时间',
  '下架时间'
];

function requireXLSX() {
  if (!window.XLSX) {
    throw new Error('Excel 组件未加载，请刷新页面后重试');
  }
  return window.XLSX;
}

/* ========================= 导出 ========================= */
export function exportToExcel({ silent = false } = {}) {
  const XLSX = requireXLSX();
  const { products, settings } = getExportSnapshot();

  if (!products.length) {
    throw new Error('暂无商品数据，无需导出');
  }

  const rows = products.map((product, index) => [
    index + 1,
    product.name,
    fmtDate(product.productionDate),
    product.shelfLifeMonths,
    product.shelfLifeDays,
    fmtDate(product.expiryDate),
    fmtDate(product.warningDate),
    product.quantity,
    product.status,
    product.remark || '',
    formatDateTime(product.createdAt),
    product.offShelfAt ? formatDateTime(product.offShelfAt) : ''
  ]);

  const productSheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows]);
  productSheet['!cols'] = [
    { wch: 6 }, { wch: 26 }, { wch: 12 }, { wch: 11 }, { wch: 11 },
    { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 24 },
    { wch: 18 }, { wch: 18 }
  ];

  const tierRows = settings.warningTiers.map((tier) => [tier.min, tier.max, tier.advanceDays]);
  const tierSheet = XLSX.utils.aoa_to_sheet([
    ['保质期（天）下限', '保质期（天）上限（含）', '提前下架天数'],
    ...tierRows
  ]);
  tierSheet['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 16 }];

  const infoSheet = XLSX.utils.aoa_to_sheet([
    ['零食效期管家 · 数据备份'],
    ['导出时间', formatDateTime(new Date().toISOString())],
    ['商品数量', products.length],
    [''],
    ['说明'],
    ['1. 本文件由零食效期管家导出，可用于备份或重新导入。'],
    ['2. 「商品数据」页为商品明细；「档位设置」页为临期预警档位。'],
    ['3. 重新导入时请勿修改表头名称，日期建议保持 YYYY/MM/DD 格式。'],
    ['4. 所有原始数据只保存在本机浏览器中，请定期导出备份。']
  ]);
  infoSheet['!cols'] = [{ wch: 18 }, { wch: 70 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, productSheet, SHEET_PRODUCTS);
  XLSX.utils.book_append_sheet(workbook, tierSheet, SHEET_TIERS);
  XLSX.utils.book_append_sheet(workbook, infoSheet, SHEET_INFO);

  const filename = `零食效期数据_${nowStamp()}.xlsx`;
  XLSX.writeFile(workbook, filename);
  if (!silent) return filename;
  return filename;
}

/** 下载一份空白导入模板 */
export function downloadTemplate() {
  const XLSX = requireXLSX();
  const sample = [
    ['', '示例：乐事薯片', '2026/08/21', 6, 184, '2027/02/21', '2027/02/06', 10, '未下架', '模板示例，可删除', '', ''],
    ['', '示例：麻辣王子辣条', '2026/09/01', 6, 181, '2027/03/01', '2027/02/14', 20, '未下架', '', '', '']
  ];
  const sheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...sample]);
  sheet['!cols'] = [
    { wch: 6 }, { wch: 26 }, { wch: 12 }, { wch: 11 }, { wch: 11 },
    { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 24 },
    { wch: 18 }, { wch: 18 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_PRODUCTS);

  const tierSheet = XLSX.utils.aoa_to_sheet([
    ['保质期（天）下限', '保质期（天）上限（含）', '提前下架天数'],
    [0, 3, 0],
    [4, 10, 1],
    [11, 30, 2],
    [31, 60, 5],
    [61, 180, 7],
    [181, 9999, 15]
  ]);
  XLSX.utils.book_append_sheet(workbook, tierSheet, SHEET_TIERS);

  XLSX.writeFile(workbook, '零食效期导入模板.xlsx');
}

/* ========================= 导入 ========================= */
const HEADER_ALIASES = {
  name: ['商品名称', '商品名', '名称', '品名', '货品名称'],
  productionDate: ['生产日期', '生产日', '制造日期', '灌装日期'],
  shelfLifeMonths: ['保质期（月）', '保质期(月)', '保质期月', '保质期'],
  shelfLifeDays: ['保质期（天）', '保质期(天)', '保质期天'],
  expiryDate: ['到期日', '到期日期', '失效日期'],
  warningDate: ['临期下架日', '下架预警日', '预警日'],
  quantity: ['数量', '库存', '库存数量'],
  status: ['是否下架', '状态', '下架状态'],
  remark: ['备注', '说明'],
  createdAt: ['录入时间', '创建时间', '入库时间'],
  offShelfAt: ['下架时间']
};

function normalizeHeaderCell(value) {
  return normalizeOcrText(String(value ?? ''))
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .trim();
}

function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeaderCell(cell);
    if (!normalized) return;

    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
        // 「保质期（天）」优先匹配天数列，避免被「保质期」误匹配
        if (field === 'shelfLifeMonths' && /天/.test(normalized)) continue;
        map[field] = index;
        break;
      }
    }
  });
  return map;
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const headers = row.map(normalizeHeaderCell);
    const hasName = headers.some((text) => HEADER_ALIASES.name.some((alias) => text.includes(alias)));
    if (!hasName) continue;
    const map = buildHeaderMap(row);
    if (map.name !== undefined && (map.productionDate !== undefined || map.shelfLifeMonths !== undefined || map.shelfLifeDays !== undefined)) {
      return { index: i, map };
    }
  }
  return null;
}

export async function parseExcelFile(file) {
  const XLSX = requireXLSX();
  if (!file) throw new Error('请选择 Excel 文件');

  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch (error) {
    throw new Error('无法读取该文件，请确认是有效的 Excel 文件');
  }

  const sheetNames = workbook.SheetNames || [];
  let found = null;

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false
    });
    const header = findHeaderRow(rows);
    if (header) {
      found = { sheetName, rows, header };
      break;
    }
  }

  if (!found) {
    throw new Error('未找到可识别的表头，请确认表格中包含「商品名称」「生产日期」「保质期（月）」等列');
  }

  const { sheetName, rows, header } = found;
  const errors = [];
  const parsedRows = [];
  const now = new Date().toISOString();

  for (let i = header.index + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (!Array.isArray(row)) continue;
    const get = (field) => (header.map[field] !== undefined ? row[header.map[field]] : '');

    const name = String(get('name') ?? '').trim();
    const rawProduction = get('productionDate');
    const rawMonths = get('shelfLifeMonths');
    const rawDays = get('shelfLifeDays');
    const rawExpiry = get('expiryDate');
    const rawQuantity = get('quantity');
    const rawStatus = get('status');
    const rawRemark = get('remark');
    const rawCreatedAt = get('createdAt');
    const rawOffShelfAt = get('offShelfAt');

    const isEmpty = [name, rawProduction, rawMonths, rawDays, rawExpiry, rawQuantity, rawRemark]
      .every((value) => String(value ?? '').trim() === '');
    if (isEmpty) continue;

    if (!name) {
      errors.push({ row: i + 1, message: '缺少商品名称' });
      continue;
    }

    let months = parseMonths(rawMonths);
    if (months === null) {
      const days = parseFloatSafe(rawDays);
      if (days !== null && days > 0) months = daysToMonths(days);
    }

    let production = parseDateValue(rawProduction);
    let expiry = parseDateValue(rawExpiry);

    if (!production && expiry && months) {
      production = addMonthsClamped(expiry, -months);
    }
    if (!production) {
      errors.push({ row: i + 1, message: '生产日期无效或缺失' });
      continue;
    }

    if (!months && expiry) {
      const days = daysBetween(production, expiry);
      if (days && days > 0) months = daysToMonths(days);
    }
    if (!months || months <= 0) {
      errors.push({ row: i + 1, message: '保质期无效或缺失' });
      continue;
    }

    if (!expiry) {
      expiry = addMonthsClamped(production, months);
    }

    const quantity = Math.max(0, Math.floor(parseFloatSafe(rawQuantity) ?? 0));
    const status = normalizeStatus(rawStatus);
    const createdAt = parseDateTimeValue(rawCreatedAt) || now;
    let offShelfAt = parseDateTimeValue(rawOffShelfAt);
    if (!offShelfAt && status === '已下架') offShelfAt = createdAt;

    parsedRows.push({
      name,
      productionDate: toISODate(production),
      shelfLifeMonths: months,
      quantity,
      status,
      remark: String(rawRemark ?? '').trim(),
      createdAt,
      offShelfAt
    });
  }

  const tiers = parseTiersSheet(workbook, XLSX);

  if (!parsedRows.length) {
    const detail = errors.length ? `（${errors[0].message}）` : '';
    throw new Error(`没有可导入的有效数据${detail}`);
  }

  return {
    sheetName,
    rows: parsedRows,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
    tiers,
    totalRows: rows.length - header.index - 1
  };
}

function parseMonths(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return null;

  const text = normalizeOcrText(String(value)).trim();
  if (!text) return null;

  const monthMatch = text.match(/(\d+(?:\.\d+)?)\s*(个月|月)/);
  if (monthMatch) return clampMonths(Number(monthMatch[1]));

  const dayMatch = text.match(/(\d+)\s*(天|日)/);
  if (dayMatch) return daysToMonths(Number(dayMatch[1]));

  const number = Number(text.replace(/[^\d.]/g, ''));
  if (Number.isFinite(number) && number > 0) return clampMonths(number);
  return null;
}

function clampMonths(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(240, Math.round(value * 2) / 2);
}

function daysToMonths(days) {
  return Math.max(0.5, Math.min(240, Math.round((Number(days) / 30.4375) * 2) / 2));
}

function parseFloatSafe(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = normalizeOcrText(String(value)).replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  return parseDate(value);
}

function parseDateTimeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    const date = parseDate(value);
    return date
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0).toISOString()
      : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/\d{1,2}:\d{1,2}/.test(text)) {
    const withTime = new Date(text.replace(/\//g, '-'));
    if (!Number.isNaN(withTime.getTime())) return withTime.toISOString();
  }

  const dateOnly = parseDate(text);
  if (dateOnly) {
    return new Date(dateOnly.getFullYear(), dateOnly.getMonth(), dateOnly.getDate(), 9, 0).toISOString();
  }
  return null;
}

function normalizeStatus(value) {
  const text = String(value ?? '').trim();
  if (STATUSES.includes(text)) return text;
  if (/已下架|下架/.test(text)) return '已下架';
  if (/无需|不需要/.test(text)) return '无需下架';
  if (/^(是|yes|y|true)$/i.test(text)) return '已下架';
  if (/^(否|no|n|false)$/i.test(text)) return '未下架';
  return '未下架';
}

function parseTiersSheet(workbook, XLSX) {
  const sheetName = (workbook.SheetNames || []).find((name) => name === SHEET_TIERS)
    || (workbook.SheetNames || []).find((name) => /档位|预警设置/.test(name));
  if (!sheetName) return null;

  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return null;

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
  let headerIndex = -1;
  let minIndex = -1;
  let maxIndex = -1;
  let advanceIndex = -1;

  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const row = (rows[i] || []).map(normalizeHeaderCell);
    const min = row.findIndex((text) => /下限/.test(text));
    const max = row.findIndex((text) => /上限/.test(text));
    const advance = row.findIndex((text) => /提前|下架天数/.test(text));
    if (min >= 0 && max >= 0 && advance >= 0) {
      headerIndex = i;
      minIndex = min;
      maxIndex = max;
      advanceIndex = advance;
      break;
    }
  }

  if (headerIndex < 0) return null;

  const tiers = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const min = parseFloatSafe(row[minIndex]);
    const max = parseFloatSafe(row[maxIndex]);
    const advance = parseFloatSafe(row[advanceIndex]);
    if (min === null || max === null || advance === null) continue;
    tiers.push({
      min: Math.round(min),
      max: Math.round(max),
      advanceDays: Math.round(advance)
    });
    if (tiers.length >= 30) break;
  }

  return tiers.length ? tiers : null;
}
