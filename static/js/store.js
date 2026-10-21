/* =========================================================
   数据层：LocalStorage 持久化、效期计算、统计
   ========================================================= */
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  parseDate,
  toISODate,
  todayDate,
  todayISO,
  uid
} from './utils.js';

const STORAGE_KEY = 'snack-expiry-manager.v1';
const CORRUPT_KEY = 'snack-expiry-manager.v1.corrupt';

export const STATUSES = ['未下架', '无需下架', '已下架'];

export const DEFAULT_TIERS = [
  { min: 0, max: 3, advanceDays: 0 },
  { min: 4, max: 10, advanceDays: 1 },
  { min: 11, max: 30, advanceDays: 2 },
  { min: 31, max: 60, advanceDays: 5 },
  { min: 61, max: 180, advanceDays: 7 },
  { min: 181, max: 9999, advanceDays: 15 }
];

const listeners = new Set();
let loadWarning = null;
let state = loadState();

/* ========================= 默认结构 ========================= */
function cloneTiers(tiers = DEFAULT_TIERS) {
  return tiers.map((tier) => ({ ...tier }));
}

function defaultSettings() {
  return {
    warningTiers: cloneTiers(),
    lastBackupAt: null,
    reminderDismissedAt: null,
    backupReminder: true
  };
}

function defaultState() {
  return {
    version: 1,
    products: [],
    settings: defaultSettings()
  };
}

/* ========================= 读取 / 保存 ========================= */
function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('无法读取本地存储', error);
    loadWarning = '浏览器拒绝访问本地存储，请检查隐私设置。';
    return defaultState();
  }

  if (!raw) return defaultState();

  try {
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch (error) {
    console.error('本地数据解析失败', error);
    try {
      localStorage.setItem(CORRUPT_KEY, raw);
    } catch {
      /* ignore */
    }
    loadWarning = '本地数据格式异常，已保留原始备份并加载空数据。';
    return defaultState();
  }
}

function sanitizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const settings = normalizeSettings(raw.settings);
  const rawProducts = Array.isArray(raw.products) ? raw.products : [];
  const products = [];
  let nextSeq = 1;
  let maxSeq = 0;

  for (const item of rawProducts) {
    const product = normalizeStoredProduct(item, settings.warningTiers);
    if (!product) continue;
    if (!Number.isFinite(product.seq)) product.seq = 0;
    maxSeq = Math.max(maxSeq, product.seq || 0);
    products.push(product);
  }

  for (const product of products) {
    if (!product.seq) {
      product.seq = maxSeq + nextSeq;
      nextSeq += 1;
    }
  }

  products.sort((a, b) => a.seq - b.seq);

  return {
    version: 1,
    products,
    settings
  };
}

function normalizeSettings(raw) {
  const settings = defaultSettings();
  if (!raw || typeof raw !== 'object') return settings;

  const tiers = Array.isArray(raw.warningTiers) ? raw.warningTiers : [];
  const cleaned = tiers
    .map((tier) => ({
      min: Math.max(0, Math.round(Number(tier?.min))),
      max: Math.max(0, Math.round(Number(tier?.max))),
      advanceDays: Math.max(0, Math.round(Number(tier?.advanceDays)))
    }))
    .filter((tier) => Number.isFinite(tier.min) && Number.isFinite(tier.max) && tier.max >= tier.min)
    .sort((a, b) => a.min - b.min);

  if (cleaned.length) settings.warningTiers = cleaned;

  if (typeof raw.lastBackupAt === 'string' && !Number.isNaN(new Date(raw.lastBackupAt).getTime())) {
    settings.lastBackupAt = raw.lastBackupAt;
  }
  if (typeof raw.reminderDismissedAt === 'string' && !Number.isNaN(new Date(raw.reminderDismissedAt).getTime())) {
    settings.reminderDismissedAt = raw.reminderDismissedAt;
  }
  settings.backupReminder = raw.backupReminder !== false;
  return settings;
}

function normalizeStoredProduct(raw, tiers) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;

  const production = parseDate(raw.productionDate);
  const months = Number(raw.shelfLifeMonths);
  if (!production || !Number.isFinite(months) || months <= 0) return null;

  const derived = computeDerived(toISODate(production), months, tiers);
  if (!derived) return null;

  const status = STATUSES.includes(raw.status) ? raw.status : '未下架';
  const createdAt = isValidDateTime(raw.createdAt)
    ? new Date(raw.createdAt).toISOString()
    : new Date().toISOString();
  const offShelfAt = isValidDateTime(raw.offShelfAt)
    ? new Date(raw.offShelfAt).toISOString()
    : status === '已下架'
      ? createdAt
      : null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    seq: Number.isFinite(Number(raw.seq)) && Number(raw.seq) > 0 ? Math.round(Number(raw.seq)) : 0,
    name,
    productionDate: derived.productionDate,
    shelfLifeMonths: derived.shelfLifeMonths,
    shelfLifeDays: derived.shelfLifeDays,
    expiryDate: derived.expiryDate,
    warningDate: derived.warningDate,
    advanceDays: derived.advanceDays,
    quantity: clampQuantity(raw.quantity),
    status,
    remark: String(raw.remark || '').trim(),
    createdAt,
    updatedAt: isValidDateTime(raw.updatedAt) ? new Date(raw.updatedAt).toISOString() : createdAt,
    offShelfAt
  };
}

function isValidDateTime(value) {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}

/** ISO 时间戳 → 本地日期 YYYY-MM-DD（统计时按本地时区归月/归日） */
function localDateOf(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return toISODate(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
}

function clampQuantity(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(number, 999999);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('保存失败', error);
    throw new Error('数据保存失败：浏览器本地存储空间可能已满');
  }
}

function emit(reason = 'change') {
  listeners.forEach((fn) => {
    try {
      fn(reason);
    } catch (error) {
      console.error('订阅回调执行失败', error);
    }
  });
}

/* ========================= 对外基础接口 ========================= */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSettings() {
  return state.settings;
}

export function getProducts() {
  return state.products;
}

export function getProduct(id) {
  return state.products.find((product) => product.id === id) || null;
}

export function getLoadWarning() {
  return loadWarning;
}

export function consumeLoadWarning() {
  const warning = loadWarning;
  loadWarning = null;
  return warning;
}

/** 跨标签页同步：读取其它标签页写入的最新数据 */
export function reloadFromStorage() {
  const fresh = loadState();
  state = fresh;
  emit('external');
}

/* ========================= 效期计算 ========================= */
export function getTierForDays(days, tiers = state.settings.warningTiers) {
  const list = Array.isArray(tiers) && tiers.length ? tiers : DEFAULT_TIERS;
  const value = Number(days);
  if (!Number.isFinite(value)) return null;

  const matched = list.find((tier) => value >= tier.min && value <= tier.max);
  if (matched) return matched;

  // 不在任何档位时：取最近的下方档位；低于首档取首档
  let fallback = list[0];
  for (const tier of list) {
    if (tier.min <= value) fallback = tier;
  }
  return fallback || null;
}

export function computeDerived(productionDate, shelfLifeMonths, tiers = state.settings.warningTiers) {
  const production = parseDate(productionDate);
  const months = Number(shelfLifeMonths);
  if (!production || !Number.isFinite(months) || months <= 0) return null;

  const expiry = addMonthsClamped(production, months);
  if (!expiry) return null;

  const shelfLifeDays = Math.max(0, daysBetween(production, expiry));
  const tier = getTierForDays(shelfLifeDays, tiers);
  const advanceDays = Math.max(0, Number(tier?.advanceDays) || 0);
  const warning = addDays(expiry, -advanceDays);

  return {
    productionDate: toISODate(production),
    shelfLifeMonths: months,
    shelfLifeDays,
    expiryDate: toISODate(expiry),
    warningDate: toISODate(warning),
    advanceDays,
    matchedTier: tier
  };
}

export function validateTiers(rawTiers) {
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
    return { valid: false, message: '至少需要保留一个档位。' };
  }

  const tiers = rawTiers
    .map((tier) => ({
      min: Number(tier.min),
      max: Number(tier.max),
      advanceDays: Number(tier.advanceDays)
    }))
    .sort((a, b) => a.min - b.min);

  for (const tier of tiers) {
    if (![tier.min, tier.max, tier.advanceDays].every(Number.isFinite)) {
      return { valid: false, message: '档位中的数值不能为空。' };
    }
    if (!Number.isInteger(tier.min) || !Number.isInteger(tier.max) || !Number.isInteger(tier.advanceDays)) {
      return { valid: false, message: '档位中的数值需为整数。' };
    }
    if (tier.min < 0) return { valid: false, message: '保质期天数不能小于 0。' };
    if (tier.max < tier.min) return { valid: false, message: `档位 ${tier.min}~${tier.max} 的上限小于下限。` };
    if (tier.advanceDays < 0) return { valid: false, message: '提前下架天数不能小于 0。' };
  }

  if (tiers[0].min !== 0) {
    return { valid: false, message: '第一个档位的下限必须为 0。' };
  }

  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i].min !== tiers[i - 1].max + 1) {
      return {
        valid: false,
        message: `档位需连续：${tiers[i - 1].max} 与 ${tiers[i].min} 之间的天数没有覆盖。`
      };
    }
  }

  return { valid: true, tiers };
}

/* ========================= 商品增删改 ========================= */
function nextSeq() {
  return state.products.reduce((max, product) => Math.max(max, product.seq || 0), 0) + 1;
}

function buildProduct(input, previous = null) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('请填写商品名称');

  const months = Number(input.shelfLifeMonths);
  if (!Number.isFinite(months) || months <= 0 || months > 240) {
    throw new Error('保质期（月）需在 0–240 之间');
  }

  const derived = computeDerived(input.productionDate, months, state.settings.warningTiers);
  if (!derived) throw new Error('生产日期或保质期无效，请检查');

  const now = new Date().toISOString();
  const status = STATUSES.includes(input.status) ? input.status : '未下架';

  const product = {
    id: previous?.id || uid(),
    seq: previous?.seq || nextSeq(),
    name,
    ...derived,
    quantity: clampQuantity(input.quantity),
    status,
    remark: String(input.remark || '').trim(),
    createdAt: previous?.createdAt
      || (input.createdAt && isValidDateTime(input.createdAt) ? new Date(input.createdAt).toISOString() : now),
    updatedAt: now,
    offShelfAt: previous?.offShelfAt
      || (input.offShelfAt && isValidDateTime(input.offShelfAt) ? new Date(input.offShelfAt).toISOString() : null)
  };

  if (status === '已下架') {
    if (previous) {
      // 编辑时从在售改为已下架，记录本次下架时间；一直保持已下架则沿用原时间
      if (previous.status !== '已下架') product.offShelfAt = now;
    } else if (!product.offShelfAt) {
      // 新增 / 导入：文件里带了下架时间则保留，否则记为当前时间
      product.offShelfAt = now;
    }
  } else if (!product.offShelfAt) {
    product.offShelfAt = null;
  }

  return product;
}

export function addProduct(input) {
  const product = buildProduct(input);
  state.products.push(product);
  persist();
  emit();
  return product;
}

export function updateProduct(id, input) {
  const index = state.products.findIndex((product) => product.id === id);
  if (index < 0) throw new Error('商品不存在或已被删除');
  const product = buildProduct(input, state.products[index]);
  state.products[index] = product;
  persist();
  emit();
  return product;
}

export function deleteProduct(id) {
  const index = state.products.findIndex((product) => product.id === id);
  if (index < 0) return false;
  state.products.splice(index, 1);
  persist();
  emit();
  return true;
}

export function markOffShelf(id) {
  return setStatus(id, '已下架');
}

export function restoreProduct(id) {
  return setStatus(id, '未下架');
}

export function setStatus(id, status) {
  const product = getProduct(id);
  if (!product || !STATUSES.includes(status) || product.status === status) return product;
  const now = new Date().toISOString();
  product.status = status;
  product.updatedAt = now;
  if (status === '已下架') {
    product.offShelfAt = now;
  }
  persist();
  emit();
  return product;
}

/* ========================= 档位设置 ========================= */
export function saveTiers(tiers) {
  const result = validateTiers(tiers);
  if (!result.valid) throw new Error(result.message);

  state.settings.warningTiers = cloneTiers(result.tiers);
  recalculateAllProducts();
  persist();
  emit();
}

export function resetTiers() {
  state.settings.warningTiers = cloneTiers();
  recalculateAllProducts();
  persist();
  emit();
}

function recalculateAllProducts() {
  for (const product of state.products) {
    const derived = computeDerived(product.productionDate, product.shelfLifeMonths, state.settings.warningTiers);
    if (!derived) continue;
    product.shelfLifeDays = derived.shelfLifeDays;
    product.expiryDate = derived.expiryDate;
    product.warningDate = derived.warningDate;
    product.advanceDays = derived.advanceDays;
  }
}

/* ========================= 导入 / 批量 ========================= */
export function importProducts(inputs, { mode = 'merge', tiers = null } = {}) {
  if (!Array.isArray(inputs)) throw new Error('导入数据格式错误');

  if (tiers && Array.isArray(tiers) && tiers.length) {
    const result = validateTiers(tiers);
    if (result.valid) {
      state.settings.warningTiers = cloneTiers(result.tiers);
      recalculateAllProducts();
    }
  }

  if (mode === 'replace') {
    state.products = [];
  }

  let seq = nextSeq();
  let imported = 0;
  const errors = [];

  for (const input of inputs) {
    try {
      const product = buildProduct({ ...input, createdAt: input.createdAt });
      product.seq = seq;
      seq += 1;
      state.products.push(product);
      imported += 1;
    } catch (error) {
      errors.push({ name: input?.name || '未命名', message: error.message });
    }
  }

  persist();
  emit();
  return { imported, errors };
}

/* ========================= 备份 ========================= */
export function markBackupDone() {
  const now = new Date().toISOString();
  state.settings.lastBackupAt = now;
  state.settings.reminderDismissedAt = null;
  persist();
  emit();
}

export function dismissBackupReminder() {
  state.settings.reminderDismissedAt = new Date().toISOString();
  persist();
  emit();
}

export function setBackupReminder(enabled) {
  state.settings.backupReminder = Boolean(enabled);
  persist();
  emit();
}

export function getBackupInfo() {
  const { lastBackupAt, reminderDismissedAt, backupReminder } = state.settings;
  const today = todayISO();
  const daysSinceBackup = lastBackupAt ? daysBetween(localDateOf(lastBackupAt), today) : null;
  const daysSinceDismiss = reminderDismissedAt ? daysBetween(localDateOf(reminderDismissedAt), today) : null;

  const due = Boolean(backupReminder)
    && state.products.length > 0
    && (daysSinceBackup === null || daysSinceBackup >= 7)
    && (daysSinceDismiss === null || daysSinceDismiss >= 7);

  return {
    lastBackupAt,
    daysSinceBackup,
    due
  };
}

/* ========================= 清空 / 示例 ========================= */
export function clearAllData() {
  state.products = [];
  persist();
  emit();
}

export function loadDemoData() {
  const today = todayDate();
  const now = new Date();
  const demo = [];

  const make = (name, daysToExpiry, months, quantity, status, createdDaysAgo, remark = '') => {
    const expiry = addDays(today, daysToExpiry);
    const production = addMonthsClamped(expiry, -months);
    return {
      name,
      productionDate: toISODate(production),
      shelfLifeMonths: months,
      quantity,
      status,
      remark,
      createdAt: new Date(now.getTime() - createdDaysAgo * 86400000).toISOString(),
      offShelfAt: status === '已下架'
        ? new Date(now.getTime() - Math.max(1, Math.round(createdDaysAgo / 3)) * 86400000).toISOString()
        : null
    };
  };

  demo.push(make('奶酪棒（草莓味）', -3, 1, 6, '未下架', 35, '货架第二层'));
  demo.push(make('鲜奶吐司面包', 1, 1, 4, '未下架', 28, ''));
  demo.push(make('黄桃果粒酸奶', 6, 1, 12, '未下架', 20, '冷藏柜'));
  demo.push(make('乐事薯片（黄瓜味）', 14, 6, 10, '未下架', 95, ''));
  demo.push(make('德芙巧克力', 25, 12, 8, '未下架', 120, '进口商品'));
  demo.push(make('麻辣王子辣条', 60, 6, 30, '未下架', 80, '畅销款'));
  demo.push(make('奥利奥饼干', 200, 12, 20, '未下架', 60, ''));
  demo.push(make('益达口香糖', 240, 24, 16, '无需下架', 45, '无需效期管理'));
  demo.push(make('喜之郎果冻', -10, 6, 0, '已下架', 70, '已过期下架'));

  state.products = [];
  let seq = 1;
  for (const input of demo) {
    try {
      const product = buildProduct(input);
      product.seq = seq;
      seq += 1;
      state.products.push(product);
    } catch (error) {
      console.warn('示例数据创建失败', input.name, error);
    }
  }

  persist();
  emit();
  return state.products.length;
}

/* ========================= 查询 / 统计 ========================= */
export function getProductMeta(product) {
  const today = todayISO();
  const remainingDays = daysBetween(today, product.expiryDate);
  const expired = remainingDays !== null && remainingDays < 0;
  const warning = product.status === '未下架' && product.warningDate <= today;

  return {
    remainingDays,
    expired,
    warning,
    remainingLabel: remainingDays === null
      ? '—'
      : remainingDays < 0
        ? `已过期 ${Math.abs(remainingDays)} 天`
        : remainingDays === 0
          ? '今天到期'
          : `剩 ${remainingDays} 天`
  };
}

export function getWarningProducts() {
  const today = todayISO();
  return state.products
    .filter((product) => product.status === '未下架' && product.warningDate <= today)
    .sort((a, b) => {
      if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
      return a.seq - b.seq;
    });
}

export function getStats() {
  const today = todayISO();
  const products = state.products;
  const onSale = products.filter((product) => product.status !== '已下架');
  const needsCheck = products.filter((product) => product.status === '未下架');
  const offShelf = products.filter((product) => product.status === '已下架');
  const warnings = getWarningProducts();

  const distribution = {
    expired: 0,
    within7: 0,
    within15: 0,
    within30: 0,
    safe: 0
  };

  for (const product of needsCheck) {
    const remaining = daysBetween(today, product.expiryDate);
    if (remaining === null) continue;
    if (remaining < 0) distribution.expired += 1;
    else if (remaining <= 7) distribution.within7 += 1;
    else if (remaining <= 15) distribution.within15 += 1;
    else if (remaining <= 30) distribution.within30 += 1;
    else distribution.safe += 1;
  }

  const activeQuantity = onSale.reduce((sum, product) => sum + (Number(product.quantity) || 0), 0);
  const offShelfQuantity = offShelf.reduce((sum, product) => sum + (Number(product.quantity) || 0), 0);

  const now = new Date();
  const monthStart = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const offThisMonth = products.filter((product) => {
    if (!product.offShelfAt) return false;
    const day = localDateOf(product.offShelfAt);
    return Boolean(day) && day >= monthStart && day <= today;
  }).length;

  return {
    totalKinds: products.length,
    onSaleKinds: onSale.length,
    onSaleQuantity: activeQuantity,
    warningKinds: warnings.length,
    expiredKinds: distribution.expired,
    offShelfKinds: offShelf.length,
    offShelfQuantity,
    offThisMonth,
    distribution,
    statusDistribution: [
      { label: '未下架', value: needsCheck.length, color: '#f97316' },
      { label: '无需下架', value: onSale.length - needsCheck.length, color: '#0d9488' },
      { label: '已下架', value: offShelf.length, color: '#9a9187' }
    ],
    trend: getTrend(products, 6)
  };
}

function getTrend(products, monthCount = 6) {
  const now = new Date();
  const months = [];

  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      key,
      label: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`,
      added: 0,
      offShelf: 0
    });
  }

  const index = new Map(months.map((month) => [month.key, month]));
  for (const product of products) {
    const createdKey = localDateOf(product.createdAt)?.slice(0, 7);
    if (createdKey && index.has(createdKey)) index.get(createdKey).added += 1;

    const offShelfKey = localDateOf(product.offShelfAt)?.slice(0, 7);
    if (offShelfKey && index.has(offShelfKey)) index.get(offShelfKey).offShelf += 1;
  }

  return months;
}

export function getExportSnapshot() {
  return {
    products: state.products.map((product) => ({ ...product })),
    settings: {
      ...state.settings,
      warningTiers: cloneTiers(state.settings.warningTiers)
    }
  };
}
