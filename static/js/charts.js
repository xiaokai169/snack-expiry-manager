/* =========================================================
   轻量图表：全部使用内联 SVG / CSS，无第三方依赖
   ========================================================= */
import { escapeHtml, formatNumber } from './utils.js';

/** 横向条形分布图 */
export function horizontalBars(rows, { unit = '种' } = {}) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  const html = rows.map((row) => {
    const value = Number(row.value) || 0;
    const percent = Math.max(value > 0 ? 2.5 : 0, (value / max) * 100);
    return `
      <div class="hbar-row">
        <span class="hbar-label">${escapeHtml(row.label)}</span>
        <div class="hbar-track" title="${escapeHtml(row.label)}：${value} ${unit}">
          <div class="hbar-fill" style="width:${percent}%;background:${row.color}"></div>
        </div>
        <span class="hbar-value">${formatNumber(value)}<small>${unit}</small></span>
      </div>
    `;
  }).join('');

  return `<div class="hbars">${html}</div>`;
}

/** 环形图 */
export function donutChart(segments, { centerLabel = '商品', unit = '种' } = {}) {
  const safeSegments = segments.map((segment) => ({
    ...segment,
    value: Math.max(0, Number(segment.value) || 0)
  }));
  const total = safeSegments.reduce((sum, segment) => sum + segment.value, 0);

  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 58;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const rings = safeSegments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const length = (segment.value / total) * circumference;
      const gap = total > 1 ? 2 : 0;
      const visible = Math.max(0, length - gap);
      const circle = `
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
          stroke="${segment.color}" stroke-width="${strokeWidth}"
          stroke-dasharray="${visible} ${circumference - visible}"
          stroke-dashoffset="${-offset - gap / 2}"
          transform="rotate(-90 ${cx} ${cy})">
          <title>${escapeHtml(segment.label)}：${segment.value} ${unit}</title>
        </circle>`;
      offset += length;
      return circle;
    })
    .join('');

  const ring = total > 0
    ? rings
    : `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#eee9e2" stroke-width="${strokeWidth}"/>`;

  const legend = safeSegments.map((segment) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${segment.color}"></span>
      <span>${escapeHtml(segment.label)}</span>
      <b>${formatNumber(segment.value)}</b>
    </div>
  `).join('');

  return `
    <div class="donut-wrap">
      <svg class="donut-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="商品状态分布">
        ${ring}
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" class="donut-center-value">${formatNumber(total)}</text>
        <text x="${cx}" y="${cy + 15}" text-anchor="middle" class="donut-center-label">${escapeHtml(centerLabel)}</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

/** 近 N 个月入库 / 下架趋势（分组柱状图） */
export function groupedBarChart(months, {
  series = [
    { key: 'added', name: '新入库', color: '#f97316' },
    { key: 'offShelf', name: '下架', color: '#9a9187' }
  ]
} = {}) {
  const width = 780;
  const height = 286;
  const padding = { top: 18, right: 14, bottom: 38, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const rawMax = Math.max(1, ...months.flatMap((month) => series.map((item) => Number(month[item.key]) || 0)));
  const step = niceStep(rawMax / 4);
  const maxValue = Math.max(step * 4, step);
  const groupWidth = plotWidth / Math.max(1, months.length);
  const barWidth = Math.min(26, Math.max(10, (groupWidth - 26) / series.length));
  const barGap = 7;

  const gridLines = [];
  for (let i = 0; i <= 4; i += 1) {
    const value = step * i;
    const y = padding.top + plotHeight - (value / maxValue) * plotHeight;
    gridLines.push(`
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line"/>
      <text x="${padding.left - 8}" y="${y + 3.5}" text-anchor="end" class="axis-label">${value}</text>
    `);
  }

  const bars = [];
  months.forEach((month, monthIndex) => {
    const groupCenter = padding.left + groupWidth * monthIndex + groupWidth / 2;
    const totalBarsWidth = series.length * barWidth + (series.length - 1) * barGap;
    const startX = groupCenter - totalBarsWidth / 2;

    series.forEach((item, seriesIndex) => {
      const value = Number(month[item.key]) || 0;
      const barHeight = (value / maxValue) * plotHeight;
      const x = startX + seriesIndex * (barWidth + barGap);
      const y = padding.top + plotHeight - barHeight;
      bars.push(`
        <rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(value > 0 ? 2 : 0, barHeight)}"
          rx="4" fill="${item.color}" opacity="${seriesIndex === 0 ? 1 : .82}">
          <title>${escapeHtml(month.label)} · ${escapeHtml(item.name)}：${value}</title>
        </rect>
        ${value > 0 ? `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" class="bar-value">${value}</text>` : ''}
      `);
    });

    bars.push(`
      <text x="${groupCenter}" y="${height - 14}" text-anchor="middle" class="axis-label">${escapeHtml(month.label)}</text>
    `);
  });

  const legend = series.map((item) => `
    <span><i style="background:${item.color}"></i>${escapeHtml(item.name)}</span>
  `).join('');

  return `
    <div class="chart-legend-inline">${legend}</div>
    <svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="近几个月入库与下架趋势">
      ${gridLines.join('')}
      ${bars.join('')}
    </svg>
  `;
}

function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  let nice;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return Math.max(1, Math.round(nice * magnitude));
}
