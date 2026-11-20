import React, { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import {
  Activity,
  Flame,
  ListChecks,
  TrendingUp,
  Users,
} from 'lucide-react';
import type {
  AdvanceEntry,
  AttendanceRecord,
  Employee,
  FlatUnit,
  Project,
  SiteExpense,
  Tower,
  WorkAssignment,
} from '../types/avy';
import {
  DEFAULT_WEEKLY_EXPENSE_BUDGET,
  ExecutiveSummaryMetrics,
  computeExecutiveSummaryMetrics,
} from '../utils/operations';
import { formatINR } from '../utils/payroll';
import { useTheme } from '../context/ThemeContext';

interface ExecutiveSummarySectionProps {
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  employees: Employee[];
  assignments: WorkAssignment[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  expenses: SiteExpense[];
  weeklyExpenseBudget?: number;
  metricsOverride?: ExecutiveSummaryMetrics;
  isSupervisor?: boolean;
  onOpenBudgetSettings?: () => void;
}

export function ExecutiveSummarySection({
  projects,
  towers,
  flats,
  employees,
  assignments,
  attendance,
  advances,
  expenses,
  weeklyExpenseBudget = DEFAULT_WEEKLY_EXPENSE_BUDGET,
  metricsOverride,
  isSupervisor = false,
  onOpenBudgetSettings,
}: ExecutiveSummarySectionProps) {
  const { isDark } = useTheme();
  const computedMetrics = useMemo(
    () =>
      computeExecutiveSummaryMetrics({
        projects,
        towers,
        flats,
        employees,
        assignments,
        attendance,
        advances,
        expenses,
        weeklyExpenseBudget,
      }),
    [projects, towers, flats, employees, assignments, attendance, advances, expenses, weeklyExpenseBudget]
  );
  const metrics = metricsOverride || computedMetrics;

  const pipelineSvgRef = useRef<SVGSVGElement | null>(null);
  const burnSvgRef = useRef<SVGSVGElement | null>(null);
  const utilSvgRef = useRef<SVGSVGElement | null>(null);

  // 1. D3 Task Pipeline Bar Chart
  useEffect(() => {
    const svgEl = pipelineSvgRef.current;
    if (!svgEl) return;

    const width = 460;
    const height = 210;
    const margin = { top: 18, right: 16, bottom: 42, left: 38 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const data = metrics.taskPipelineStages;
    const maxVal = Math.max(4, d3.max(data, (d) => d.count) || 4);

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.stage))
      .range([0, innerW])
      .padding(0.28);

    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).nice().range([innerH, 0]);

    const gridColor = isDark ? '#1e293b' : '#e2e8f0';
    const domainColor = isDark ? '#334155' : '#cbd5e1';
    const tickMutedColor = isDark ? '#94a3b8' : '#64748b';
    const tickLabelColor = isDark ? '#cbd5e1' : '#475569';
    const valueLabelColor = isDark ? '#f1f5f9' : '#0f172a';

    // Gridlines
    g.append('g')
      .attr('class', 'grid')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-innerW)
          .tickFormat(() => '')
      )
      .call((grid) => grid.select('.domain').remove())
      .call((grid) =>
        grid.selectAll('line').attr('stroke', gridColor).attr('stroke-dasharray', '2,2')
      );

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickSizeOuter(0))
      .call((ax) => ax.select('.domain').attr('stroke', domainColor))
      .call((ax) => ax.selectAll('text').attr('fill', tickMutedColor).attr('font-size', '10px'));

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .call((ax) => ax.select('.domain').attr('stroke', domainColor))
      .call((ax) =>
        ax
          .selectAll('text')
          .attr('fill', tickLabelColor)
          .attr('font-size', '9.5px')
          .attr('font-weight', '500')
          .attr('dy', '0.9em')
      );

    // Bars
    g.selectAll('rect.stage-bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'stage-bar')
      .attr('x', (d) => x(d.stage) || 0)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => Math.max(0, innerH - y(d.count)))
      .attr('rx', 4)
      .attr('fill', (d) => d.color);

    // Value labels above bars
    g.selectAll('text.stage-val')
      .data(data)
      .enter()
      .append('text')
      .attr('class', 'stage-val')
      .attr('x', (d) => (x(d.stage) || 0) + x.bandwidth() / 2)
      .attr('y', (d) => Math.max(10, y(d.count) - 5))
      .attr('text-anchor', 'middle')
      .attr('fill', valueLabelColor)
      .attr('font-size', '10.5px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => String(d.count));
  }, [metrics.taskPipelineStages, isDark]);

  // 2. D3 Expense Burn Rate Trend Chart
  useEffect(() => {
    const svgEl = burnSvgRef.current;
    if (!svgEl) return;

    const width = 460;
    const height = 210;
    const margin = { top: 18, right: 16, bottom: 36, left: 50 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const series = metrics.dailyBurnSeries;
    if (series.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#64748b')
        .attr('font-size', '12px')
        .text('No site spend recorded yet');
      return;
    }

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const threshold = metrics.dailyBurnThreshold;
    const maxSpend = Math.max(
      1000,
      d3.max(series, (d) => d.total) || 1000,
      threshold > 0 ? threshold * 1.05 : 0
    );
    const x = d3
      .scalePoint<string>()
      .domain(series.map((d) => d.shortLabel))
      .range([0, innerW])
      .padding(0.3);

    const y = d3.scaleLinear().domain([0, maxSpend * 1.15]).nice().range([innerH, 0]);

    const gridColor = isDark ? '#1e293b' : '#e2e8f0';
    const domainColor = isDark ? '#334155' : '#cbd5e1';
    const tickMutedColor = isDark ? '#94a3b8' : '#64748b';
    const tickLabelColor = isDark ? '#cbd5e1' : '#475569';
    const haloColor = isDark ? '#0f172a' : '#ffffff';

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-innerW)
          .tickFormat(() => '')
      )
      .call((grid) => grid.select('.domain').remove())
      .call((grid) =>
        grid.selectAll('line').attr('stroke', gridColor).attr('stroke-dasharray', '2,2')
      );

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((val) => {
            const num = Number(val);
            if (num >= 1000) return `₹${Math.round(num / 1000)}k`;
            return `₹${num}`;
          })
      )
      .call((ax) => ax.select('.domain').attr('stroke', domainColor))
      .call((ax) => ax.selectAll('text').attr('fill', tickMutedColor).attr('font-size', '10px'));

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .call((ax) => ax.select('.domain').attr('stroke', domainColor))
      .call((ax) => ax.selectAll('text').attr('fill', tickLabelColor).attr('font-size', '10px'));

    // Gradient fill for total daily burn area
    const defs = svg.append('defs');
    const grad = defs
      .append('linearGradient')
      .attr('id', 'burnAreaGrad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#c2410c').attr('stop-opacity', 0.28);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#c2410c').attr('stop-opacity', 0.02);

    const areaGen = d3
      .area<(typeof series)[number]>()
      .x((d) => x(d.shortLabel) ?? 0)
      .y0(innerH)
      .y1((d) => y(d.total))
      .curve(d3.curveMonotoneX);

    const lineGen = d3
      .line<(typeof series)[number]>()
      .x((d) => x(d.shortLabel) ?? 0)
      .y((d) => y(d.total))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(series).attr('fill', 'url(#burnAreaGrad)').attr('d', areaGen);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#c2410c')
      .attr('stroke-width', 2.4)
      .attr('d', lineGen);

    if (threshold > 0) {
      const thY = y(threshold);
      const thColor =
        metrics.burnBudgetStatus === 'exceeded'
          ? isDark
            ? '#f87171'
            : '#dc2626'
          : isDark
            ? '#34d399'
            : '#059669';
      g.append('line')
        .attr('class', 'burn-threshold-line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', thY)
        .attr('y2', thY)
        .attr('stroke', thColor)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '5,4');

      const thText =
        threshold >= 1000
          ? `Limit ₹${(threshold / 1000).toFixed(1)}k/d`
          : `Limit ₹${threshold}/d`;

      g.append('text')
        .attr('class', 'burn-threshold-label')
        .attr('x', 4)
        .attr('y', Math.max(11, thY - 5))
        .attr('text-anchor', 'start')
        .attr('fill', thColor)
        .attr('stroke', haloColor)
        .attr('stroke-width', 3)
        .attr('paint-order', 'stroke')
        .attr('font-size', '9.5px')
        .attr('font-weight', '700')
        .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .text(thText);
    }

    g.selectAll('circle.burn-pt')
      .data(series)
      .enter()
      .append('circle')
      .attr('class', 'burn-pt')
      .attr('cx', (d) => x(d.shortLabel) ?? 0)
      .attr('cy', (d) => y(d.total))
      .attr('r', (d) => (threshold > 0 && d.total > threshold ? 4.5 : 4))
      .attr('fill', haloColor)
      .attr('stroke', (d) => (threshold > 0 && d.total > threshold ? '#dc2626' : '#ea580c'))
      .attr('stroke-width', 2);

    g.selectAll('text.burn-val')
      .data(series)
      .enter()
      .append('text')
      .attr('class', 'burn-val')
      .attr('x', (d) => x(d.shortLabel) ?? 0)
      .attr('y', (d) => Math.max(10, y(d.total) - 8))
      .attr('text-anchor', 'middle')
      .attr('fill', (d) =>
        threshold > 0 && d.total > threshold
          ? isDark
            ? '#fca5a5'
            : '#991b1b'
          : isDark
            ? '#fdba74'
            : '#7c2d12'
      )
      .attr('font-size', '9.5px')
      .attr('font-weight', '600')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => (d.total >= 1000 ? `₹${(d.total / 1000).toFixed(1)}k` : `₹${d.total}`));
  }, [metrics.dailyBurnSeries, metrics.dailyBurnThreshold, metrics.burnBudgetStatus, isDark]);

  // 3. D3 Workforce Utilization Horizontal Progress Bars
  useEffect(() => {
    const svgEl = utilSvgRef.current;
    if (!svgEl) return;

    const rows = metrics.towerUtilizationRows;
    const rowHeight = 32;
    const margin = { top: 8, right: 54, bottom: 12, left: 112 };
    const width = 460;
    const height = Math.max(96, margin.top + margin.bottom + rows.length * rowHeight);
    const innerW = width - margin.left - margin.right;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    if (rows.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#64748b')
        .attr('font-size', '12px')
        .text('No towers configured yet');
      return;
    }

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const x = d3.scaleLinear().domain([0, 100]).range([0, innerW]);
    const y = d3
      .scaleBand()
      .domain(rows.map((r) => r.towerId))
      .range([0, rows.length * rowHeight])
      .padding(0.32);

    const trackFill = isDark ? '#1e293b' : '#f1f5f9';
    const labelColor = isDark ? '#f1f5f9' : '#0f172a';
    const pctColor = isDark ? '#cbd5e1' : '#334155';

    // Background track bars
    g.selectAll('rect.util-bg')
      .data(rows)
      .enter()
      .append('rect')
      .attr('class', 'util-bg')
      .attr('x', 0)
      .attr('y', (d) => y(d.towerId) ?? 0)
      .attr('width', innerW)
      .attr('height', y.bandwidth())
      .attr('rx', 5)
      .attr('fill', trackFill);

    // Utilization fill bars
    g.selectAll('rect.util-fill')
      .data(rows)
      .enter()
      .append('rect')
      .attr('class', 'util-fill')
      .attr('x', 0)
      .attr('y', (d) => y(d.towerId) ?? 0)
      .attr('width', (d) => Math.max(4, x(d.utilizationPct)))
      .attr('height', y.bandwidth())
      .attr('rx', 5)
      .attr('fill', (d) =>
        d.utilizationPct >= 75 ? '#059669' : d.utilizationPct >= 40 ? '#d97706' : '#64748b'
      );

    // Tower labels on left
    g.selectAll('text.util-lbl')
      .data(rows)
      .enter()
      .append('text')
      .attr('class', 'util-lbl')
      .attr('x', -8)
      .attr('y', (d) => (y(d.towerId) ?? 0) + y.bandwidth() / 2 + 4)
      .attr('text-anchor', 'end')
      .attr('fill', labelColor)
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text((d) => (d.label.length > 15 ? `${d.label.slice(0, 14)}…` : d.label));

    // Percentage + crew count on right
    g.selectAll('text.util-pct')
      .data(rows)
      .enter()
      .append('text')
      .attr('class', 'util-pct')
      .attr('x', innerW + 8)
      .attr('y', (d) => (y(d.towerId) ?? 0) + y.bandwidth() / 2 + 4)
      .attr('text-anchor', 'start')
      .attr('fill', pctColor)
      .attr('font-size', '10.5px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => `${d.utilizationPct}%`);
  }, [metrics.towerUtilizationRows, isDark]);

  return (
    <section
      aria-labelledby="exec-summary-heading"
      className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <h2 id="exec-summary-heading" className="text-base font-semibold text-slate-900">
              Executive Summary {isSupervisor ? '(Assigned Tower Scope)' : '(All Projects)'}
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time operational telemetry for pending tile/cleaning tasks, workforce utilization, and daily site burn rate.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-600 tabular-nums">
          {projects.length} {projects.length === 1 ? 'Project' : 'Projects'} · {towers.length}{' '}
          {towers.length === 1 ? 'Tower' : 'Towers'} · {flats.length} Units
        </div>
      </div>

      {/* Top 3 Executive KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Total Pending Tasks */}
        <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>Total Pending Tasks</span>
            <ListChecks className="w-4 h-4 text-amber-600" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold tabular-nums text-slate-900">
              {metrics.totalPendingTasks}
            </span>
            <span className="text-xs font-mono text-slate-500">
              / {metrics.totalTasks} zones ({100 - metrics.taskCompletionPct}% open)
            </span>
          </div>
          <div className="text-[11px] text-slate-600">
            {metrics.notStartedTasks} Not Started · {metrics.precheckingTasks} Prechecking ·{' '}
            {metrics.inProgressTasks} In Progress · {metrics.cleaningInProgressTasks} Cleaning Run
          </div>
        </div>

        {/* KPI 2: Current Workforce Utilization */}
        <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>Current Workforce Utilization</span>
            <Users className="w-4 h-4 text-emerald-700" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold tabular-nums text-emerald-800">
              {metrics.workforceUtilizationPct}%
            </span>
            <span className="text-xs font-mono text-slate-500">
              ({metrics.utilizedWorkersCount}/{metrics.activeWorkersCount} active crew)
            </span>
          </div>
          <div className="text-[11px] text-slate-600">
            {metrics.presentTodayCount} Present on latest muster · {metrics.assignedWorkersCount} Actively assigned to zones
          </div>
        </div>

        {/* KPI 3: Expense Burn Rate */}
        <div
          className={`p-4 rounded-lg border space-y-1.5 ${
            metrics.burnBudgetStatus === 'exceeded'
              ? 'border-red-300 bg-red-50/50'
              : metrics.burnBudgetStatus === 'warning'
                ? 'border-amber-300 bg-amber-50/40'
                : 'border-slate-200 bg-slate-50/70'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-600">
            <span>Expense Burn Rate</span>
            <div className="flex items-center gap-1.5">
              {metrics.weeklyExpenseBudget > 0 && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border ${
                    metrics.burnBudgetStatus === 'exceeded'
                      ? 'bg-red-100 text-red-800 border-red-300'
                      : metrics.burnBudgetStatus === 'warning'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  }`}
                >
                  {metrics.burnBudgetStatus === 'exceeded'
                    ? 'OVER WEEKLY BUDGET'
                    : metrics.burnBudgetStatus === 'warning'
                      ? 'NEAR LIMIT'
                      : 'WITHIN BUDGET'}
                </span>
              )}
              <Flame
                className={`w-4 h-4 ${
                  metrics.burnBudgetStatus === 'exceeded' ? 'text-red-600' : 'text-orange-700'
                }`}
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-mono font-bold tabular-nums ${
                metrics.burnBudgetStatus === 'exceeded' ? 'text-red-900' : 'text-slate-900'
              }`}
            >
              {formatINR(metrics.dailyBurnRate)}
            </span>
            <span className="text-xs font-mono text-slate-500">/ active day</span>
          </div>
          <div className="text-[11px] text-slate-600">
            {metrics.weeklyExpenseBudget > 0 ? (
              <>
                Limit <strong className="font-mono text-slate-800">{formatINR(metrics.dailyBurnThreshold)}/d</strong>{' '}
                ({formatINR(metrics.weeklyExpenseBudget)}/wk) · This Wk{' '}
                <strong className="font-mono text-slate-800">{formatINR(metrics.currentWeekSpend)}</strong>
              </>
            ) : (
              <>
                30d Run Rate:{' '}
                <strong className="font-mono text-slate-800">{formatINR(metrics.projectedMonthlyBurn)}</strong> · Total
                Spend {formatINR(metrics.totalSiteSpend)}
              </>
            )}
            {!isSupervisor && onOpenBudgetSettings && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={onOpenBudgetSettings}
                  className="text-orange-700 font-semibold hover:underline"
                >
                  Set Budget
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* D3 Interactive Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* D3 Task Stage Breakdown Chart */}
        <div className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Work &amp; Cleaning Stage Breakdown
              </h3>
              <p className="text-[11px] text-slate-500">
                Zone distribution from Prechecking through Cleaning Done &amp; QC
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              {metrics.taskCompletionPct}% Done
            </span>
          </div>
          <svg
            ref={pipelineSvgRef}
            role="img"
            aria-label="D3 bar chart of tile laying and cleaning task stages"
            className="w-full h-52 overflow-visible"
          />
        </div>

        {/* D3 Daily Expense Burn Trend Chart */}
        <div className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                <span>Daily Expense Burn Trend (Wages + Advances + Site)</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                {metrics.activeSpendDays} active spend days · Wages {formatINR(metrics.wagesTotal)} · Site {formatINR(metrics.siteExpensesTotal)}
              </p>
            </div>
          </div>
          <svg
            ref={burnSvgRef}
            role="img"
            aria-label="D3 area line chart of daily expense burn rate"
            className="w-full h-52 overflow-visible"
          />
        </div>
      </div>

      {/* D3 Tower Workforce Utilization Bars */}
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Tower-Wise Workforce Utilization
            </h3>
            <p className="text-[11px] text-slate-500">
              Percentage of deployed tower crew marked present or actively running flat zones
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" /> ≥75%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" /> 40–74%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-500 inline-block" /> &lt;40%
            </span>
          </div>
        </div>
        <svg
          ref={utilSvgRef}
          role="img"
          aria-label="D3 horizontal bar chart of workforce utilization per tower"
          className="w-full max-h-48"
        />
      </div>
    </section>
  );
}
