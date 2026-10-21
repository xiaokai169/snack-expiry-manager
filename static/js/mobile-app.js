/* =========================================================
   零食效期管家 · 移动端应用
   ========================================================= */
import {
  $,
  $$,
  compressImageFile,
  escapeHtml,
  fmtDate,
  formatCnDate,
  formatDateTime,
  formatNumber,
  parseDate,
  readFileAsDataURL,
  rotateImageFile
} from './utils.js';
import * as store from './store.js';
import { closeModal, confirmAction, icon, openModal, toast } from './ui.js';
import { donutChart, horizontalBars } from './charts.js';
import {
  API_BASE,
  checkHealth,
  parsePackageResult,
  parseTableResult,
  recognizeImage,
  validateTableRow
} from './ocr.js';
import { downloadTemplate, exportToExcel, parseExcelFile } from './excel.js';

const TABS = new Set(['home', 'products', 'stats', 'settings']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const state = {
  tab: 'home',
  segment: 'onsale',
  filter: 'all',
  sort: 'expiry',
  search: '',
  ocrStatus: {
    state: 'checking',
    version: '',
    message: '',
    endpoint: API_BASE || window.location.origin
  },
  packageImage: null,
  tableImage: null,
  imageTarget: 'package',
  tableRows: [],
  tableMeta: null,
  importData: null
};

/* ========================= 初始化 ========================= */
function init() {
  resolveRoute();
  bindEvents();
  render();
  refreshOcrStatus();

  const warning = store.consumeLoadWarning();
  if (warning) toast(warning, 'error', 6000);
}

function resolveRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === 'onsale') {
    state.tab = 'products';
    state.segment = 'onsale';
    return;
  }
  if (hash === 'offshelf') {
    state.tab = 'products';
    state.segment = 'offshelf';
    return;
  }
  state.tab = TABS.has(hash) ? hash : 'home';
}

function setTab(tab, { segment = null, filter = null } = {}) {
  if (!TABS.has(tab)) return;
  state.tab = tab;
  if (segment) state.segment = segment;
  if (filter) state.filter = filter;
  if (tab === 'products' && segment === 'onsale' && filter === 'warning') {
    state.search = '';
  }

  if (window.location.hash !== `#${tab}`) {
    history.replaceState(null, '', `#${tab}`);
  }

  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  const app = $('#mobileApp');
  if (!app) return;

  switch (state.tab) {
    case 'products':
      renderProducts(app);
      break;
    case 'stats':
      renderStats(app);
      break;
    case 'settings':
      renderSettings(app);
      break;
    case 'home':
    default:
      renderHome(app);
      break;
  }

  updateNav();
  updateOcrStatusUi();
}

function updateNav() {
  $$('#mNav [data-mtab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mtab === state.tab);
  });
}


function footerNote() {
  return '<p class="m-footer-note">数据保存在当前浏览器 · 建议每周导出一次备份</p>';
}

/* ========================= 通用 UI ========================= */
function statusBadge(status) {
  if (status === '已下架') return '<span class="m-badge gray"><span class="dot"></span>已下架</span>';
  if (status === '无需下架') return '<span class="m-badge blue"><span class="dot"></span>无需下架</span>';
  return '<span class="m-badge green"><span class="dot"></span>未下架</span>';
}

function remainingBadge(product, meta) {
  if (product.status === '已下架') return '<span class="m-badge gray">已下架</span>';
  if (product.status === '无需下架') return `<span class="m-badge blue">${escapeHtml(meta.remainingLabel)}</span>`;
  if (meta.expired) return `<span class="m-badge red">${escapeHtml(meta.remainingLabel)}</span>`;
  if (meta.warning) return `<span class="m-badge orange">${escapeHtml(meta.remainingLabel)}</span>`;
  return `<span class="m-badge green">${escapeHtml(meta.remainingLabel)}</span>`;
}

function emptyState({ iconName = 'box', title, description, actions = '' }) {
  return `
    <div class="m-empty">
      <span class="m-orb">${icon(iconName)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${actions ? `<div class="m-empty-actions">${actions}</div>` : ''}
    </div>
  `;
}

function dayLabel(meta) {
  const days = meta.remainingDays ?? 0;
  if (days < 0) return '已过期（天）';
  if (days === 0) return '今天到期';
  return '剩余天数';
}

/* ========================= 首页 ========================= */
function renderHome(app) {
  const products = store.getProducts();
  const stats = store.getStats();
  const warnings = store.getWarningProducts();
  const backup = store.getBackupInfo();
  const isEmpty = products.length === 0;

  const warningHtml = warnings.length
    ? warnings.map((product) => {
      const meta = store.getProductMeta(product);
      const days = meta.remainingDays ?? 0;
      const big = days < 0 ? Math.abs(days) : days;
      return `
        <div class="m-warning-item ${meta.expired ? 'is-expired' : ''}">
          <button type="button" class="m-warning-main" data-action="detail" data-id="${product.id}">
            <span class="m-warn-dot"></span>
            <span class="m-warning-name">
              <strong>${escapeHtml(product.name)}</strong>
              <small>到期 ${fmtDate(product.expiryDate)} · 数量 ${formatNumber(product.quantity)}</small>
            </span>
            <span class="m-warning-days">
              <strong>${big}</strong>
              <small>${days < 0 ? '已过期' : days === 0 ? '今天到期' : '剩余天数'}</small>
            </span>
          </button>
          <div class="m-warning-actions">
            <button type="button" class="primary" data-action="offshelf" data-id="${product.id}">标记下架</button>
            <button type="button" data-action="detail" data-id="${product.id}">编辑</button>
          </div>
        </div>
      `;
    }).join('')
    : `
      <div class="m-warning-empty">
        <span class="m-orb">${icon('check')}</span>
        <div>
          <strong>${isEmpty ? '还没有商品数据' : '暂无临期商品'}</strong>
          <p>${isEmpty ? '先录入第一件商品，效期会自动计算。' : '所有在售商品的临期下架日都还没到。'}</p>
        </div>
      </div>
    `;

  app.innerHTML = `
    <section class="m-page-head">
      <p class="m-eyebrow">TODAY · ${escapeHtml(formatCnDate(new Date()))}</p>
      <h1>${isEmpty ? '欢迎使用' : '今日效期'}</h1>
      <p class="m-sub">${isEmpty
        ? '拍照、手动或导入 Excel，把货架搬进手机。'
        : warnings.length
          ? `有 ${warnings.length} 种商品需要优先处理。`
          : '货架状态良好，记得检查是否有新到的货。'}</p>
    </section>

    ${isEmpty ? `
      <section class="m-card">
        <div class="m-empty">
          <span class="m-orb">${icon('snack')}</span>
          <h3>先把货架搬进手机</h3>
          <p>拍照识别包装、手动录入，或从 Excel 导入。数据只保存在当前手机浏览器。</p>
          <div class="m-empty-actions">
            <button type="button" class="m-btn primary" data-action="open-package">${icon('camera')}拍照录入</button>
            <button type="button" class="m-btn ghost" data-action="add-product">手动新增</button>
            <button type="button" class="m-btn ghost" data-action="import-excel">导入 Excel</button>
          </div>
          <button type="button" class="m-text-link" data-action="load-demo">先载入示例数据体验</button>
        </div>
      </section>
    ` : `
      <section class="m-card m-warning-panel">
        <div class="m-card-head">
          <h2>${icon('warning')}即将到期 <span class="m-count">${warnings.length}</span></h2>
          <button type="button" class="m-btn tiny ghost" data-mnav="products" data-segment="onsale" data-filter="warning">查看全部</button>
        </div>
        <div class="m-warning-list">${warningHtml}</div>
      </section>

      ${backup.due ? renderBackupBanner(backup) : ''}

      <div class="m-stat-grid">
        ${statTile(stats.onSaleKinds, '在售商品', `共 ${formatNumber(stats.onSaleQuantity)} 件`, 'box', '', { nav: 'products', segment: 'onsale', filter: 'all' })}
        ${statTile(stats.warningKinds, '临期预警', `${stats.expiredKinds} 种已过期`, 'clock', stats.expiredKinds > 0 ? 'red' : 'amber', { nav: 'products', segment: 'onsale', filter: 'warning' })}
        ${statTile(stats.offShelfKinds, '已下架', `本月 ${stats.offThisMonth} 种`, 'archive', 'gray', { nav: 'products', segment: 'offshelf', filter: 'all' })}
        ${statTile(stats.totalKinds, '全部商品', '自动保存', 'chart', 'green', { nav: 'stats' })}
      </div>
    `}

    <section class="m-card">
      <div class="m-card-head"><h2>快捷操作</h2></div>
      <div class="m-quick-grid">
        ${quickAction('camera', '拍照录入', '识别包装信息', 'open-package')}
        ${quickAction('plus', '手动新增', '填写表单', 'add-product')}
        ${quickAction('table', '识别表格', '批量导入旧表格', 'open-table')}
        ${quickAction('download', '导出备份', '保存为 Excel', 'export-excel')}
        ${quickAction('upload', '导入数据', '从 Excel 恢复', 'import-excel')}
      </div>
    </section>

    ${footerNote()}
  `;
}

function statTile(value, label, note, iconName, tone = '', nav = {}) {
  const navAttrs = nav.nav
    ? `data-mnav="${nav.nav}"${nav.segment ? ` data-segment="${nav.segment}"` : ''}${nav.filter ? ` data-filter="${nav.filter}"` : ''}`
    : '';
  const tag = nav.nav ? 'button' : 'div';
  const typeAttr = nav.nav ? 'type="button"' : '';
  return `
    <${tag} ${typeAttr} class="m-stat-tile ${tone === 'red' ? 'alert' : tone === 'amber' ? 'warn' : ''}" ${navAttrs}>
      <span class="m-stat-icon ${tone === 'red' ? 'red' : tone === 'gray' ? 'gray' : tone === 'green' ? 'green' : ''}">${icon(iconName)}</span>
      <span>
        <strong>${formatNumber(value)}<small>种</small></strong>
        <span class="m-stat-label">${escapeHtml(label)} · ${escapeHtml(note)}</span>
      </span>
    </${tag}>
  `;
}

function quickAction(iconName, title, sub, action) {
  return `
    <button type="button" class="m-quick" data-action="${action}">
      <span class="m-q-icon">${icon(iconName)}</span>
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(sub)}</small></span>
    </button>
  `;
}

function renderBackupBanner(backup) {
  const text = backup.daysSinceBackup === null
    ? '还没有导出过备份，清理浏览器数据会丢失商品记录。'
    : `距上次备份已 ${backup.daysSinceBackup} 天。`;
  return `
    <div class="m-backup-banner">
      ${icon('download')}
      <div>
        <strong>建议导出一份数据备份</strong>
        <p>${escapeHtml(text)}</p>
        <div class="m-backup-actions">
          <button type="button" class="m-btn tiny primary" data-action="export-excel">立即导出</button>
          <button type="button" class="m-btn tiny ghost" data-action="dismiss-backup">7 天后再提醒</button>
        </div>
      </div>
    </div>
  `;
}

/* ========================= 商品页 ========================= */
function renderProducts(app) {
  const allProducts = store.getProducts();
  const onSale = allProducts.filter((product) => product.status !== '已下架');
  const offShelf = allProducts.filter((product) => product.status === '已下架');
  const isOff = state.segment === 'offshelf';
  const search = state.search.trim().toLowerCase();

  let list = (isOff ? offShelf : onSale).filter((product) => {
    if (search && !`${product.name} ${product.remark || ''}`.toLowerCase().includes(search)) return false;
    if (!isOff) {
      const meta = store.getProductMeta(product);
      if (state.filter === 'warning' && !meta.warning) return false;
      if (state.filter === 'noneed' && product.status !== '无需下架') return false;
    }
    return true;
  });

  list = sortProductList(list, isOff ? 'offshelf' : state.sort);
  const totalQuantity = list.reduce((sum, product) => sum + (Number(product.quantity) || 0), 0);
  const hasFilter = Boolean(search) || (!isOff && state.filter !== 'all');

  const chips = isOff ? '' : `
    <div class="m-chip-row">
      <button type="button" class="m-chip ${state.filter === 'all' ? 'active' : ''}" data-mfilter="all">全部</button>
      <button type="button" class="m-chip ${state.filter === 'warning' ? 'active' : ''}" data-mfilter="warning">仅看临期</button>
      <button type="button" class="m-chip ${state.filter === 'noneed' ? 'active' : ''}" data-mfilter="noneed">无需下架</button>
      <select class="m-sort-select" id="mSort" aria-label="排序">
        <option value="expiry" ${state.sort === 'expiry' ? 'selected' : ''}>到期日最近</option>
        <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>最新录入</option>
        <option value="quantity" ${state.sort === 'quantity' ? 'selected' : ''}>数量最多</option>
        <option value="name" ${state.sort === 'name' ? 'selected' : ''}>名称排序</option>
      </select>
    </div>
  `;

  const cards = list.map((product) => renderProductCard(product, isOff)).join('');

  app.innerHTML = `
    <section class="m-page-head">
      <p class="m-eyebrow">STOCK</p>
      <h1>商品</h1>
      <p class="m-sub">在售商品临期下架日已到时会标红，点击卡片可编辑。</p>
    </section>

    <div class="m-segmented" role="tablist">
      <button type="button" data-msegment="onsale" class="${!isOff ? 'active' : ''}">在售 <span>${onSale.length}</span></button>
      <button type="button" data-msegment="offshelf" class="${isOff ? 'active' : ''}">已下架 <span>${offShelf.length}</span></button>
    </div>

    <div class="m-search">
      ${icon('search')}
      <input type="search" id="mSearch" value="${escapeHtml(state.search)}" placeholder="搜索商品名称 / 备注" autocomplete="off">
    </div>

    ${chips}

    ${list.length ? `
      <div class="m-product-list">${cards}</div>
      <div class="m-list-foot">共 ${list.length} 种 · ${formatNumber(totalQuantity)} 件</div>
    ` : emptyState({
      iconName: hasFilter ? 'search' : 'box',
      title: hasFilter ? '没有符合条件的商品' : isOff ? '还没有已下架商品' : '在售货架还是空的',
      description: hasFilter
        ? '试试更换关键词或筛选条件。'
        : isOff
          ? '在售商品标记下架后会出现在这里。'
          : '拍照识别、手动新增，或从 Excel 导入。',
      actions: hasFilter
        ? '<button type="button" class="m-btn ghost" data-action="clear-filters">清除筛选</button>'
        : `
          <button type="button" class="m-btn primary" data-action="add-product">${icon('plus')}新增商品</button>
          <button type="button" class="m-btn ghost" data-action="open-package">${icon('camera')}拍照录入</button>
        `
    })}

    ${footerNote()}
  `;
}

function sortProductList(list, sort) {
  const copy = [...list];
  if (sort === 'offshelf') {
    copy.sort((a, b) => (b.offShelfAt || b.updatedAt).localeCompare(a.offShelfAt || a.updatedAt));
  } else if (sort === 'newest') {
    copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq);
  } else if (sort === 'quantity') {
    copy.sort((a, b) => b.quantity - a.quantity || a.seq - b.seq);
  } else if (sort === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } else {
    copy.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.seq - b.seq);
  }
  return copy;
}

function renderProductCard(product, isOff) {
  const meta = store.getProductMeta(product);
  const cardClass = isOff ? '' : meta.expired ? 'expired' : meta.warning ? 'warning' : '';
  const extraMeta = isOff
    ? `<span><small>下架时间</small><b>${formatDateTime(product.offShelfAt || product.updatedAt)}</b></span>`
    : `<span><small>临期下架日</small><b>${fmtDate(product.warningDate)}</b></span>`;

  const actions = isOff
    ? `
      <button type="button" data-action="detail" data-id="${product.id}">${icon('edit')}编辑</button>
      <button type="button" data-action="restore" data-id="${product.id}">${icon('restore')}恢复</button>
      <button type="button" class="danger" data-action="delete" data-id="${product.id}">${icon('trash')}</button>
    `
    : `
      <button type="button" data-action="detail" data-id="${product.id}">${icon('edit')}编辑</button>
      <button type="button" class="warn" data-action="offshelf" data-id="${product.id}">标记下架</button>
      <button type="button" class="danger" data-action="delete" data-id="${product.id}">${icon('trash')}</button>
    `;

  return `
    <article class="m-product-card ${cardClass}" data-action="detail" data-id="${product.id}">
      <div class="m-product-top">
        <div class="m-product-title">
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(product.remark || '无备注')} · 录入 ${formatDateTime(product.createdAt)}</small>
        </div>
        ${remainingBadge(product, meta)}
      </div>

      <div class="m-product-meta">
        <span><small>到期日</small><b>${fmtDate(product.expiryDate)}</b></span>
        ${extraMeta}
        <span><small>保质期</small><b>${formatNumber(product.shelfLifeMonths)} 个月 / ${formatNumber(product.shelfLifeDays)} 天</b></span>
        <span><small>数量</small><b>${formatNumber(product.quantity)} 件</b></span>
      </div>

      <div class="m-product-bottom">
        ${statusBadge(product.status)}
        <div class="m-product-actions">${actions}</div>
      </div>
    </article>
  `;
}

/* ========================= 统计页 ========================= */
function renderStats(app) {
  const stats = store.getStats();
  const dist = stats.distribution;
  const checked = dist.expired + dist.within7 + dist.within15 + dist.within30 + dist.safe;

  if (stats.totalKinds === 0) {
    app.innerHTML = `
      <section class="m-page-head">
        <p class="m-eyebrow">ANALYTICS</p>
        <h1>数据统计</h1>
        <p class="m-sub">库存、临期分布和入库趋势。</p>
      </section>
      <section class="m-card">
        ${emptyState({
          iconName: 'chart',
          title: '还没有可统计的数据',
          description: '录入商品后，这里会自动生成库存和临期图表。',
          actions: `
            <button type="button" class="m-btn primary" data-action="add-product">${icon('plus')}新增商品</button>
            <button type="button" class="m-btn ghost" data-action="load-demo">载入示例数据</button>
          `
        })}
      </section>
      ${footerNote()}
    `;
    return;
  }

  const distributionRows = [
    { label: '已过期', value: dist.expired, color: '#dc2626' },
    { label: '7 天内', value: dist.within7, color: '#f97316' },
    { label: '8–15 天', value: dist.within15, color: '#f59e0b' },
    { label: '16–30 天', value: dist.within30, color: '#eab308' },
    { label: '30 天以上', value: dist.safe, color: '#22c55e' }
  ];

  app.innerHTML = `
    <section class="m-page-head">
      <p class="m-eyebrow">ANALYTICS</p>
      <h1>数据统计</h1>
      <p class="m-sub">基于当前手机中的商品数据实时计算。</p>
    </section>

    <div class="m-stat-grid">
      ${statTile(stats.onSaleKinds, '在售商品', `共 ${formatNumber(stats.onSaleQuantity)} 件`, 'box', '', {})}
      ${statTile(stats.warningKinds, '临期商品', `${stats.expiredKinds} 种已过期`, 'clock', stats.expiredKinds > 0 ? 'red' : 'amber', {})}
      ${statTile(stats.offShelfKinds, '已下架', `共 ${formatNumber(stats.offShelfQuantity)} 件`, 'archive', 'gray', {})}
      ${statTile(stats.totalKinds, '累计录入', `本月下架 ${stats.offThisMonth} 种`, 'chart', 'green', {})}
    </div>

    <section class="m-card m-chart-card">
      <h2>临期分布</h2>
      <p class="m-card-sub">按距离到期日的天数分组</p>
      ${horizontalBars(distributionRows)}
      <p class="chart-note">统计范围：状态为「未下架」的商品，共 ${checked} 种；「无需下架」不参与临期统计。</p>
    </section>

    <section class="m-card m-chart-card">
      <h2>商品状态分布</h2>
      <p class="m-card-sub">在售与已下架占比</p>
      ${donutChart(stats.statusDistribution, { centerLabel: '商品总数' })}
      <p class="chart-note">未下架 = 在售且参与预警；无需下架 = 在售但不预警。</p>
    </section>

    <section class="m-card m-chart-card">
      <h2>下架统计</h2>
      <p class="m-card-sub">当前已下架与本月下架</p>
      <div class="m-mini-grid">
        <div class="m-mini-stat danger"><span>已下架种类</span><strong>${stats.offShelfKinds}</strong><small>种</small></div>
        <div class="m-mini-stat"><span>已下架数量</span><strong>${formatNumber(stats.offShelfQuantity)}</strong><small>件</small></div>
        <div class="m-mini-stat accent"><span>本月下架</span><strong>${stats.offThisMonth}</strong><small>种</small></div>
      </div>
      <p class="chart-note">「本月下架」按下架时间统计，含已恢复在售的历史记录。</p>
    </section>

    <section class="m-card m-chart-card">
      <h2>临期处理建议</h2>
      <p class="m-card-sub">根据当前数据自动生成</p>
      <div class="m-inline-note ${stats.warningKinds ? 'warn' : 'success'}">
        ${stats.warningKinds
          ? `当前有 <strong>${stats.warningKinds}</strong> 种商品进入临期下架期，其中 <strong>${stats.expiredKinds}</strong> 种已过期，建议优先处理。`
          : '当前没有临期商品，货架状态良好。'}
      </div>
      <div class="m-mini-grid" style="margin-top:10px">
        <div class="m-mini-stat"><span>7 天内到期</span><strong>${dist.within7}</strong><small>种</small></div>
        <div class="m-mini-stat"><span>15 天内到期</span><strong>${dist.within7 + dist.within15}</strong><small>种</small></div>
        <div class="m-mini-stat danger"><span>已过期</span><strong>${dist.expired}</strong><small>种</small></div>
      </div>
    </section>

    <section class="m-card m-chart-card">
      <h2>近 6 个月入库 / 下架</h2>
      <p class="m-card-sub">入库按录入时间、下架按下架时间统计</p>
      ${renderMobileTrend(stats.trend)}
    </section>

    ${footerNote()}
  `;
}

function renderMobileTrend(months) {
  const max = Math.max(1, ...months.flatMap((month) => [month.added, month.offShelf]));
  return `
    <div class="m-trend-legend">
      <span><i class="add"></i>新入库</span>
      <span><i class="off"></i>下架</span>
    </div>
    <div class="m-trend">
      ${months.map((month) => `
        <div class="m-trend-row">
          <span class="m-trend-label">${escapeHtml(month.label)}</span>
          <span class="m-trend-track">
            <i class="add" style="width:${(month.added / max) * 100}%" title="新入库 ${month.added}"></i>
            <i class="off" style="width:${(month.offShelf / max) * 100}%" title="下架 ${month.offShelf}"></i>
          </span>
          <span class="m-trend-values">${month.added}/${month.offShelf}</span>
        </div>
      `).join('')}
    </div>
  `;
}

/* ========================= 设置页 ========================= */
function renderSettings(app) {
  const settings = store.getSettings();
  const backup = store.getBackupInfo();
  const products = store.getProducts();
  const service = state.ocrStatus;
  const serviceClass = service.state === 'ok' ? 'ok' : service.state === 'bad' ? 'bad' : '';
  const serviceText = service.state === 'ok'
    ? `识别服务已连接${service.version ? ` · PaddleOCR ${service.version}` : ''}`
    : service.state === 'checking'
      ? '正在检测识别服务…'
      : `识别服务未连接${service.message ? ` · ${service.message}` : ''}`;

  app.innerHTML = `
    <section class="m-page-head">
      <p class="m-eyebrow">SETTINGS</p>
      <h1>设置</h1>
      <p class="m-sub">档位、备份与识别服务。</p>
    </section>

    <section class="m-card">
      <h2>${icon('clock')}临期下架档位</h2>
      <p class="m-card-sub">按保质期天数匹配提前下架天数，保存后重算全部商品</p>
      <div class="m-tier-list" id="mTierRows">
        ${settings.warningTiers.map((tier, index) => renderTierRow(tier, index)).join('')}
      </div>
      <div class="m-tier-actions">
        <button type="button" class="m-btn small ghost" data-action="add-tier">${icon('plus')}添加档位</button>
        <span class="spacer"></span>
        <button type="button" class="m-btn small ghost" data-action="reset-tiers">恢复默认</button>
        <button type="button" class="m-btn small primary" data-action="save-tiers">保存档位</button>
      </div>
      <p class="m-note" style="margin-top:10px">默认：0–3 天不提前，4–10 天提前 1 天，11–30 天提前 2 天，31–60 天提前 5 天，61–180 天提前 7 天，181 天以上提前 15 天。</p>
    </section>

    <section class="m-card">
      <h2>${icon('camera')}OCR 识别服务</h2>
      <div class="m-service-status ${serviceClass}" id="mServiceStatus">
        <span class="status-dot"></span><span>${escapeHtml(serviceText)}</span>
      </div>
      <div class="m-kv-grid">
        <div><span>服务地址</span><b id="mOcrEndpoint">${escapeHtml(service.endpoint)}</b></div>
        <div><span>识别能力</span><b>PaddleOCR · 中英文</b></div>
      </div>
      <div class="m-card-actions">
        <button type="button" class="m-btn small ghost" data-action="check-ocr">${icon('restore')}重新检测</button>
        <a class="m-btn small ghost" href="/docs" target="_blank" rel="noopener">API 文档</a>
      </div>
      <p class="m-note" style="margin-top:9px">识别由电脑上的 Python 服务完成，图片只在本机处理；手机和电脑需连接同一 Wi-Fi。</p>
    </section>

    <section class="m-card">
      <h2>${icon('download')}数据备份</h2>
      <div class="m-kv-grid">
        <div><span>上次导出</span><b>${backup.lastBackupAt ? formatDateTime(backup.lastBackupAt) : '还没有导出过'}</b></div>
        <div><span>当前商品</span><b>${products.length} 条</b></div>
      </div>
      <div class="m-switch-row">
        <div>
          <strong>每周备份提醒</strong>
          <small>超过 7 天未导出时提醒一次</small>
        </div>
        <label class="m-switch">
          <input type="checkbox" data-action="toggle-reminder" aria-label="每周备份提醒" ${settings.backupReminder ? 'checked' : ''}>
          <i></i>
        </label>
      </div>
      <div class="m-card-actions">
        <button type="button" class="m-btn small primary" data-action="export-excel">${icon('download')}导出 Excel</button>
        <button type="button" class="m-btn small ghost" data-action="import-excel">${icon('upload')}导入 Excel</button>
        <button type="button" class="m-btn small ghost" data-action="download-template">下载模板</button>
      </div>
      <div class="m-inline-note warn" style="margin-top:11px">
        本页数据保存在当前手机浏览器，与电脑版数据相互独立。换手机或清理浏览器数据前，请先导出备份；可用 Excel 导入导出在两台设备间迁移。
      </div>
    </section>

    <section class="m-card">
      <h2>${icon('phone')}移动端访问</h2>
      <div class="m-kv-grid">
        <div><span>当前地址</span><b>${escapeHtml(window.location.origin)}/mobile</b></div>
        <div><span>电脑版</span><b><a href="/?pc=1#home">切换到电脑版</a></b></div>
      </div>
      <div class="m-card-actions">
        <button type="button" class="m-btn small ghost" data-action="copy-url">复制当前地址</button>
      </div>
      <p class="m-note" style="margin-top:9px">手机与电脑需连接同一 Wi-Fi。电脑端启动服务后，可在电脑版「设置」中查看手机访问地址。</p>
    </section>

    <section class="m-card">
      <h2>${icon('settings')}数据管理</h2>
      <p class="m-card-sub">数据只保存在当前浏览器，不会上传云端</p>
      <div class="m-danger-zone">
        <div class="m-danger-title">谨慎操作</div>
        <p>「载入示例数据」会替换当前商品；「清空全部数据」会删除所有商品记录（档位保留）。</p>
        <div class="m-danger-actions">
          <button type="button" class="m-btn small ghost" data-action="load-demo">载入示例数据</button>
          <button type="button" class="m-btn small danger" data-action="clear-data">${icon('trash')}清空全部数据</button>
        </div>
      </div>
    </section>

    <section class="m-card">
      <h2>${icon('info')}关于</h2>
      <div class="m-kv-grid">
        <div><span>版本</span><b>v1.0 · 移动版</b></div>
        <div><span>存储方式</span><b>浏览器 LocalStorage</b></div>
      </div>
    </section>

    ${footerNote()}
  `;
}

function renderTierRow(tier, index) {
  return `
    <div class="m-tier-row" data-tier-row>
      <div class="m-tier-fields">
        <label class="m-mini-field"><span>下限（天）</span><input type="number" min="0" step="1" data-tier="min" value="${Number(tier.min) || 0}" inputmode="numeric" aria-label="第 ${index + 1} 档下限"></label>
        <label class="m-mini-field"><span>上限（含）</span><input type="number" min="0" step="1" data-tier="max" value="${Number(tier.max) || 0}" inputmode="numeric" aria-label="第 ${index + 1} 档上限"></label>
        <label class="m-mini-field"><span>提前（天）</span><input type="number" min="0" step="1" data-tier="advanceDays" value="${Number(tier.advanceDays) || 0}" inputmode="numeric" aria-label="第 ${index + 1} 档提前天数"></label>
      </div>
      <button type="button" class="m-tier-del" data-action="remove-tier" aria-label="删除档位">${icon('trash')}</button>
    </div>
  `;
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
    if (showFeedback) toast('识别服务连接正常', 'success');
  } else {
    state.ocrStatus = {
      state: 'bad',
      version: '',
      message: result.error || '服务未启动',
      endpoint: API_BASE || window.location.origin
    };
    if (showFeedback) {
      toast(`识别服务未连接：${state.ocrStatus.message}。请确认电脑上的服务已启动。`, 'error', 5200);
    }
  }
  updateOcrStatusUi();
}

function updateOcrStatusUi() {
  const pill = $('#mOcrStatus');
  if (pill) {
    pill.classList.remove('ok', 'bad', 'checking');
    pill.classList.add(state.ocrStatus.state);
    const text = pill.querySelector('.m-status-text');
    if (text) {
      text.textContent = state.ocrStatus.state === 'ok'
        ? '已连接'
        : state.ocrStatus.state === 'bad'
          ? '未连接'
          : '检测中';
    }
  }

  const box = $('#mServiceStatus');
  if (box) {
    box.classList.remove('ok', 'bad');
    if (state.ocrStatus.state === 'ok') box.classList.add('ok');
    if (state.ocrStatus.state === 'bad') box.classList.add('bad');
    const text = state.ocrStatus.state === 'ok'
      ? `识别服务已连接${state.ocrStatus.version ? ` · PaddleOCR ${state.ocrStatus.version}` : ''}`
      : state.ocrStatus.state === 'bad'
        ? `识别服务未连接${state.ocrStatus.message ? ` · ${state.ocrStatus.message}` : ''}`
        : '正在检测识别服务…';
    box.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(text)}</span>`;
  }

  const endpoint = $('#mOcrEndpoint');
  if (endpoint) endpoint.textContent = state.ocrStatus.endpoint;
}

/* ========================= 商品表单 ========================= */
function openProductSheet(product = null, prefill = null) {
  const form = $('#mobileProductForm');
  form.reset();
  clearFormErrors();

  $('#mFId').value = product?.id || '';
  $('#mProductTitle').textContent = product ? '编辑商品' : prefill ? '核对识别结果' : '新增商品';
  $('#mProductSub').textContent = product
    ? '修改后会自动重新计算效期'
    : prefill
      ? '已自动填入识别结果，请核对后保存'
      : '填写基础信息，效期自动计算';

  $('#mFName').value = product?.name || prefill?.name || '';
  $('#mFDate').value = product?.productionDate || prefill?.productionDate || '';
  $('#mFMonths').value = product?.shelfLifeMonths ?? prefill?.shelfLifeMonths ?? '';
  $('#mFQuantity').value = product?.quantity
    ?? (prefill?.quantity !== '' && prefill?.quantity !== null && prefill?.quantity !== undefined ? prefill.quantity : '');
  $('#mFStatus').value = product?.status || '未下架';
  $('#mFRemark').value = product?.remark || '';

  const note = $('#mFormNote');
  if (prefill) {
    const notes = Array.isArray(prefill.notes) ? prefill.notes.filter(Boolean) : [];
    note.hidden = false;
    note.className = notes.length ? 'm-inline-note warn' : 'm-inline-note';
    note.textContent = notes.length
      ? `识别提示：${notes.join('；')}。请核对后保存。`
      : '已根据照片自动填入，请核对生产日期与保质期后保存。';
  } else {
    note.hidden = true;
    note.textContent = '';
    note.className = 'm-inline-note';
  }

  const rawBox = $('#mRawBox');
  if (prefill?.rawText) {
    rawBox.hidden = false;
    rawBox.open = false;
    $('#mRawText').textContent = prefill.rawText;
  } else {
    rawBox.hidden = true;
    $('#mRawText').textContent = '';
  }

  updateMobileCalc();
  openModal('productSheet');

  window.requestAnimationFrame(() => {
    if (!$('#mFName').value) $('#mFName').focus();
    else if (!$('#mFDate').value) $('#mFDate').focus();
    else if (!$('#mFMonths').value) $('#mFMonths').focus();
    else if (!$('#mFQuantity').value) $('#mFQuantity').focus();
  });
}

function updateMobileCalc() {
  const production = $('#mFDate')?.value || '';
  const months = $('#mFMonths')?.value || '';
  const derived = store.computeDerived(production, months);
  const values = {
    days: derived ? `${formatNumber(derived.shelfLifeDays)} 天` : '—',
    expiry: derived ? fmtDate(derived.expiryDate) : '—',
    warning: derived ? fmtDate(derived.warningDate) : '—',
    advance: derived ? (derived.advanceDays > 0 ? `提前 ${derived.advanceDays} 天` : '不提前') : '—'
  };
  $$('#mCalcPreview [data-mcalc]').forEach((node) => {
    node.textContent = values[node.dataset.mcalc] || '—';
  });
}

function clearFormErrors() {
  $$('#mobileProductForm .m-field.has-error').forEach((field) => {
    field.classList.remove('has-error');
    field.querySelector('.m-field-error')?.remove();
  });
}

function markFormError(input, message, focus = false) {
  const field = input.closest('.m-field');
  if (!field) return;
  field.classList.add('has-error');
  let error = field.querySelector('.m-field-error');
  if (!error) {
    error = document.createElement('span');
    error.className = 'm-field-error';
    field.appendChild(error);
  }
  error.textContent = message;
  if (focus) input.focus();
}

function handleProductSubmit(event) {
  event.preventDefault();
  clearFormErrors();

  const nameInput = $('#mFName');
  const dateInput = $('#mFDate');
  const monthInput = $('#mFMonths');
  const quantityInput = $('#mFQuantity');

  const name = nameInput.value.trim();
  const productionDate = dateInput.value;
  const monthsRaw = monthInput.value.trim();
  const quantityRaw = quantityInput.value.trim();
  const months = Number(monthsRaw);
  const quantity = Number(quantityRaw);

  let firstInvalid = null;
  if (!name) {
    markFormError(nameInput, '请填写商品名称');
    firstInvalid ||= nameInput;
  }
  if (!productionDate || !parseDate(productionDate)) {
    markFormError(dateInput, '请选择有效的生产日期');
    firstInvalid ||= dateInput;
  }
  if (!monthsRaw || !Number.isFinite(months) || months <= 0 || months > 240) {
    markFormError(monthInput, '请填写 0–240 之间的保质期月数');
    firstInvalid ||= monthInput;
  }
  if (!quantityRaw || !Number.isFinite(quantity) || quantity < 0 || quantity > 999999 || !Number.isInteger(quantity)) {
    markFormError(quantityInput, '请填写 0–999999 之间的整数数量');
    firstInvalid ||= quantityInput;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  const id = $('#mFId').value;
  const input = {
    name,
    productionDate,
    shelfLifeMonths: months,
    quantity,
    status: $('#mFStatus').value,
    remark: $('#mFRemark').value.trim()
  };

  try {
    if (id) {
      store.updateProduct(id, input);
      toast('商品已更新', 'success');
    } else {
      store.addProduct(input);
      toast('商品已保存，效期已自动计算', 'success');
    }
    closeModal('productSheet');
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
    message: `确定删除 <strong>${escapeHtml(product.name)}</strong> 吗？<br>删除后无法恢复。`,
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
    toast(`「${product.name}」已移入已下架`, 'success');
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
      message: `当前已有 <strong>${count}</strong> 条商品，载入示例会替换现有数据。是否继续？`,
      okText: '载入示例',
      danger: true
    });
    if (!ok) return;
  }
  const loaded = store.loadDemoData();
  toast(`已载入 ${loaded} 条示例数据`, 'success');
  setTab('home');
}

async function handleClearData() {
  const count = store.getProducts().length;
  if (!count) {
    toast('当前没有商品数据', 'info');
    return;
  }
  const ok = await confirmAction({
    title: '清空全部数据',
    message: `确定删除全部 <strong>${count}</strong> 条商品吗？<br>此操作无法撤销，建议先导出备份。`,
    okText: '清空数据',
    danger: true
  });
  if (!ok) return;
  try {
    store.clearAllData();
    toast('已清空全部商品数据', 'success');
    setTab('home');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ========================= Excel ========================= */
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

function openImportSheet() {
  state.importData = null;
  $('#mImportFile').value = '';
  $('#mImportPreview').hidden = true;
  $('#mImportConfirmBtn').hidden = true;
  $('#mImportError').hidden = true;
  const merge = document.querySelector('input[name="mImportMode"][value="merge"]');
  if (merge) merge.checked = true;
  openModal('importSheet');
}

async function handleImportFile(file) {
  if (!file) return;
  const errorBox = $('#mImportError');
  errorBox.hidden = true;
  $('#mImportPreview').hidden = true;
  $('#mImportConfirmBtn').hidden = true;

  try {
    const result = await parseExcelFile(file);
    state.importData = result;

    const skipped = result.errorCount || 0;
    $('#mImportSummary').innerHTML = `工作表「${escapeHtml(result.sheetName)}」：<strong>${result.rows.length}</strong> 条可导入${skipped ? `，跳过 <strong>${skipped}</strong> 行` : ''}。`;
    $('#mImportList').innerHTML = result.rows.slice(0, 6).map((row) => `
      <div class="m-import-item">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${fmtDate(row.productionDate)} · ${formatNumber(row.shelfLifeMonths)} 月 · ${formatNumber(row.quantity)} 件</span>
      </div>
    `).join('');

    const warnings = $('#mImportWarnings');
    if (skipped && result.errors?.length) {
      const lines = result.errors.slice(0, 5).map((error) => `第 ${error.row} 行：${error.message}`);
      warnings.innerHTML = `${lines.map(escapeHtml).join('<br>')}${skipped > lines.length ? '<br>…' : ''}`;
      warnings.hidden = false;
    } else {
      warnings.hidden = true;
    }

    const tiersRow = $('#mImportTiersRow');
    tiersRow.hidden = !(result.tiers && result.tiers.length);
    $('#mImportTiers').checked = Boolean(result.tiers && result.tiers.length);

    $('#mImportPreview').hidden = false;
    const confirmBtn = $('#mImportConfirmBtn');
    confirmBtn.hidden = false;
    confirmBtn.textContent = `确认导入 ${result.rows.length} 条`;
    toast(`已读取 ${result.rows.length} 条商品`, 'success');
  } catch (error) {
    state.importData = null;
    errorBox.textContent = error.message || '文件解析失败';
    errorBox.hidden = false;
    toast(error.message || '文件解析失败', 'error', 5000);
  }
}

async function confirmImport() {
  const data = state.importData;
  if (!data) return;
  const mode = document.querySelector('input[name="mImportMode"]:checked')?.value || 'merge';

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

  let tiers = null;
  if (!$('#mImportTiersRow').hidden && $('#mImportTiers').checked && data.tiers) {
    const checked = store.validateTiers(data.tiers);
    if (checked.valid) tiers = checked.tiers;
    else toast(`文件中的档位设置无效，已跳过：${checked.message}`, 'warn', 4800);
  }

  try {
    const result = store.importProducts(data.rows, { mode, tiers });
    closeModal('importSheet');
    toast(`成功导入 ${result.imported} 条商品`, 'success', 4200);
    if (result.errors.length) toast(`${result.errors.length} 条商品导入失败`, 'warn');
    setTab('products', { segment: 'onsale', filter: 'all' });
  } catch (error) {
    const errorBox = $('#mImportError');
    errorBox.textContent = error.message || '导入失败';
    errorBox.hidden = false;
    toast(error.message || '导入失败', 'error');
  }
}

/* ========================= 图片选择 / 压缩 ========================= */
function pickImage(source, target) {
  state.imageTarget = target;
  const input = source === 'camera' ? $('#mCameraInput') : $('#mGalleryInput');
  if (!input) return;
  input.value = '';
  input.click();
}

async function handlePickedImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件', 'warn');
    return;
  }

  const target = state.imageTarget;
  let prepared = file;

  if (file.size > 1.5 * 1024 * 1024) {
    toast('正在处理图片…', 'info', 1600);
    prepared = await compressImageFile(file, { maxDimension: 2400, quality: 0.9 });
  }

  if (prepared.size > MAX_IMAGE_BYTES) {
    toast('图片超过 10MB，请选择更小的照片或重新拍摄', 'error', 4500);
    return;
  }

  try {
    const dataUrl = await readFileAsDataURL(prepared);
    if (target === 'table') await applyTableImage(prepared, dataUrl);
    else await applyPackageImage(prepared, dataUrl);
  } catch (error) {
    toast('图片读取失败，请换一张 JPG / PNG 图片', 'error');
  }
}

async function applyPackageImage(file, dataUrl) {
  const image = $('#pkgPreview');
  const loaded = await new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
  if (!loaded) {
    toast('当前浏览器无法读取该图片格式，请选择 JPG / PNG', 'error', 4500);
    return;
  }

  state.packageImage = file;
  $('#pkgPreviewBox').hidden = false;
  $('#pkgRecognizeBtn').disabled = false;
  $('#pkgError').hidden = true;
  $('#pkgProgress').hidden = true;
}

async function applyTableImage(file, dataUrl) {
  const image = $('#tblPreview');
  const loaded = await new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
  if (!loaded) {
    toast('当前浏览器无法读取该图片格式，请选择 JPG / PNG', 'error', 4500);
    return;
  }

  state.tableImage = file;
  state.tableRows = [];
  state.tableMeta = null;
  $('#tblPreviewBox').hidden = false;
  $('#tblRecognizeBtn').disabled = false;
  $('#tblResultBox').hidden = true;
  $('#tblImportBtn').hidden = true;
  $('#tblError').hidden = true;
  $('#tblProgress').hidden = true;
}

async function rotatePickerImage(target) {
  const file = target === 'table' ? state.tableImage : state.packageImage;
  if (!file) {
    toast('请先选择图片', 'warn');
    return;
  }
  try {
    const rotated = await rotateImageFile(file, 90);
    const dataUrl = await readFileAsDataURL(rotated);
    if (target === 'table') await applyTableImage(rotated, dataUrl);
    else await applyPackageImage(rotated, dataUrl);
    toast('图片已旋转', 'info');
  } catch (error) {
    toast(error.message || '旋转失败', 'error');
  }
}

function clearPackageImage() {
  state.packageImage = null;
  const image = $('#pkgPreview');
  if (image) image.removeAttribute('src');
  $('#pkgPreviewBox').hidden = true;
  $('#pkgRecognizeBtn').disabled = true;
  $('#pkgProgress').hidden = true;
  $('#pkgError').hidden = true;
  $('#mCameraInput').value = '';
  $('#mGalleryInput').value = '';
}

function clearTableImage() {
  state.tableImage = null;
  state.tableRows = [];
  state.tableMeta = null;
  const image = $('#tblPreview');
  if (image) image.removeAttribute('src');
  $('#tblPreviewBox').hidden = true;
  $('#tblRecognizeBtn').disabled = true;
  $('#tblProgress').hidden = true;
  $('#tblError').hidden = true;
  $('#tblResultBox').hidden = true;
  $('#tblImportBtn').hidden = true;
  const rows = $('#tblRows');
  if (rows) rows.innerHTML = '';
  const raw = $('#tblRawText');
  if (raw) raw.textContent = '';
  $('#mCameraInput').value = '';
  $('#mGalleryInput').value = '';
}

/* ========================= 包装识别 ========================= */
function openPackageSheet() {
  state.imageTarget = 'package';
  clearPackageImage();
  openModal('packageSheet');
}

async function recognizePackage() {
  if (!state.packageImage) {
    toast('请先拍照或选择包装照片', 'warn');
    return;
  }

  const button = $('#pkgRecognizeBtn');
  button.disabled = true;
  $('#pkgError').hidden = true;
  $('#pkgProgress').hidden = false;
  $('#pkgProgressBar').classList.add('indeterminate');
  $('#pkgProgressText').textContent = '正在本机识别文字，首次可能需要几秒…';

  try {
    const result = await recognizeImage(state.packageImage, { lang: 'auto' });
    const parsed = parsePackageResult(result);
    closeModal('packageSheet');
    openProductSheet(null, parsed);

    const confidence = Math.round((Number(result.average_confidence) || 0) * 100);
    toast(
      confidence ? `识别完成（${confidence}%），请核对后保存` : '识别完成，请核对后保存',
      'success',
      4200
    );
  } catch (error) {
    $('#pkgError').textContent = error.message || '识别失败';
    $('#pkgError').hidden = false;
    toast(error.message || '识别失败', 'error', 5200);
  } finally {
    $('#pkgProgress').hidden = true;
    $('#pkgProgressBar').classList.remove('indeterminate');
    button.disabled = !state.packageImage;
  }
}

/* ========================= 表格识别 ========================= */
function openTableSheet() {
  state.imageTarget = 'table';
  clearTableImage();
  openModal('tableSheet');
}

async function recognizeTable() {
  if (!state.tableImage) {
    toast('请先拍照或选择表格照片', 'warn');
    return;
  }

  const button = $('#tblRecognizeBtn');
  button.disabled = true;
  $('#tblError').hidden = true;
  $('#tblResultBox').hidden = true;
  $('#tblImportBtn').hidden = true;
  $('#tblProgress').hidden = false;
  $('#tblProgressBar').classList.add('indeterminate');
  $('#tblProgressText').textContent = '正在识别表格，请稍候…';

  try {
    const result = await recognizeImage(state.tableImage, { lang: 'auto' });
    const parsed = parseTableResult(result);
    state.tableMeta = parsed;
    state.tableRows = parsed.rows.length ? parsed.rows : [blankTableRow()];
    renderTableRows();
    $('#tblResultBox').hidden = false;

    if (parsed.rows.length) {
      toast(`识别到 ${parsed.rows.length} 行，请逐行核对`, 'success', 4200);
    } else {
      toast('没有识别到有效行，可手动添加后导入', 'warn', 4800);
    }
    if (!parsed.headerFound && parsed.rows.length) {
      toast('未识别到表头，已按位置推测，请仔细核对', 'warn', 4500);
    }
  } catch (error) {
    $('#tblError').textContent = error.message || '识别失败';
    $('#tblError').hidden = false;
    toast(error.message || '识别失败', 'error', 5200);
  } finally {
    $('#tblProgress').hidden = true;
    $('#tblProgressBar').classList.remove('indeterminate');
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

function renderTableRows() {
  const container = $('#tblRows');
  if (!container) return;

  container.innerHTML = state.tableRows.map((row, index) => {
    const valid = validateTableRow(row).valid;
    return `
      <div class="m-ocr-row ${valid ? '' : 'invalid'}" data-row-index="${index}">
        <div class="m-ocr-row-head">
          <span>第 ${index + 1} 行</span>
          <button type="button" data-action="remove-table-row" data-index="${index}">删除</button>
        </div>
        <label class="m-field">
          <span>商品名称</span>
          <input type="text" data-field="name" value="${escapeHtml(row.name)}" placeholder="商品名称">
        </label>
        <div class="m-row-grid">
          <label class="m-field">
            <span>生产日期</span>
            <input type="text" data-field="productionDate" value="${escapeHtml(row.productionDate)}" placeholder="YYYY/MM/DD">
          </label>
          <label class="m-field">
            <span>保质期（月）</span>
            <input type="text" data-field="shelfLifeMonths" value="${escapeHtml(row.shelfLifeMonths)}" placeholder="6" inputmode="decimal">
          </label>
          <label class="m-field">
            <span>数量</span>
            <input type="text" data-field="quantity" value="${escapeHtml(row.quantity)}" placeholder="10" inputmode="numeric">
          </label>
        </div>
        <label class="m-field">
          <span>备注</span>
          <input type="text" data-field="remark" value="${escapeHtml(row.remark)}" placeholder="选填">
        </label>
      </div>
    `;
  }).join('');

  updateTableFooter();
  $('#tblRawText').textContent = state.tableMeta?.rawText || '';
}

function updateTableFooter() {
  const validCount = state.tableRows.filter((row) => validateTableRow(row).valid).length;
  const summary = $('#tblSummary');
  if (summary) {
    summary.textContent = `${state.tableRows.length} 行 · ${validCount} 行可导入${state.tableMeta && !state.tableMeta.headerFound ? ' · 未识别到表头' : ''}`;
  }
  const button = $('#tblImportBtn');
  if (button) {
    button.hidden = !state.tableImage && state.tableRows.length === 0;
    button.textContent = validCount ? `导入 ${validCount} 条` : '请补全数据后导入';
    button.disabled = validCount === 0;
  }
}

function updateTableRowValidity() {
  $$('#tblRows .m-ocr-row').forEach((rowEl) => {
    const index = Number(rowEl.dataset.rowIndex);
    const row = state.tableRows[index];
    if (!row) return;
    rowEl.classList.toggle('invalid', !validateTableRow(row).valid);
  });
  updateTableFooter();
}

async function importTableRows() {
  const validRows = state.tableRows.filter((row) => validateTableRow(row).valid);
  const skipped = state.tableRows.length - validRows.length;

  if (!validRows.length) {
    toast('没有可导入的有效行，请补全名称、日期、保质期和数量', 'error', 4800);
    return;
  }
  if (skipped > 0) {
    const ok = await confirmAction({
      title: '部分数据不完整',
      message: `有 <strong>${skipped}</strong> 行不完整，将被跳过。继续导入 <strong>${validRows.length}</strong> 条吗？`,
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
    closeModal('tableSheet');
    toast(`已导入 ${result.imported} 条商品`, 'success', 4200);
    if (result.errors.length) toast(`${result.errors.length} 条导入失败`, 'warn');
    setTab('products', { segment: 'onsale', filter: 'all' });
  } catch (error) {
    toast(error.message || '导入失败', 'error');
  }
}

/* ========================= 档位设置 ========================= */
function readTierInputs() {
  return $$('#mTierRows [data-tier-row]').map((row) => {
    const read = (field) => {
      const input = row.querySelector(`[data-tier="${field}"]`);
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
  const rows = $$('#mTierRows [data-tier-row]');
  const lastInputs = rows.length ? rows[rows.length - 1].querySelectorAll('[data-tier]') : [];
  const lastMax = lastInputs.length ? Number(lastInputs[1].value) : 0;
  const lastAdvance = lastInputs.length ? Number(lastInputs[2].value) : 15;
  const tier = {
    min: Number.isFinite(lastMax) ? lastMax + 1 : 0,
    max: Number.isFinite(lastMax) ? lastMax + 30 : 30,
    advanceDays: Number.isFinite(lastAdvance) ? lastAdvance : 15
  };
  $('#mTierRows').insertAdjacentHTML('beforeend', renderTierRow(tier, rows.length));
  $('#mTierRows [data-tier-row]:last-child [data-tier="min"]')?.focus();
}

function saveTiersFromForm() {
  const tiers = readTierInputs();
  try {
    store.saveTiers(tiers);
    toast('档位已保存，商品效期已重新计算', 'success', 4200);
  } catch (error) {
    toast(error.message || '档位设置无效', 'error', 5200);
  }
}

async function resetTiers() {
  const ok = await confirmAction({
    title: '恢复默认档位',
    message: '恢复默认的 6 档规则，并重新计算所有商品的临期下架日。',
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

/* ========================= 事件 ========================= */
function bindEvents() {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('input', handleDocumentInput);
  document.addEventListener('change', handleDocumentChange);

  $('#mobileProductForm')?.addEventListener('submit', handleProductSubmit);

  $('#mCameraInput')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) handlePickedImage(file);
  });
  $('#mGalleryInput')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) handlePickedImage(file);
  });

  $('#mImportFile')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) handleImportFile(file);
  });

  ['packageSheet', 'tableSheet', 'importSheet'].forEach((id) => {
    document.getElementById(id)?.addEventListener('modal:closed', () => {
      if (id === 'packageSheet') clearPackageImage();
      if (id === 'tableSheet') clearTableImage();
      if (id === 'importSheet') {
        state.importData = null;
        $('#mImportPreview').hidden = true;
        $('#mImportConfirmBtn').hidden = true;
        $('#mImportError').hidden = true;
        $('#mImportFile').value = '';
      }
    });
  });

  window.addEventListener('hashchange', () => {
    const previous = state.tab;
    resolveRoute();
    render();
    if (previous !== state.tab) window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith('snack-expiry-manager')) {
      store.reloadFromStorage();
      toast('检测到其他标签页的数据更新', 'info');
    }
  });

  store.subscribe(() => render());
}

function handleDocumentClick(event) {
  const tabButton = event.target.closest('[data-mtab]');
  if (tabButton) {
    setTab(tabButton.dataset.mtab);
    return;
  }

  const navTarget = event.target.closest('[data-mnav]');
  if (navTarget) {
    const tab = navTarget.dataset.mnav;
    const segment = navTarget.dataset.segment || null;
    const filter = navTarget.dataset.filter || null;
    setTab(tab, { segment, filter });
    return;
  }

  const segmentButton = event.target.closest('[data-msegment]');
  if (segmentButton) {
    state.segment = segmentButton.dataset.msegment;
    state.filter = 'all';
    state.search = '';
    render();
    return;
  }

  const filterChip = event.target.closest('[data-mfilter]');
  if (filterChip) {
    state.filter = filterChip.dataset.mfilter;
    render();
    return;
  }

  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  const id = actionTarget.dataset.id;

  switch (action) {
    case 'add-product':
      openProductSheet();
      break;
    case 'detail': {
      const product = store.getProduct(id);
      if (product) openProductSheet(product);
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
    case 'open-package':
      openPackageSheet();
      break;
    case 'open-table':
      openTableSheet();
      break;
    case 'pick-camera':
      pickImage('camera', actionTarget.dataset.target || 'package');
      break;
    case 'pick-gallery':
      pickImage('gallery', actionTarget.dataset.target || 'package');
      break;
    case 'rotate-image':
      rotatePickerImage(actionTarget.dataset.target === 'table' ? 'table' : 'package');
      break;
    case 'clear-image':
      if (actionTarget.dataset.target === 'table') clearTableImage();
      else clearPackageImage();
      break;
    case 'recognize-package':
      recognizePackage();
      break;
    case 'recognize-table':
      recognizeTable();
      break;
    case 'table-add-row': {
      state.tableRows.push(blankTableRow());
      renderTableRows();
      const rows = $$('#tblRows .m-ocr-row');
      rows[rows.length - 1]?.querySelector('[data-field="name"]')?.focus();
      break;
    }
    case 'remove-table-row': {
      const index = Number(actionTarget.dataset.index);
      state.tableRows.splice(index, 1);
      renderTableRows();
      break;
    }
    case 'import-table':
      importTableRows();
      break;
    case 'import-excel':
      openImportSheet();
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
      toast('已设置 7 天后再提醒', 'info');
      break;
    case 'load-demo':
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
      const rows = $$('#mTierRows [data-tier-row]');
      if (rows.length <= 1) {
        toast('至少需要保留一个档位', 'warn');
        break;
      }
      actionTarget.closest('[data-tier-row]')?.remove();
      break;
    }
    case 'reset-tiers':
      resetTiers();
      break;
    case 'check-ocr':
      refreshOcrStatus(true);
      break;
    case 'copy-url':
      copyCurrentUrl();
      break;
    case 'clear-filters':
      state.search = '';
      state.filter = 'all';
      render();
      break;
    default:
      break;
  }
}

function handleDocumentInput(event) {
  const target = event.target;

  if (target.id === 'mSearch') {
    const caret = target.selectionStart;
    state.search = target.value;
    render();
    const next = $('#mSearch');
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

  if (target.closest('#mobileProductForm')) {
    if (target.id === 'mFDate' || target.id === 'mFMonths') updateMobileCalc();
    const field = target.closest('.m-field');
    if (field?.classList.contains('has-error')) {
      field.classList.remove('has-error');
      field.querySelector('.m-field-error')?.remove();
    }
    return;
  }

  if (target.closest('#tblRows')) {
    const rowEl = target.closest('.m-ocr-row');
    const index = Number(rowEl?.dataset.rowIndex);
    const field = target.dataset.field;
    if (!Number.isInteger(index) || !field || !state.tableRows[index]) return;
    state.tableRows[index][field] = target.value;
    updateTableRowValidity();
  }
}

function handleDocumentChange(event) {
  const target = event.target;

  if (target.id === 'mSort') {
    state.sort = target.value;
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

async function copyCurrentUrl() {
  const url = window.location.href;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    toast('地址已复制', 'success');
  } catch (error) {
    toast('复制失败，请长按地址栏手动复制', 'warn');
  }
}

init();
