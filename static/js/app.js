/* =========================================================
   零食效期管家 · 应用入口与交互
   ========================================================= */
import {
  $,
  $$,
  escapeHtml,
  fmtDate,
  formatNumber,
  parseDate,
  readFileAsDataURL,
  rotateImageFile
} from './utils.js';
import * as store from './store.js';
import { closeModal, confirmAction, openModal, toast } from './ui.js';
import {
  renderHome,
  renderOffShelf,
  renderOnSale,
  renderSettings,
  renderStats,
  renderTierRow
} from './views.js';
import {
  API_BASE,
  checkHealth,
  parsePackageResult,
  parseTableResult,
  recognizeImage,
  validateTableRow
} from './ocr.js';
import { downloadTemplate, exportToExcel, parseExcelFile } from './excel.js';

/* ========================= 应用状态 ========================= */
const TABS = new Set(['home', 'onsale', 'offshelf', 'stats', 'settings']);

const state = {
  tab: getTabFromHash(),
  saleFilters: {
    search: '',
    status: 'all',
    warningOnly: false,
    sort: 'expiry'
  },
  offFilters: {
    search: ''
  },
  ocrStatus: {
    state: 'checking',
    version: '',
    message: '',
    endpoint: API_BASE || window.location.origin
  },
  mobileAccess: {
    loading: true,
    mobileUrl: '',
    lanIp: null,
    lanEnabled: true
  },
  packageImage: null,
  tableImage: null,
  tableRows: [],
  tableMeta: null,
  importData: null,
  camera: {
    stream: null,
    target: 'ocr'
  }
};

/* ========================= 初始化 ========================= */
function init() {
  bindStaticEvents();
  bindStore();

  render();
  refreshOcrStatus();
  refreshNetworkInfo();

  const warning = store.consumeLoadWarning();
  if (warning) toast(warning, 'error', 6000);
}

function bindStore() {
  store.subscribe(() => {
    updateWarningBadge();
    render();
  });

  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith('snack-expiry-manager')) {
      store.reloadFromStorage();
      toast('检测到其他标签页的数据更新，已同步', 'info');
    }
  });
}

/* ========================= 路由与渲染 ========================= */
function getTabFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  return TABS.has(hash) ? hash : 'home';
}

function navigate(tab, { filterWarning = null } = {}) {
  if (!TABS.has(tab)) return;

  if (tab === 'onsale' && filterWarning !== null) {
    state.saleFilters.warningOnly = filterWarning;
    if (filterWarning) {
      state.saleFilters.status = 'all';
      state.saleFilters.search = '';
    }
  }

  state.tab = tab;

  if (window.location.hash !== `#${tab}`) {
    window.location.hash = tab;
  } else {
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function render() {
  state.tab = getTabFromHash();
  const app = $('#app');
  if (!app) return;

  switch (state.tab) {
    case 'onsale':
      renderOnSale(app, state.saleFilters);
      break;
    case 'offshelf':
      renderOffShelf(app, state.offFilters);
      break;
    case 'stats':
      renderStats(app);
      break;
    case 'settings':
      renderSettings(app, state.ocrStatus, state.mobileAccess);
      break;
    case 'home':
    default:
      renderHome(app);
      break;
  }

  syncNav();
  updateWarningBadge();
  // 重新渲染后恢复设置页的服务状态 DOM（view 已根据 state 渲染，这里无需额外操作）
}

function syncNav() {
  $$('.main-nav a').forEach((link) => {
    link.classList.toggle('active', link.dataset.tab === state.tab);
  });
}

function updateWarningBadge() {
  const badge = $('#navWarningBadge');
  if (!badge) return;
  const count = store.getWarningProducts().length;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}

/* ========================= OCR 服务状态 ========================= */
async function refreshOcrStatus(showFeedback = false) {
  state.ocrStatus = {
    state: 'checking',
    version: '',
    message: '',
    endpoint: API_BASE || window.location.origin
  };
  updateOcrStatusUi();

  const result = await checkHealth();

  if (result.ok) {
    state.ocrStatus = {
      state: 'ok',
      version: result.data?.paddleocr_version || '',
      message: '',
      endpoint: API_BASE || window.location.origin
    };
    if (showFeedback) toast('识别服务连接正常，可以拍照识别', 'success');
  } else {
    state.ocrStatus = {
      state: 'bad',
      version: '',
      message: result.error || '服务未启动',
      endpoint: API_BASE || window.location.origin
    };
    if (showFeedback) {
      toast(`识别服务未连接：${state.ocrStatus.message}。请运行 start.bat 后重试。`, 'error', 5200);
    }
  }

  updateOcrStatusUi();
}

function updateOcrStatusUi() {
  const header = $('#ocrStatus');
  if (header) {
    header.classList.remove('ok', 'bad', 'checking');
    header.classList.add(state.ocrStatus.state);
    const text = header.querySelector('.status-text');
    if (text) {
      text.textContent = state.ocrStatus.state === 'ok'
        ? '识别服务已连接'
        : state.ocrStatus.state === 'bad'
          ? '识别服务未连接'
          : '识别服务检测中';
    }
    header.title = state.ocrStatus.state === 'ok'
      ? `PaddleOCR ${state.ocrStatus.version || ''}`.trim()
      : state.ocrStatus.state === 'bad'
        ? state.ocrStatus.message
        : '正在检测识别服务';
  }

  const box = $('#serviceStatusBox');
  if (box) {
    box.classList.remove('ok', 'bad');
    if (state.ocrStatus.state === 'ok') box.classList.add('ok');
    if (state.ocrStatus.state === 'bad') box.classList.add('bad');
    const message = state.ocrStatus.state === 'ok'
      ? `识别服务已连接${state.ocrStatus.version ? ` · PaddleOCR ${state.ocrStatus.version}` : ''}`
      : state.ocrStatus.state === 'bad'
        ? `识别服务未连接${state.ocrStatus.message ? ` · ${state.ocrStatus.message}` : ''}`
        : '正在检测识别服务…';
    box.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(message)}</span>`;
  }

  const endpoint = $('#ocrEndpoint');
  if (endpoint) endpoint.textContent = state.ocrStatus.endpoint;
}

/* ========================= 移动端访问地址 ========================= */
async function refreshNetworkInfo() {
  try {
    const response = await fetch(`${API_BASE}/api/network`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.mobileAccess = {
      loading: false,
      mobileUrl: data.mobile_url || '',
      lanIp: data.lan_ip || null,
      lanEnabled: data.lan_enabled !== false
    };
  } catch (error) {
    state.mobileAccess = { loading: false, mobileUrl: '', lanIp: null, lanEnabled: true };
  }
  updateMobileAccessUi();
}

function updateMobileAccessUi() {
  const mobileUrl = state.mobileAccess.mobileUrl;
  const lanEnabled = state.mobileAccess.lanEnabled !== false;
  const urlEl = $('#mobileAccessUrl');
  const hintEl = $('#mobileAccessHint');
  const copyBtn = $('[data-action="copy-mobile-url"]');

  if (urlEl) {
    urlEl.textContent = !lanEnabled
      ? '当前仅本机可访问'
      : mobileUrl || (state.mobileAccess.loading ? '正在获取局域网地址…' : '请使用 http://电脑IP:8765/mobile');
  }
  if (hintEl) {
    hintEl.textContent = !lanEnabled
      ? '当前服务仅监听本机（127.0.0.1），手机无法访问。请用 start.bat 默认方式启动，或加上 --host 0.0.0.0。'
      : mobileUrl
        ? '手机与电脑需连接同一个 Wi-Fi。首次访问若打不开，请在 Windows 防火墙中允许 Python。移动端数据保存在手机浏览器，可通过 Excel 导入导出与电脑互传。'
        : state.mobileAccess.loading
          ? '正在获取本机局域网地址…'
          : '未能自动获取局域网地址，请手动使用 http://电脑IP:8765/mobile 访问（启动服务的命令行窗口会显示地址）。';
  }
  if (copyBtn) {
    copyBtn.disabled = !mobileUrl || !lanEnabled;
    copyBtn.dataset.url = lanEnabled ? (mobileUrl || '') : '';
  }
}

async function copyText(text) {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    toast('手机访问地址已复制', 'success');
  } catch (error) {
    toast('复制失败，请手动选择地址复制', 'warn');
  }
}

/* ========================= 商品表单 ========================= */
function openProductForm(product = null, prefill = null) {
  const form = $('#productForm');
  form.reset();
  clearFieldErrors();

  $('#fId').value = product?.id || '';
  $('#productModalTitle').textContent = product ? '编辑商品' : prefill ? '核对识别结果' : '新增商品';
  $('#productModalSub').textContent = product
    ? '修改生产日期或保质期后，到期日与临期下架日会自动重新计算'
    : prefill
      ? '识别结果已自动填入，请核对无误后保存'
      : '填写基础信息，效期会自动计算';

  $('#fName').value = product?.name || prefill?.name || '';
  $('#fProductionDate').value = product?.productionDate || prefill?.productionDate || '';
  $('#fMonths').value = product?.shelfLifeMonths ?? prefill?.shelfLifeMonths ?? '';
  $('#fQuantity').value = product?.quantity ?? (prefill?.quantity !== '' && prefill?.quantity !== null && prefill?.quantity !== undefined ? prefill.quantity : '');
  $('#fStatus').value = product?.status || '未下架';
  $('#fRemark').value = product?.remark || '';

  const note = $('#productFormNote');
  const rawBox = $('#rawOcrBox');
  const rawText = $('#rawOcrText');

  if (prefill) {
    const notes = Array.isArray(prefill.notes) ? prefill.notes.filter(Boolean) : [];
    note.hidden = false;
    note.className = notes.length ? 'inline-note warn' : 'inline-note';
    note.textContent = notes.length
      ? `识别提示：${notes.join('；')}。请核对后保存。`
      : '已根据照片自动填入识别结果，请核对生产日期与保质期后保存。';
  } else {
    note.hidden = true;
    note.textContent = '';
    note.className = 'inline-note';
  }

  if (prefill?.rawText) {
    rawBox.hidden = false;
    rawBox.open = false;
    rawText.textContent = prefill.rawText;
  } else {
    rawBox.hidden = true;
    rawText.textContent = '';
  }

  updateCalcPreview();
  openModal('productModal');

  window.requestAnimationFrame(() => {
    if (!$('#fName').value) $('#fName').focus();
    else if (!$('#fProductionDate').value) $('#fProductionDate').focus();
    else if (!$('#fMonths').value) $('#fMonths').focus();
    else if (!$('#fQuantity').value) $('#fQuantity').focus();
  });
}

function updateCalcPreview() {
  const production = $('#fProductionDate')?.value || '';
  const months = $('#fMonths')?.value || '';
  const derived = store.computeDerived(production, months);
  const values = {
    days: derived ? `${formatNumber(derived.shelfLifeDays)} 天` : '—',
    expiry: derived ? fmtDate(derived.expiryDate) : '—',
    warning: derived ? fmtDate(derived.warningDate) : '—',
    advance: derived ? (derived.advanceDays > 0 ? `提前 ${derived.advanceDays} 天` : '不提前') : '—'
  };

  $$('#calcPreview [data-calc]').forEach((node) => {
    const key = node.dataset.calc;
    node.textContent = values[key] || '—';
    node.classList.toggle('empty', !derived);
  });
}

function clearFieldErrors() {
  $$('#productForm .field.has-error').forEach((field) => {
    field.classList.remove('has-error');
    field.querySelector('.field-error')?.remove();
  });
}

function markFieldError(input, message, focus = false) {
  const field = input.closest('.field');
  if (!field) return;
  field.classList.add('has-error');
  let error = field.querySelector('.field-error');
  if (!error) {
    error = document.createElement('span');
    error.className = 'field-error';
    field.appendChild(error);
  }
  error.textContent = message;
  if (focus) input.focus();
}

function handleProductSubmit(event) {
  event.preventDefault();
  clearFieldErrors();

  const nameInput = $('#fName');
  const dateInput = $('#fProductionDate');
  const monthInput = $('#fMonths');
  const quantityInput = $('#fQuantity');

  const name = nameInput.value.trim();
  const productionDate = dateInput.value;
  const monthsValue = monthInput.value.trim();
  const quantityValue = quantityInput.value.trim();
  const months = Number(monthsValue);
  const quantity = Number(quantityValue);

  let firstInvalid = null;
  if (!name) {
    markFieldError(nameInput, '请填写商品名称');
    firstInvalid ||= nameInput;
  }
  if (!productionDate || !parseDate(productionDate)) {
    markFieldError(dateInput, '请选择有效的生产日期');
    firstInvalid ||= dateInput;
  }
  if (!monthsValue || !Number.isFinite(months) || months <= 0 || months > 240) {
    markFieldError(monthInput, '请填写 0–240 之间的保质期月数');
    firstInvalid ||= monthInput;
  }
  if (!quantityValue || !Number.isFinite(quantity) || quantity < 0 || quantity > 999999 || !Number.isInteger(quantity)) {
    markFieldError(quantityInput, '请填写 0–999999 之间的整数数量');
    firstInvalid ||= quantityInput;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  const id = $('#fId').value;
  const input = {
    name,
    productionDate,
    shelfLifeMonths: months,
    quantity,
    status: $('#fStatus').value,
    remark: $('#fRemark').value.trim()
  };

  try {
    if (id) {
      store.updateProduct(id, input);
      toast('商品已更新', 'success');
    } else {
      store.addProduct(input);
      toast('商品已保存，效期已自动计算', 'success');
    }
    closeModal('productModal');
  } catch (error) {
    toast(error.message || '保存失败', 'error');
  }
}

/* ========================= 商品操作 ========================= */
async function handleDelete(id) {
  const product = store.getProduct(id);
  if (!product) return;

  const ok = await confirmAction({
    title: '删除商品',
    message: `确定删除 <strong>${escapeHtml(product.name)}</strong> 吗？<br>删除后无法恢复，建议先导出备份。`,
    okText: '删除',
    danger: true
  });
  if (!ok) return;

  try {
    store.deleteProduct(id);
    toast('商品已删除', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function handleOffShelf(id) {
  const product = store.getProduct(id);
  if (!product) return;
  try {
    store.markOffShelf(id);
    toast(`「${product.name}」已移入已下架区域`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function handleRestore(id) {
  const product = store.getProduct(id);
  if (!product) return;
  try {
    store.restoreProduct(id);
    toast(`「${product.name}」已恢复在售`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function handleLoadDemo() {
  const count = store.getProducts().length;
  if (count > 0) {
    const ok = await confirmAction({
      title: '载入示例数据',
      message: `当前已有 <strong>${count}</strong> 条商品数据。载入示例会用 9 条示例商品替换现有数据，是否继续？`,
      okText: '载入示例',
      danger: true
    });
    if (!ok) return;
  }

  const loaded = store.loadDemoData();
  toast(`已载入 ${loaded} 条示例数据`, 'success');
  navigate('home');
}

async function handleClearData() {
  const count = store.getProducts().length;
  if (!count) {
    toast('当前没有商品数据', 'info');
    return;
  }

  const ok = await confirmAction({
    title: '清空全部数据',
    message: `确定删除全部 <strong>${count}</strong> 条商品数据吗？<br>此操作无法撤销，建议先导出 Excel 备份。`,
    okText: '清空数据',
    danger: true
  });
  if (!ok) return;

  try {
    store.clearAllData();
    toast('已清空全部商品数据', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ========================= Excel 导入导出 ========================= */
function handleExport() {
  try {
    const filename = exportToExcel();
    store.markBackupDone();
    toast(`已导出备份：${filename}`, 'success', 4200);
  } catch (error) {
    toast(error.message || '导出失败', 'error');
  }
}

function handleDownloadTemplate() {
  try {
    downloadTemplate();
    toast('导入模板已下载', 'success');
  } catch (error) {
    toast(error.message || '模板下载失败', 'error');
  }
}

function openImportModal() {
  state.importData = null;
  $('#importFile').value = '';
  $('#importPreview').hidden = true;
  $('#importConfirmBtn').hidden = true;
  $('#importConfirmBtn').disabled = true;
  $('#importError').hidden = true;
  const merge = document.querySelector('input[name="importMode"][value="merge"]');
  if (merge) merge.checked = true;
  openModal('importModal');
}

async function handleImportFile(file) {
  if (!file) return;

  const errorBox = $('#importError');
  errorBox.hidden = true;
  $('#importPreview').hidden = true;
  $('#importConfirmBtn').hidden = true;
  $('#importConfirmBtn').disabled = true;

  try {
    const result = await parseExcelFile(file);
    state.importData = result;
    renderImportPreview(result);
    $('#importPreview').hidden = false;
    $('#importConfirmBtn').hidden = false;
    $('#importConfirmBtn').disabled = false;
    $('#importConfirmBtn').textContent = `确认导入 ${result.rows.length} 条`;
    toast(`已读取 ${result.rows.length} 条商品数据`, 'success');
  } catch (error) {
    state.importData = null;
    errorBox.textContent = error.message || '文件解析失败';
    errorBox.hidden = false;
    toast(error.message || '文件解析失败', 'error', 5000);
  }
}

function renderImportPreview(result) {
  const summary = $('#importSummary');
  const skipped = result.errorCount || 0;
  summary.innerHTML = `文件工作表「${escapeHtml(result.sheetName)}」：识别到 <b>${result.rows.length}</b> 条可导入数据${skipped ? `，跳过 <b>${skipped}</b> 行` : ''}。`;

  const tbody = $('#importPreviewBody');
  tbody.innerHTML = result.rows.slice(0, 8).map((row) => `
    <tr>
      <td class="cell-name"><strong>${escapeHtml(row.name)}</strong></td>
      <td>${fmtDate(row.productionDate)}</td>
      <td>${formatNumber(row.shelfLifeMonths)}</td>
      <td>${formatNumber(row.quantity)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td class="cell-muted">${escapeHtml(row.remark || '—')}</td>
    </tr>
  `).join('');

  const warnings = $('#importWarnings');
  if (skipped && result.errors?.length) {
    const lines = result.errors.slice(0, 6).map((error) => `第 ${error.row} 行：${error.message}`);
    warnings.innerHTML = `以下行未能导入：<br>${lines.map(escapeHtml).join('<br>')}${skipped > lines.length ? '<br>…' : ''}`;
    warnings.hidden = false;
  } else {
    warnings.hidden = true;
  }

  const tiersRow = $('#importTiersRow');
  if (result.tiers && result.tiers.length) {
    tiersRow.hidden = false;
    $('#importTiers').checked = true;
  } else {
    tiersRow.hidden = true;
    $('#importTiers').checked = false;
  }
}

async function confirmImport() {
  const data = state.importData;
  if (!data) return;

  const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';

  if (mode === 'replace') {
    const existing = store.getProducts().length;
    if (existing > 0) {
      const ok = await confirmAction({
        title: '覆盖导入',
        message: `覆盖导入会先删除现有的 <strong>${existing}</strong> 条商品，再导入表格数据。是否继续？`,
        okText: '继续覆盖',
        danger: true
      });
      if (!ok) return;
    }
  }

  const tiersRow = $('#importTiersRow');
  const includeTiers = !tiersRow.hidden && $('#importTiers').checked;

  let tiers = null;
  if (includeTiers && data.tiers) {
    const checked = store.validateTiers(data.tiers);
    if (checked.valid) {
      tiers = checked.tiers;
    } else {
      toast(`文件中的档位设置无效，已跳过：${checked.message}`, 'warn', 4800);
    }
  }

  try {
    const result = store.importProducts(data.rows, { mode, tiers });
    closeModal('importModal');
    toast(`成功导入 ${result.imported} 条商品`, 'success', 4200);
    if (result.errors.length) {
      toast(`${result.errors.length} 条商品导入失败`, 'warn');
    }
    state.importData = null;
    navigate('onsale');
  } catch (error) {
    const errorBox = $('#importError');
    errorBox.textContent = error.message || '导入失败';
    errorBox.hidden = false;
    toast(error.message || '导入失败', 'error');
  }
}

/* ========================= 包装拍照识别 ========================= */
function openPackageModal() {
  clearPackageImage();
  $('#ocrError').hidden = true;
  $('#ocrProgress').hidden = true;
  openModal('ocrModal');
}

async function setPackageImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件（JPG / PNG）', 'warn');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('图片不能超过 10MB，请压缩后再试', 'warn');
    return;
  }

  try {
    const dataUrl = await readFileAsDataURL(file);
    state.packageImage = file;
    const picker = $('#ocrPicker');
    const image = $('#ocrPreview');
    image.src = dataUrl;
    picker.querySelector('.image-empty').hidden = true;
    picker.querySelector('.image-preview').hidden = false;
    $('#ocrFile').value = '';
    $('#ocrRecognizeBtn').disabled = false;
    $('#ocrError').hidden = true;
  } catch (error) {
    toast('图片读取失败，请换一张图片', 'error');
  }
}

function clearPackageImage() {
  state.packageImage = null;
  const picker = $('#ocrPicker');
  if (!picker) return;
  const image = $('#ocrPreview');
  if (image) image.removeAttribute('src');
  picker.querySelector('.image-empty').hidden = false;
  picker.querySelector('.image-preview').hidden = true;
  const fileInput = $('#ocrFile');
  if (fileInput) fileInput.value = '';
  const button = $('#ocrRecognizeBtn');
  if (button) button.disabled = true;
  $('#ocrProgress').hidden = true;
  $('#ocrError').hidden = true;
}

async function recognizePackage() {
  if (!state.packageImage) {
    toast('请先选择或拍摄一张包装照片', 'warn');
    return;
  }

  const button = $('#ocrRecognizeBtn');
  button.disabled = true;
  $('#ocrError').hidden = true;
  $('#ocrProgress').hidden = false;
  $('#ocrProgressBar').classList.add('indeterminate');
  $('#ocrProgressText').textContent = '正在本机识别文字，首次识别可能需要几秒…';

  try {
    const result = await recognizeImage(state.packageImage, { lang: 'auto' });
    const parsed = parsePackageResult(result);
    closeModal('ocrModal');
    openProductForm(null, parsed);

    const confidence = Math.round((Number(result.average_confidence) || 0) * 100);
    toast(
      confidence
        ? `识别完成（平均置信度 ${confidence}%），请核对后保存`
        : '识别完成，请核对后保存',
      'success',
      4200
    );
  } catch (error) {
    $('#ocrError').textContent = error.message || '识别失败';
    $('#ocrError').hidden = false;
    toast(error.message || '识别失败', 'error', 5200);
  } finally {
    $('#ocrProgress').hidden = true;
    $('#ocrProgressBar').classList.remove('indeterminate');
    button.disabled = !state.packageImage;
  }
}

/* ========================= 手写表格识别 ========================= */
function openTableModal() {
  clearTableImage();
  state.tableRows = [];
  state.tableMeta = null;
  $('#tableError').hidden = true;
  $('#tableProgress').hidden = true;
  $('#tableResultBox').hidden = true;
  $('#tableImportBtn').hidden = true;
  openModal('tableModal');
}

async function setTableImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件（JPG / PNG）', 'warn');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('图片不能超过 10MB，请压缩后再试', 'warn');
    return;
  }

  try {
    const dataUrl = await readFileAsDataURL(file);
    state.tableImage = file;
    state.tableRows = [];
    state.tableMeta = null;
    const picker = $('#tablePicker');
    const image = $('#tablePreview');
    image.src = dataUrl;
    picker.querySelector('.image-empty').hidden = true;
    picker.querySelector('.image-preview').hidden = false;
    $('#tableFile').value = '';
    $('#tableRecognizeBtn').disabled = false;
    $('#tableResultBox').hidden = true;
    $('#tableImportBtn').hidden = true;
    $('#tableError').hidden = true;
  } catch (error) {
    toast('图片读取失败，请换一张图片', 'error');
  }
}

function clearTableImage() {
  state.tableImage = null;
  state.tableRows = [];
  state.tableMeta = null;
  const picker = $('#tablePicker');
  if (!picker) return;
  const image = $('#tablePreview');
  if (image) image.removeAttribute('src');
  picker.querySelector('.image-empty').hidden = false;
  picker.querySelector('.image-preview').hidden = true;
  const fileInput = $('#tableFile');
  if (fileInput) fileInput.value = '';
  const button = $('#tableRecognizeBtn');
  if (button) button.disabled = true;
  $('#tableProgress').hidden = true;
  $('#tableError').hidden = true;
  $('#tableResultBox').hidden = true;
  $('#tableImportBtn').hidden = true;
}

async function recognizeTable() {
  if (!state.tableImage) {
    toast('请先选择或拍摄一张表格照片', 'warn');
    return;
  }

  const button = $('#tableRecognizeBtn');
  button.disabled = true;
  $('#tableError').hidden = true;
  $('#tableResultBox').hidden = true;
  $('#tableImportBtn').hidden = true;
  $('#tableProgress').hidden = false;
  $('#tableProgressBar').classList.add('indeterminate');
  $('#tableProgressText').textContent = '正在识别表格文字与位置，请稍候…';

  try {
    const result = await recognizeImage(state.tableImage, { lang: 'auto' });
    const parsed = parseTableResult(result);
    state.tableMeta = parsed;
    state.tableRows = parsed.rows.length ? parsed.rows : [blankTableRow()];
    renderTablePreview(parsed);
    $('#tableResultBox').hidden = false;

    if (parsed.rows.length) {
      toast(`识别到 ${parsed.rows.length} 行数据，请逐行核对`, 'success', 4200);
    } else {
      toast('没有识别到有效表格行，可手动添加行后导入', 'warn', 5000);
    }

    if (!parsed.headerFound && parsed.rows.length) {
      toast('未识别到表头，已按位置推测列，请仔细核对', 'warn', 4700);
    }
  } catch (error) {
    $('#tableError').textContent = error.message || '识别失败';
    $('#tableError').hidden = false;
    toast(error.message || '识别失败', 'error', 5200);
  } finally {
    $('#tableProgress').hidden = true;
    $('#tableProgressBar').classList.remove('indeterminate');
    button.disabled = !state.tableImage;
  }
}

function blankTableRow() {
  return {
    name: '',
    productionDate: '',
    shelfLifeMonths: '',
    quantity: '',
    remark: ''
  };
}

function renderTablePreview(parsed = state.tableMeta) {
  const tbody = $('#tableResultBody');
  if (!tbody) return;

  tbody.innerHTML = state.tableRows.map((row, index) => {
    const valid = validateTableRow(row).valid;
    return `
      <tr data-row-index="${index}" class="${valid ? '' : 'row-invalid'}">
        <td class="col-seq">${index + 1}</td>
        <td><input type="text" data-field="name" value="${escapeHtml(row.name)}" placeholder="商品名称"></td>
        <td><input type="text" data-field="productionDate" value="${escapeHtml(row.productionDate)}" placeholder="YYYY/MM/DD"></td>
        <td><input type="text" data-field="shelfLifeMonths" value="${escapeHtml(row.shelfLifeMonths)}" placeholder="如 6" inputmode="decimal"></td>
        <td><input type="text" data-field="quantity" value="${escapeHtml(row.quantity)}" placeholder="如 10" inputmode="numeric"></td>
        <td><input type="text" data-field="remark" value="${escapeHtml(row.remark)}" placeholder="选填"></td>
        <td class="col-action">
          <button type="button" class="btn btn-sm danger" data-action="remove-table-row" data-index="${index}" title="删除这一行">${'×'}</button>
        </td>
      </tr>
    `;
  }).join('');

  updateTablePreviewFooter(parsed);
  $('#tableRawText').textContent = parsed?.rawText || '';
}

function updateTablePreviewFooter(parsed = state.tableMeta) {
  const validCount = state.tableRows.filter((row) => validateTableRow(row).valid).length;
  const summary = $('#tableResultSummary');
  if (summary) {
    const headerNote = parsed && !parsed.headerFound ? ' · 未识别到表头，已按位置推测' : '';
    summary.textContent = `${state.tableRows.length} 行 · ${validCount} 行可导入${headerNote}`;
  }

  const button = $('#tableImportBtn');
  if (button) {
    button.hidden = !state.tableImage && state.tableRows.length === 0;
    button.textContent = validCount ? `导入 ${validCount} 条` : '请补全数据后导入';
    button.disabled = validCount === 0;
  }
}

function updateTableRowValidity() {
  $$('#tableResultBody tr').forEach((tr) => {
    const index = Number(tr.dataset.rowIndex);
    const row = state.tableRows[index];
    if (!row) return;
    tr.classList.toggle('row-invalid', !validateTableRow(row).valid);
  });
  updateTablePreviewFooter();
}

async function importTableRows() {
  const validRows = [];
  for (const row of state.tableRows) {
    if (validateTableRow(row).valid) validRows.push(row);
  }
  const skipped = state.tableRows.length - validRows.length;

  if (!validRows.length) {
    toast('没有可导入的有效行，请补全商品名称、生产日期、保质期和数量', 'error', 5000);
    return;
  }

  if (skipped > 0) {
    const ok = await confirmAction({
      title: '部分数据不完整',
      message: `有 <strong>${skipped}</strong> 行数据不完整，将被跳过。继续导入 <strong>${validRows.length}</strong> 条吗？`,
      okText: '继续导入'
    });
    if (!ok) return;
  }

  const inputs = validRows.map((row) => ({
    name: row.name,
    productionDate: row.productionDate,
    shelfLifeMonths: Number(row.shelfLifeMonths),
    quantity: Number(row.quantity),
    status: '未下架',
    remark: row.remark || ''
  }));

  try {
    const result = store.importProducts(inputs, { mode: 'merge' });
    closeModal('tableModal');
    toast(`已导入 ${result.imported} 条商品`, 'success', 4200);
    if (result.errors.length) toast(`${result.errors.length} 条商品导入失败`, 'warn');
    navigate('onsale');
  } catch (error) {
    toast(error.message || '导入失败', 'error');
  }
}

/* ========================= 摄像头 ========================= */
async function openCamera(target = 'ocr') {
  state.camera.target = target;
  const errorBox = $('#cameraError');
  errorBox.hidden = true;
  errorBox.textContent = '';

  openModal('cameraModal');

  if (!navigator.mediaDevices?.getUserMedia) {
    errorBox.textContent = '当前环境无法调用摄像头。请用「选择图片」上传照片，或通过 start.bat 在本机启动后访问。';
    errorBox.hidden = false;
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    state.camera.stream = stream;
    const video = $('#cameraVideo');
    video.srcObject = stream;
    await video.play().catch(() => {});
  } catch (error) {
    const messages = {
      NotAllowedError: '摄像头权限被拒绝，请在浏览器地址栏允许摄像头权限，或直接选择图片上传。',
      NotFoundError: '没有检测到摄像头，请使用「选择图片」上传照片。',
      NotReadableError: '摄像头被其他程序占用，请关闭其它摄像头软件后重试。'
    };
    errorBox.textContent = messages[error.name] || `无法打开摄像头：${error.message}`;
    errorBox.hidden = false;
  }
}

function stopCameraStream() {
  if (state.camera.stream) {
    state.camera.stream.getTracks().forEach((track) => track.stop());
    state.camera.stream = null;
  }
  const video = $('#cameraVideo');
  if (video) video.srcObject = null;
}

function closeCamera() {
  stopCameraStream();
  closeModal('cameraModal');
}

function capturePhoto() {
  const video = $('#cameraVideo');
  const canvas = $('#cameraCanvas');
  if (!video || !canvas || !video.videoWidth) {
    toast('摄像头尚未准备好，请稍后再试', 'warn');
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const target = state.camera.target;

  canvas.toBlob(async (blob) => {
    if (!blob) {
      toast('拍照失败，请重试', 'error');
      return;
    }
    const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
    closeCamera();
    if (target === 'table') await setTableImage(file);
    else await setPackageImage(file);
  }, 'image/jpeg', 0.92);
}

/* ========================= 图片选择器与拖拽 ========================= */
async function rotatePickerImage(picker) {
  const file = picker === 'table' ? state.tableImage : state.packageImage;
  if (!file) {
    toast('请先选择图片', 'warn');
    return;
  }
  try {
    const rotated = await rotateImageFile(file, 90);
    if (picker === 'table') await setTableImage(rotated);
    else await setPackageImage(rotated);
    toast('图片已旋转，可重新识别', 'info');
  } catch (error) {
    toast(error.message || '旋转失败', 'error');
  }
}

function bindImagePicker(pickerId, fileInputId, setter) {
  const picker = document.getElementById(pickerId);
  const input = document.getElementById(fileInputId);
  if (!picker || !input) return;

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) setter(file);
  });

  ['dragenter', 'dragover'].forEach((name) => {
    picker.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      picker.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((name) => {
    picker.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (name === 'dragleave' && picker.contains(event.relatedTarget)) return;
      picker.classList.remove('dragover');
      if (name === 'drop') {
        const file = event.dataTransfer?.files?.[0];
        if (file) setter(file);
      }
    });
  });
}

/* ========================= 档位设置 ========================= */
function readTierInputs() {
  return $$('#tierRows tr').map((tr) => {
    const read = (field) => {
      const input = tr.querySelector(`[data-tier="${field}"]`);
      const raw = input?.value?.trim() ?? '';
      return raw === '' ? NaN : Number(raw);
    };
    return {
      min: read('min'),
      max: read('max'),
      advanceDays: read('advanceDays')
    };
  });
}

function addTierRow() {
  const rows = $$('#tierRows tr');
  const lastInputs = rows.length ? rows[rows.length - 1].querySelectorAll('[data-tier]') : [];
  const lastMax = lastInputs.length ? Number(lastInputs[1].value) : 0;
  const lastAdvance = lastInputs.length ? Number(lastInputs[2].value) : 15;
  const tier = {
    min: Number.isFinite(lastMax) ? lastMax + 1 : 0,
    max: Number.isFinite(lastMax) ? lastMax + 30 : 30,
    advanceDays: Number.isFinite(lastAdvance) ? lastAdvance : 15
  };
  $('#tierRows').insertAdjacentHTML('beforeend', renderTierRow(tier, rows.length));
  const newRow = $('#tierRows tr:last-child');
  newRow?.querySelector('[data-tier="min"]')?.focus();
}

function saveTiersFromForm() {
  const tiers = readTierInputs();
  try {
    store.saveTiers(tiers);
    toast('档位已保存，所有商品的临期下架日已重新计算', 'success', 4200);
  } catch (error) {
    toast(error.message || '档位设置无效', 'error', 5200);
  }
}

async function resetTiers() {
  const ok = await confirmAction({
    title: '恢复默认档位',
    message: '恢复默认的 6 档临期规则，并重新计算所有商品的临期下架日。是否继续？',
    okText: '恢复默认'
  });
  if (!ok) return;
  try {
    store.resetTiers();
    toast('已恢复默认档位', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ========================= 事件绑定 ========================= */
function bindStaticEvents() {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('input', handleDocumentInput);
  document.addEventListener('change', handleDocumentChange);

  window.addEventListener('hashchange', () => {
    const tab = getTabFromHash();
    const changed = state.tab !== tab;
    state.tab = tab;
    render();
    if (changed) window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#productForm')?.addEventListener('submit', handleProductSubmit);

  $('#importFile')?.addEventListener('change', () => {
    const file = $('#importFile').files?.[0];
    if (file) handleImportFile(file);
  });

  const importDrop = $('#importDrop');
  if (importDrop) {
    ['dragenter', 'dragover'].forEach((name) => {
      importDrop.addEventListener(name, (event) => {
        event.preventDefault();
        importDrop.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      importDrop.addEventListener(name, (event) => {
        event.preventDefault();
        importDrop.classList.remove('dragover');
        if (name === 'drop') {
          const file = event.dataTransfer?.files?.[0];
          if (file) handleImportFile(file);
        }
      });
    });
  }

  bindImagePicker('ocrPicker', 'ocrFile', setPackageImage);
  bindImagePicker('tablePicker', 'tableFile', setTableImage);

  ['ocrModal', 'tableModal', 'importModal', 'cameraModal'].forEach((id) => {
    const modal = document.getElementById(id);
    modal?.addEventListener('modal:closed', () => {
      if (id === 'ocrModal') clearPackageImage();
      if (id === 'tableModal') {
        clearTableImage();
        const body = $('#tableResultBody');
        if (body) body.innerHTML = '';
        const raw = $('#tableRawText');
        if (raw) raw.textContent = '';
      }
      if (id === 'importModal') {
        state.importData = null;
        $('#importPreview').hidden = true;
        $('#importPreviewBody').innerHTML = '';
        $('#importSummary').innerHTML = '';
        $('#importConfirmBtn').hidden = true;
        $('#importError').hidden = true;
      }
      if (id === 'cameraModal') stopCameraStream();
    });
  });
}

function handleDocumentClick(event) {
  const navTarget = event.target.closest('[data-nav]');
  if (navTarget) {
    event.preventDefault();
    const tab = navTarget.dataset.nav;
    const filterWarning = navTarget.hasAttribute('data-filter-warning')
      ? navTarget.dataset.filterWarning === '1'
      : tab === 'onsale'
        ? false
        : null;
    navigate(tab, { filterWarning });
    return;
  }

  const pickTarget = event.target.closest('[data-pick-image]');
  if (pickTarget) {
    const which = pickTarget.dataset.pickImage;
    $(which === 'table' ? '#tableFile' : '#ocrFile')?.click();
    return;
  }

  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  const id = actionTarget.dataset.id;

  switch (action) {
    case 'add-product':
      openProductForm();
      break;
    case 'detail': {
      const product = store.getProduct(id);
      if (product) openProductForm(product);
      break;
    }
    case 'delete':
      handleDelete(id);
      break;
    case 'offshelf':
      handleOffShelf(id);
      break;
    case 'restore':
      handleRestore(id);
      break;
    case 'open-ocr':
      openPackageModal();
      break;
    case 'open-table-ocr':
      openTableModal();
      break;
    case 'recognize-package':
      recognizePackage();
      break;
    case 'recognize-table':
      recognizeTable();
      break;
    case 'rotate-image':
      rotatePickerImage(actionTarget.dataset.picker === 'table' ? 'table' : 'ocr');
      break;
    case 'clear-image': {
      if (actionTarget.dataset.picker === 'table') clearTableImage();
      else clearPackageImage();
      break;
    }
    case 'open-camera':
      openCamera(actionTarget.dataset.target === 'table' ? 'table' : 'ocr');
      break;
    case 'close-camera':
      closeCamera();
      break;
    case 'capture-photo':
      capturePhoto();
      break;
    case 'table-add-row': {
      state.tableRows.push(blankTableRow());
      renderTablePreview();
      const rows = $$('#tableResultBody tr');
      rows[rows.length - 1]?.querySelector('[data-field="name"]')?.focus();
      break;
    }
    case 'remove-table-row': {
      const index = Number(actionTarget.dataset.index);
      state.tableRows.splice(index, 1);
      renderTablePreview();
      break;
    }
    case 'import-table':
      importTableRows();
      break;
    case 'import-excel':
      openImportModal();
      break;
    case 'export-excel':
      handleExport();
      break;
    case 'download-template':
      handleDownloadTemplate();
      break;
    case 'confirm-import':
      confirmImport();
      break;
    case 'dismiss-backup':
      store.dismissBackupReminder();
      toast('已设置 7 天后再提醒备份', 'info');
      break;
    case 'load-demo':
    case 'load-demo-home':
      handleLoadDemo();
      break;
    case 'clear-data':
      handleClearData();
      break;
    case 'save-tiers':
      saveTiersFromForm();
      break;
    case 'add-tier':
      addTierRow();
      break;
    case 'remove-tier': {
      const rows = $$('#tierRows tr');
      if (rows.length <= 1) {
        toast('至少需要保留一个档位', 'warn');
        break;
      }
      actionTarget.closest('tr')?.remove();
      break;
    }
    case 'reset-tiers':
      resetTiers();
      break;
    case 'check-ocr':
      refreshOcrStatus(true);
      break;
    case 'copy-mobile-url':
      copyText(actionTarget.dataset.url || '');
      break;
    case 'clear-sale-filters':
      state.saleFilters = { search: '', status: 'all', warningOnly: false, sort: 'expiry' };
      render();
      break;
    case 'clear-off-filters':
      state.offFilters.search = '';
      render();
      break;
    default:
      break;
  }
}

function handleDocumentInput(event) {
  const target = event.target;

  if (target.id === 'saleSearch') {
    const caret = target.selectionStart;
    state.saleFilters.search = target.value;
    render();
    const next = $('#saleSearch');
    if (next) {
      next.focus();
      try {
        next.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (target.id === 'offSearch') {
    const caret = target.selectionStart;
    state.offFilters.search = target.value;
    render();
    const next = $('#offSearch');
    if (next) {
      next.focus();
      try {
        next.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (target.closest('#productForm')) {
    if (target.id === 'fProductionDate' || target.id === 'fMonths') updateCalcPreview();
    const field = target.closest('.field');
    if (field?.classList.contains('has-error')) {
      field.classList.remove('has-error');
      field.querySelector('.field-error')?.remove();
    }
    return;
  }

  if (target.closest('#tableResultBody')) {
    const tr = target.closest('tr');
    const index = Number(tr?.dataset.rowIndex);
    const field = target.dataset.field;
    if (!Number.isInteger(index) || !field || !state.tableRows[index]) return;
    state.tableRows[index][field] = target.value;
    updateTableRowValidity();
  }
}

function handleDocumentChange(event) {
  const target = event.target;

  if (target.id === 'saleStatusFilter') {
    state.saleFilters.status = target.value;
    render();
    return;
  }
  if (target.id === 'saleWarningFilter') {
    state.saleFilters.warningOnly = target.value === 'warning';
    render();
    return;
  }
  if (target.id === 'saleSort') {
    state.saleFilters.sort = target.value;
    render();
    return;
  }
  if (target.dataset.action === 'toggle-reminder' && target.type === 'checkbox') {
    try {
      store.setBackupReminder(target.checked);
      toast(target.checked ? '已开启每周备份提醒' : '已关闭每周备份提醒', 'info');
    } catch (error) {
      toast(error.message, 'error');
    }
  }
}

/* ========================= 启动 ========================= */
init();
