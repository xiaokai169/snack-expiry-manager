/* =========================================================
   页面视图渲染（纯字符串模板）
   ========================================================= */
import {
  escapeHtml,
  fmtDate,
  formatCnDate,
  formatDateTime,
  formatNumber
} from './utils.js';
import {
  getBackupInfo,
  getProductMeta,
  getProducts,
  getSettings,
  getStats,
  getWarningProducts
} from './store.js';
import { emptyState, icon, remainingBadge, statusBadge } from './ui.js';
import { donutChart, groupedBarChart, horizontalBars } from './charts.js';

/* ========================= 首页 ========================= */
export function renderHome(container) {
  const products = getProducts();
  const stats = getStats();
  const warnings = getWarningProducts();
  const backup = getBackupInfo();
  const isEmpty = products.length === 0;

  const warningHtml = warnings.length
    ? `<div class="warning-list">${warnings.map(renderWarningRow).join('')}</div>`
    : `<div class="warning-empty">
         <span class="empty-orb">${icon('check')}</span>
         <div>
           <strong>${isEmpty ? '还没有商品数据' : '暂无需要处理的临期商品'}</strong>
           <p>${isEmpty ? '先录入第一件商品，系统会自动计算到期日与临期下架日。' : '所有在售商品的临期下架日都还没到，继续保持。'}</p>
         </div>
       </div>`;

  container.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">TODAY · ${escapeHtml(formatCnDate(new Date()))}</p>
        <h1>${isEmpty ? '欢迎使用零食效期管家' : '今日效期概览'}</h1>
        <p class="sub">${isEmpty
          ? '把纸质表格搬到电脑上：自动算效期、临期自动提醒、每周导出备份。'
          : '先处理置顶的临期商品，再录入新到的货，今天的效期检查就完成了。'}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" data-action="import-excel">${icon('upload')}导入 Excel</button>
        <button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')}手动新增</button>
      </div>
    </section>

    <section class="card warning-card page-block">
      <div class="card-head">
        <div>
          <h2>${icon('warning')}即将到期商品 <span class="count-pill">${warnings.length}</span></h2>
          <p class="sub">临期下架日已到的商品会自动置顶，越紧迫越靠前</p>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" data-nav="onsale" data-filter-warning="1">
          查看在售列表 ${icon('chevron')}
        </button>
      </div>
      ${warningHtml}
    </section>

    ${backup.due ? renderBackupBanner(backup) : ''}

    <div class="stat-grid">
      ${renderStatCard({
        iconName: 'box',
        label: '在售商品',
        value: stats.onSaleKinds,
        unit: '种',
        note: `合计 ${formatNumber(stats.onSaleQuantity)} 件库存`,
        nav: 'onsale'
      })}
      ${renderStatCard({
        iconName: 'clock',
        label: '临期预警',
        value: stats.warningKinds,
        unit: '种',
        note: stats.expiredKinds > 0 ? `${stats.expiredKinds} 种已过期，请尽快处理` : '临期下架日已到的商品',
        nav: 'onsale',
        extraAction: 'data-filter-warning="1"',
        tone: stats.expiredKinds > 0 ? 'alert' : 'warn'
      })}
      ${renderStatCard({
        iconName: 'archive',
        label: '已下架',
        value: stats.offShelfKinds,
        unit: '种',
        note: `本月下架 ${stats.offThisMonth} 种 · 共 ${formatNumber(stats.offShelfQuantity)} 件`,
        nav: 'offshelf',
        tone: 'gray'
      })}
      ${renderStatCard({
        iconName: 'chart',
        label: '全部商品',
        value: stats.totalKinds,
        unit: '条',
        note: '数据自动保存在本机浏览器',
        nav: 'stats',
        tone: 'green'
      })}
    </div>

    ${isEmpty ? renderOnboarding() : ''}

    <section class="card quick-card page-block">
      <h2>快捷操作</h2>
      <p class="sub">常用入口集中在这里，核心操作不超过 3 步</p>
      <div class="quick-grid">
        ${renderQuickAction('plus', '手动新增', '填写表单，自动算效期', 'add-product')}
        ${renderQuickAction('camera', '拍照识别包装', '识别名称、日期、保质期', 'open-ocr')}
        ${renderQuickAction('table', '识别手写表格', '拍照批量导入旧表格', 'open-table-ocr')}
        ${renderQuickAction('upload', '导入 Excel', '从备份文件恢复数据', 'import-excel')}
        ${renderQuickAction('download', '导出 Excel', '备份数据，离线可查看', 'export-excel')}
      </div>
    </section>
  `;
}

function renderStatCard({ iconName, label, value, unit, note, nav, tone = '', extraAction = '' }) {
  return `
    <button type="button" class="stat-card ${tone}" data-nav="${nav}" ${extraAction}>
      <span class="stat-icon ${tone === 'alert' ? 'red' : tone === 'gray' ? 'gray' : tone === 'green' ? 'green' : ''}">${icon(iconName)}</span>
      <span class="stat-body">
        <span class="stat-label">${escapeHtml(label)}</span>
        <span class="stat-value">${formatNumber(value)} <small>${escapeHtml(unit)}</small></span>
        <span class="stat-note">${escapeHtml(note)}</span>
      </span>
    </button>
  `;
}

function renderWarningRow(product) {
  const meta = getProductMeta(product);
  const days = meta.remainingDays ?? 0;
  const bigNumber = days < 0 ? Math.abs(days) : days;
  const dayLabel = days < 0 ? '已过期（天）' : days === 0 ? '今天到期' : '剩余天数';

  return `
    <div class="warning-row ${meta.expired ? 'is-expired' : ''}">
      <div class="warning-main">
        <span class="warning-dot"></span>
        <div class="warning-name">
          <strong title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</strong>
          <small>生产 ${fmtDate(product.productionDate)} · 保质期 ${formatNumber(product.shelfLifeMonths)} 个月${product.remark ? ` · ${escapeHtml(product.remark)}` : ''}</small>
        </div>
      </div>
      <div class="warning-days">
        <strong>${bigNumber}</strong>
        <span>${dayLabel}</span>
      </div>
      <div class="warning-meta">
        <span>到期日 <b>${fmtDate(product.expiryDate)}</b></span>
        <span>临期下架日 <b>${fmtDate(product.warningDate)}</b></span>
        <span>数量 <b>${formatNumber(product.quantity)}</b></span>
      </div>
      <div class="warning-actions">
        <button type="button" class="btn btn-sm btn-soft" data-action="offshelf" data-id="${product.id}">标记下架</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="detail" data-id="${product.id}">查看详情</button>
      </div>
    </div>
  `;
}

function renderBackupBanner(backup) {
  const text = backup.daysSinceBackup === null
    ? '还没有导出过备份。数据只保存在本机浏览器，误清缓存可能导致丢失。'
    : `距上次导出备份已 ${backup.daysSinceBackup} 天。建议每周导出一次 Excel 备份。`;

  return `
    <div class="backup-banner">
      <span class="icon-box">${icon('download')}</span>
      <div>
        <strong>建议导出一份数据备份</strong>
        <p>${escapeHtml(text)}</p>
      </div>
      <div class="banner-actions">
        <button type="button" class="btn btn-sm btn-primary" data-action="export-excel">立即导出</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="dismiss-backup">7 天后再提醒</button>
      </div>
    </div>
  `;
}

function renderQuickAction(iconName, title, sub, action) {
  return `
    <button type="button" class="quick-action" data-action="${action}">
      <span class="qa-icon">${icon(iconName)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(sub)}</small>
    </button>
  `;
}

function renderOnboarding() {
  return `
    <section class="card page-block">
      <div class="empty-state">
        <span class="empty-orb">${icon('snack')}</span>
        <h3>先把货架搬进电脑</h3>
        <p>可以手动录入第一件商品，也可以载入示例数据先体验完整流程。数据只保存在本机浏览器。</p>
        <div class="empty-actions">
          <button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')}新增第一件商品</button>
          <button type="button" class="btn btn-ghost" data-action="load-demo-home">载入示例数据</button>
          <button type="button" class="btn btn-ghost" data-action="import-excel">${icon('upload')}导入 Excel</button>
        </div>
      </div>
    </section>
  `;
}

/* ========================= 在售商品 ========================= */
export function renderOnSale(container, filters, focusSearch = false) {
  const allProducts = getProducts();
  const onSale = allProducts.filter((product) => product.status !== '已下架');
  const search = (filters.search || '').trim().toLowerCase();

  let list = onSale.filter((product) => {
    if (search) {
      const haystack = `${product.name} ${product.remark || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.status && filters.status !== 'all' && product.status !== filters.status) return false;
    if (filters.warningOnly) {
      const meta = getProductMeta(product);
      if (!meta.warning) return false;
    }
    return true;
  });

  list = sortProducts(list, filters.sort || 'expiry');
  const totalQuantity = list.reduce((sum, product) => sum + (Number(product.quantity) || 0), 0);
  const hasFilter = Boolean(search) || (filters.status && filters.status !== 'all') || filters.warningOnly;

  const body = list.map(renderOnSaleRow).join('');

  container.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">IN STOCK</p>
        <h1>在售商品</h1>
        <p class="sub">临期下架日已到的商品会标红高亮；点击「标记下架」后自动移入已下架区域。</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" data-action="export-excel">${icon('download')}导出</button>
        <button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')}新增商品</button>
      </div>
    </section>

    <section class="card list-card">
      <div class="toolbar">
        <div class="search-box">
          ${icon('search')}
          <input type="search" id="saleSearch" value="${escapeHtml(filters.search || '')}" placeholder="搜索商品名称 / 备注" autocomplete="off" ${focusSearch ? 'data-autofocus="1"' : ''}>
        </div>
        <select id="saleStatusFilter" aria-label="按状态筛选">
          <option value="all" ${filters.status === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="未下架" ${filters.status === '未下架' ? 'selected' : ''}>未下架</option>
          <option value="无需下架" ${filters.status === '无需下架' ? 'selected' : ''}>无需下架</option>
        </select>
        <select id="saleWarningFilter" aria-label="按临期筛选">
          <option value="all" ${!filters.warningOnly ? 'selected' : ''}>全部商品</option>
          <option value="warning" ${filters.warningOnly ? 'selected' : ''}>仅看临期</option>
        </select>
        <select id="saleSort" aria-label="排序方式">
          <option value="expiry" ${filters.sort === 'expiry' ? 'selected' : ''}>按到期日最近</option>
          <option value="newest" ${filters.sort === 'newest' ? 'selected' : ''}>按录入时间最新</option>
          <option value="quantity" ${filters.sort === 'quantity' ? 'selected' : ''}>按数量最多</option>
          <option value="name" ${filters.sort === 'name' ? 'selected' : ''}>按名称排序</option>
        </select>
        <span class="result-count">共 <b>${list.length}</b> 种 · <b>${formatNumber(totalQuantity)}</b> 件</span>
      </div>

      ${list.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-seq">序号</th>
                <th>商品名称</th>
                <th>生产日期</th>
                <th>保质期（月）</th>
                <th>保质期（天）</th>
                <th>到期日</th>
                <th>临期下架日</th>
                <th>剩余天数</th>
                <th>数量</th>
                <th>状态</th>
                <th>备注</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <div class="table-foot">
          <span>提示：深红色行为已过期，浅红色行为已进入临期下架期。</span>
          <span>共 ${list.length} 种 / ${formatNumber(totalQuantity)} 件</span>
        </div>
      ` : (hasFilter
        ? emptyState({
          iconName: 'search',
          title: '没有符合条件的商品',
          description: '试试更换关键词或筛选条件。',
          actions: '<button type="button" class="btn btn-ghost" data-action="clear-sale-filters">清除筛选</button>'
        })
        : emptyState({
          iconName: 'box',
          title: '在售货架还是空的',
          description: '手动新增商品，或从 Excel / 表格照片批量导入。',
          actions: `
            <button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')}新增商品</button>
            <button type="button" class="btn btn-ghost" data-action="import-excel">${icon('upload')}导入 Excel</button>
          `
        })
      )}
    </section>
  `;
}

function renderOnSaleRow(product) {
  const meta = getProductMeta(product);
  const rowClass = meta.expired ? 'row-expired' : meta.warning ? 'row-warning' : '';
  const offShelfLabel = product.status === '无需下架' ? '标记下架' : '标记下架';

  return `
    <tr class="${rowClass}">
      <td class="col-seq cell-num">${product.seq}</td>
      <td class="cell-name">
        <strong title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</strong>
        <small>录入 ${formatDateTime(product.createdAt)}</small>
      </td>
      <td class="cell-num">${fmtDate(product.productionDate)}</td>
      <td class="cell-num">${formatNumber(product.shelfLifeMonths)}</td>
      <td class="cell-num">${formatNumber(product.shelfLifeDays)} 天</td>
      <td class="cell-num">${fmtDate(product.expiryDate)}</td>
      <td class="cell-num">${fmtDate(product.warningDate)}</td>
      <td>${remainingBadge(product, meta)}</td>
      <td class="cell-num">${formatNumber(product.quantity)}</td>
      <td>${statusBadge(product.status)}</td>
      <td class="cell-muted" title="${escapeHtml(product.remark || '')}">${escapeHtml(product.remark || '—')}</td>
      <td>
        <div class="cell-actions">
          <button type="button" class="btn" data-action="detail" data-id="${product.id}">${icon('edit')}编辑</button>
          <button type="button" class="btn warn" data-action="offshelf" data-id="${product.id}">${offShelfLabel}</button>
          <button type="button" class="btn danger" data-action="delete" data-id="${product.id}" title="删除">${icon('trash')}</button>
        </div>
      </td>
    </tr>
  `;
}

function sortProducts(list, sort) {
  const copy = [...list];
  if (sort === 'newest') {
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

/* ========================= 已下架 ========================= */
export function renderOffShelf(container, filters, focusSearch = false) {
  const products = getProducts().filter((product) => product.status === '已下架');
  const search = (filters.search || '').trim().toLowerCase();
  const list = products
    .filter((product) => {
      if (!search) return true;
      return `${product.name} ${product.remark || ''}`.toLowerCase().includes(search);
    })
    .sort((a, b) => {
      const aTime = a.offShelfAt || a.updatedAt;
      const bTime = b.offShelfAt || b.updatedAt;
      return bTime.localeCompare(aTime);
    });

  container.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">OFF SHELF</p>
        <h1>已下架商品</h1>
        <p class="sub">已下架的商品不计入在售库存与临期预警，可随时恢复到在售状态。</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" data-nav="onsale">${icon('chevron')}返回在售</button>
        <button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')}新增商品</button>
      </div>
    </section>

    <section class="card list-card">
      <div class="toolbar">
        <div class="search-box">
          ${icon('search')}
          <input type="search" id="offSearch" value="${escapeHtml(filters.search || '')}" placeholder="搜索已下架商品" autocomplete="off" ${focusSearch ? 'data-autofocus="1"' : ''}>
        </div>
        <span class="spacer"></span>
        <span class="result-count">共 <b>${list.length}</b> 种 · <b>${formatNumber(list.reduce((sum, item) => sum + item.quantity, 0))}</b> 件</span>
      </div>

      ${list.length ? `
        <div class="table-wrap">
          <table class="data-table" style="min-width:860px">
            <thead>
              <tr>
                <th class="col-seq">序号</th>
                <th>商品名称</th>
                <th>生产日期</th>
                <th>保质期（月）</th>
                <th>到期日</th>
                <th>数量</th>
                <th>下架时间</th>
                <th>备注</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(renderOffShelfRow).join('')}
            </tbody>
          </table>
        </div>
        <div class="table-foot">
          <span>恢复后商品会回到「在售商品」，并重新参与临期预警。</span>
          <span>共 ${list.length} 种</span>
        </div>
      ` : emptyState({
        iconName: 'archive',
        title: search ? '没有找到匹配的商品' : '还没有已下架的商品',
        description: search ? '试试更换关键词。' : '在售商品标记下架后，会自动出现在这里。',
        actions: search
          ? '<button type="button" class="btn btn-ghost" data-action="clear-off-filters">清除搜索</button>'
          : '<button type="button" class="btn btn-ghost" data-nav="onsale">去在售商品看看</button>'
      })}
    </section>
  `;
}

function renderOffShelfRow(product) {
  return `
    <tr>
      <td class="col-seq cell-num">${product.seq}</td>
      <td class="cell-name">
        <strong title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</strong>
        <small>录入 ${formatDateTime(product.createdAt)}</small>
      </td>
      <td class="cell-num">${fmtDate(product.productionDate)}</td>
      <td class="cell-num">${formatNumber(product.shelfLifeMonths)}</td>
      <td class="cell-num">${fmtDate(product.expiryDate)}</td>
      <td class="cell-num">${formatNumber(product.quantity)}</td>
      <td class="cell-muted">${formatDateTime(product.offShelfAt || product.updatedAt)}</td>
      <td class="cell-muted" title="${escapeHtml(product.remark || '')}">${escapeHtml(product.remark || '—')}</td>
      <td>
        <div class="cell-actions">
          <button type="button" class="btn" data-action="restore" data-id="${product.id}">${icon('restore')}恢复在售</button>
          <button type="button" class="btn danger" data-action="delete" data-id="${product.id}">${icon('trash')}删除</button>
        </div>
      </td>
    </tr>
  `;
}

/* ========================= 数据统计 ========================= */
export function renderStats(container) {
  const stats = getStats();
  const products = getProducts();

  if (!products.length) {
    container.innerHTML = `
      <section class="page-head">
        <div>
          <p class="eyebrow">ANALYTICS</p>
          <h1>数据统计</h1>
          <p class="sub">库存、临期分布、下架情况和入库趋势一目了然。</p>
        </div>
      </section>
      <section class="card">
        ${emptyState({
          iconName: 'chart',
          title: '还没有可统计的数据',
          description: '录入商品后，这里会自动生成库存总览和临期分布图表。',
          actions: `
            <button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')}新增商品</button>
            <button type="button" class="btn btn-ghost" data-action="load-demo-home">载入示例数据</button>
          `
        })}
      </section>
    `;
    return;
  }

  const dist = stats.distribution;
  const distributionRows = [
    { label: '已过期', value: dist.expired, color: '#dc2626' },
    { label: '7 天内', value: dist.within7, color: '#f97316' },
    { label: '8–15 天', value: dist.within15, color: '#f59e0b' },
    { label: '16–30 天', value: dist.within30, color: '#eab308' },
    { label: '30 天以上', value: dist.safe, color: '#22c55e' }
  ];

  const checkedKinds = distributionRows.reduce((sum, row) => sum + row.value, 0);

  container.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">ANALYTICS</p>
        <h1>数据统计</h1>
        <p class="sub">所有统计均基于当前本机数据实时计算，不联网、不上传。</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" data-action="export-excel">${icon('download')}导出数据</button>
      </div>
    </section>

    <div class="stat-grid">
      ${renderStatCard({
        iconName: 'box', label: '在售商品', value: stats.onSaleKinds, unit: '种',
        note: `合计 ${formatNumber(stats.onSaleQuantity)} 件库存`, nav: 'onsale'
      })}
      ${renderStatCard({
        iconName: 'clock', label: '临期商品', value: stats.warningKinds, unit: '种',
        note: `其中 ${stats.expiredKinds} 种已过期`, nav: 'onsale', extraAction: 'data-filter-warning="1"',
        tone: stats.expiredKinds > 0 ? 'alert' : 'warn'
      })}
      ${renderStatCard({
        iconName: 'archive', label: '已下架', value: stats.offShelfKinds, unit: '种',
        note: `共 ${formatNumber(stats.offShelfQuantity)} 件`, nav: 'offshelf', tone: 'gray'
      })}
      ${renderStatCard({
        iconName: 'chart', label: '累计录入', value: stats.totalKinds, unit: '条',
        note: `本月下架 ${stats.offThisMonth} 种`, nav: 'onsale', tone: 'green'
      })}
    </div>

    <div class="charts-grid">
      <section class="card chart-card">
        <h2>临期分布</h2>
        <p class="card-sub">按距离到期日的天数分组统计在售商品</p>
        <div class="chart-body">
          ${horizontalBars(distributionRows)}
          <p class="chart-note">统计范围：状态为「未下架」的商品，共 ${checkedKinds} 种。状态「无需下架」不参与临期统计。</p>
        </div>
      </section>

      <section class="card chart-card">
        <h2>商品状态分布</h2>
        <p class="card-sub">在售与已下架商品占比</p>
        <div class="chart-body">
          ${donutChart(stats.statusDistribution, { centerLabel: '商品总数' })}
          <p class="chart-note">未下架 = 在售且参与临期预警；无需下架 = 在售但不预警。</p>
        </div>
      </section>

      <section class="card chart-card">
        <h2>下架统计</h2>
        <p class="card-sub">已下架商品数量与下架节奏</p>
        <div class="chart-body">
          <div class="mini-stats" style="margin-top:0">
            <div class="mini-stat danger">
              <span>已下架种类</span>
              <strong>${stats.offShelfKinds}</strong>
              <small>当前在库</small>
            </div>
            <div class="mini-stat">
              <span>已下架数量</span>
              <strong>${formatNumber(stats.offShelfQuantity)}</strong>
              <small>件</small>
            </div>
            <div class="mini-stat accent">
              <span>本月下架</span>
              <strong>${stats.offThisMonth}</strong>
              <small>种</small>
            </div>
          </div>
          <p class="chart-note">「本月下架」按下架时间统计，含已恢复在售的历史下架记录。</p>
        </div>
      </section>

      <section class="card chart-card">
        <h2>临期处理建议</h2>
        <p class="card-sub">按当前数据自动生成</p>
        <div class="chart-body">
          <div class="inline-note ${stats.warningKinds ? 'warn' : 'success'}" style="margin-top:0">
            ${stats.warningKinds
              ? `当前有 <strong>${stats.warningKinds}</strong> 种商品进入临期下架期，其中 <strong>${stats.expiredKinds}</strong> 种已过期。建议优先处理已过期商品，并核对临期商品库存。`
              : '当前没有临期商品，货架状态良好。继续保持每日检查即可。'}
          </div>
          <div class="mini-stats">
            <div class="mini-stat">
              <span>7 天内到期</span>
              <strong>${dist.within7}</strong>
              <small>种</small>
            </div>
            <div class="mini-stat">
              <span>15 天内到期</span>
              <strong>${dist.within7 + dist.within15}</strong>
              <small>种</small>
            </div>
            <div class="mini-stat danger">
              <span>已过期</span>
              <strong>${dist.expired}</strong>
              <small>种</small>
            </div>
          </div>
        </div>
      </section>

      <section class="card chart-card span-2">
        <h2>近 6 个月入库 / 下架趋势</h2>
        <p class="card-sub">新入库按录入时间统计，下架按下架时间统计，用于观察进货与下架节奏</p>
        <div class="chart-body">
          ${groupedBarChart(stats.trend)}
        </div>
      </section>
    </div>
  `;
}

/* ========================= 设置 ========================= */
export function renderSettings(container, ocrStatus, mobileAccess = null) {
  const settings = getSettings();
  const backup = getBackupInfo();
  const products = getProducts();
  const tiers = settings.warningTiers;

  const serviceClass = ocrStatus.state === 'ok' ? 'ok' : ocrStatus.state === 'bad' ? 'bad' : '';
  const serviceText = ocrStatus.state === 'ok'
    ? `识别服务已连接${ocrStatus.version ? ` · PaddleOCR ${escapeHtml(ocrStatus.version)}` : ''}`
    : ocrStatus.state === 'checking'
      ? '正在检测识别服务…'
      : `识别服务未连接${ocrStatus.message ? ` · ${escapeHtml(ocrStatus.message)}` : ''}`;

  const mobileUrl = mobileAccess?.mobileUrl || '';
  const mobileLoading = Boolean(mobileAccess?.loading);
  const lanEnabled = mobileAccess?.lanEnabled !== false;
  const mobileUrlText = !lanEnabled
    ? '当前仅本机可访问'
    : mobileUrl || (mobileLoading ? '正在获取局域网地址…' : '请使用 http://电脑IP:8765/mobile');
  const mobileHint = !lanEnabled
    ? '当前服务仅监听本机（127.0.0.1），手机无法访问。请用 start.bat 默认方式启动，或加上 --host 0.0.0.0。'
    : mobileUrl
      ? '手机与电脑需连接同一个 Wi-Fi。首次访问若打不开，请在 Windows 防火墙中允许 Python。移动端数据保存在手机浏览器，可通过 Excel 导入导出与电脑互传。'
      : mobileLoading
        ? '正在获取本机局域网地址…'
        : '未能自动获取局域网地址，请手动使用 http://电脑IP:8765/mobile 访问（启动服务的命令行窗口会显示地址）。';

  container.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">SETTINGS</p>
        <h1>设置</h1>
        <p class="sub">调整临期下架规则、管理数据备份，并查看识别服务状态。</p>
      </div>
    </section>

    <div class="settings-grid">
      <section class="card settings-card">
        <h2>${icon('clock')}临期下架档位</h2>
        <p class="card-sub">根据「保质期（天）」所在的区间，自动提前相应天数标记临期。保存后会重新计算所有商品。</p>
        <div class="card-body">
          <table class="tier-table">
            <thead>
              <tr>
                <th>保质期下限（天）</th>
                <th>上限（含，天）</th>
                <th>提前下架（天）</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tierRows">
              ${tiers.map(renderTierRow).join('')}
            </tbody>
          </table>
          <div class="tier-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-action="add-tier">${icon('plus')}添加档位</button>
            <span class="spacer"></span>
            <button type="button" class="btn btn-sm btn-ghost" data-action="reset-tiers">恢复默认</button>
            <button type="button" class="btn btn-sm btn-primary" data-action="save-tiers">保存档位</button>
          </div>
          <div class="inline-note" style="margin-top:12px">
            默认规则：保质期 0–3 天不提前，4–10 天提前 1 天，11–30 天提前 2 天，31–60 天提前 5 天，61–180 天提前 7 天，181 天以上提前 15 天。
          </div>
        </div>
      </section>

      <section class="card settings-card">
        <h2>${icon('download')}数据备份</h2>
        <p class="card-sub">数据保存在浏览器 LocalStorage 中，清理浏览器数据会导致丢失。</p>
        <div class="card-body">
          <div class="info-grid">
            <div class="info-item">
              <span>上次导出备份</span>
              <strong>${backup.lastBackupAt ? formatDateTime(backup.lastBackupAt) : '还没有导出过'}</strong>
            </div>
            <div class="info-item">
              <span>当前商品数据</span>
              <strong>${products.length} 条</strong>
            </div>
          </div>

          <div class="switch-row" style="margin-top:6px">
            <div>
              <strong>每周备份提醒</strong>
              <small>超过 7 天未导出时，在首页提醒一次</small>
            </div>
            <label class="switch">
              <input type="checkbox" data-action="toggle-reminder" aria-label="每周备份提醒" ${settings.backupReminder ? 'checked' : ''}>
              <i></i>
            </label>
          </div>

          <div class="tier-actions">
            <button type="button" class="btn btn-sm btn-primary" data-action="export-excel">${icon('download')}导出 Excel</button>
            <button type="button" class="btn btn-sm btn-ghost" data-action="import-excel">${icon('upload')}导入 Excel</button>
            <button type="button" class="btn btn-sm btn-ghost" data-action="download-template">下载模板</button>
          </div>
          <p class="chart-note">导出的 Excel 包含「商品数据」和「档位设置」两个工作表，可重新导入恢复。</p>
        </div>
      </section>

      <section class="card settings-card">
        <h2>${icon('camera')}OCR 识别服务</h2>
        <p class="card-sub">拍照识别由本机 Python 服务完成，图片不会上传到互联网。</p>
        <div class="card-body">
          <div class="service-status ${serviceClass}" id="serviceStatusBox">
            <span class="status-dot"></span>
            <span>${serviceText}</span>
          </div>
          <div class="info-grid" style="margin-top:12px">
            <div class="info-item">
              <span>服务地址</span>
              <strong id="ocrEndpoint">${escapeHtml(ocrStatus.endpoint || 'http://127.0.0.1:8765')}</strong>
            </div>
            <div class="info-item">
              <span>识别能力</span>
              <strong>PaddleOCR · 中文 / 英文</strong>
            </div>
          </div>
          <div class="tier-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-action="check-ocr">${icon('restore')}重新检测</button>
            <a class="btn btn-sm btn-ghost" href="/docs" target="_blank" rel="noopener">查看 API 文档</a>
          </div>
          <p class="chart-note">若服务未连接，请在项目目录运行 <code>start.bat</code>，保持黑色命令行窗口开启。</p>
        </div>
      </section>

      <section class="card settings-card">
        <h2>${icon('phone')}移动端访问</h2>
        <p class="card-sub">手机与电脑连接同一个 Wi-Fi，即可用手机拍照录入、查看预警。</p>
        <div class="card-body">
          <div class="info-grid">
            <div class="info-item">
              <span>手机访问地址</span>
              <strong id="mobileAccessUrl">${escapeHtml(mobileUrlText)}</strong>
            </div>
            <div class="info-item">
              <span>移动端能力</span>
              <strong>拍照 / 相册 / Excel</strong>
            </div>
          </div>
          <div class="tier-actions">
            <button type="button" class="btn btn-sm btn-primary" data-action="copy-mobile-url" data-url="${escapeHtml(mobileUrl)}" ${mobileUrl && lanEnabled ? '' : 'disabled'}>
              ${icon('phone')}复制手机地址
            </button>
            <a class="btn btn-sm btn-ghost" href="/mobile" target="_blank" rel="noopener">在本机预览移动端</a>
          </div>
          <p class="chart-note" id="mobileAccessHint">${escapeHtml(mobileHint)}</p>
        </div>
      </section>

      <section class="card settings-card">
        <h2>${icon('settings')}数据管理</h2>
        <p class="card-sub">数据只在本机，不会同步到云端；删除后无法恢复。</p>
        <div class="card-body">
          <div class="inline-note">
            建议每周导出一次 Excel 备份。换电脑或重装浏览器前，务必先导出。
          </div>
          <div class="danger-zone" style="margin-top:14px">
            <div class="dz-title">谨慎操作</div>
            <p>「载入示例数据」会用示例商品替换当前商品数据；「清空全部数据」会删除所有商品记录（档位设置保留）。</p>
            <div class="dz-actions">
              <button type="button" class="btn btn-sm btn-ghost" data-action="load-demo">载入示例数据</button>
              <button type="button" class="btn btn-sm btn-danger" data-action="clear-data">${icon('trash')}清空全部数据</button>
            </div>
          </div>
          <div class="info-grid" style="margin-top:14px">
            <div class="info-item">
              <span>存储方式</span>
              <strong>浏览器 LocalStorage</strong>
            </div>
            <div class="info-item">
              <span>应用版本</span>
              <strong>v1.0</strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderTierRow(tier, index) {
  return `
    <tr data-tier-row>
      <td><input type="number" min="0" step="1" data-tier="min" value="${Number(tier.min) || 0}" aria-label="第 ${index + 1} 档保质期下限"></td>
      <td><input type="number" min="0" step="1" data-tier="max" value="${Number(tier.max) || 0}" aria-label="第 ${index + 1} 档保质期上限"></td>
      <td><input type="number" min="0" step="1" data-tier="advanceDays" value="${Number(tier.advanceDays) || 0}" aria-label="第 ${index + 1} 档提前下架天数"></td>
      <td><button type="button" class="tier-del" data-action="remove-tier" title="删除档位" aria-label="删除档位">${icon('trash')}</button></td>
    </tr>
  `;
}

