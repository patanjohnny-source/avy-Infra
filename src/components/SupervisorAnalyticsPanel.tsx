import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  Repeat,
  Users,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AttendanceRecord,
  Employee,
  Project,
  Tower,
  WorkAssignment,
} from '../types/avy';
import { computeSupervisorAnalytics } from '../utils/supervisorAnalytics';
import { useTheme } from '../context/ThemeContext';

interface SupervisorAnalyticsPanelProps {
  projects: Project[];
  towers: Tower[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  assignments: WorkAssignment[];
  referenceDate: string;
  projectId: string;
  towerId: string;
}

export function SupervisorAnalyticsPanel({
  projects,
  towers,
  employees,
  attendance,
  assignments,
  referenceDate,
  projectId,
  towerId,
}: SupervisorAnalyticsPanelProps) {
  const { isDark } = useTheme();
  const [windowDays, setWindowDays] = useState<7 | 14>(7);
  const [trendMode, setTrendMode] = useState<'count' | 'pct'>('count');
  const [collapsed, setCollapsed] = useState(false);

  const chartGridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const chartAxisStroke = isDark ? '#334155' : '#cbd5e1';
  const chartTickFill = isDark ? '#94a3b8' : '#475569';
  const chartRetentionStroke = isDark ? '#38bdf8' : '#0f172a';
  const chartTooltipStyle = isDark
    ? {
        fontSize: '12px',
        borderRadius: '6px',
        borderColor: '#334155',
        backgroundColor: '#0f172a',
        color: '#f1f5f9',
      }
    : {
        fontSize: '12px',
        borderRadius: '6px',
        borderColor: '#cbd5e1',
        backgroundColor: '#ffffff',
      };

  const analytics = useMemo(
    () =>
      computeSupervisorAnalytics({
        projects,
        towers,
        employees,
        attendance,
        assignments,
        referenceDate,
        projectId,
        towerId,
        windowDays,
      }),
    [projects, towers, employees, attendance, assignments, referenceDate, projectId, towerId, windowDays]
  );

  const totalPendingMuster = analytics.towerBreakdown.reduce(
    (sum, t) => sum + t.pendingDeployment,
    0
  );

  return (
    <section
      data-testid="supervisor-analytics-panel"
      aria-labelledby="supervisor-analytics-heading"
      className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4"
    >
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-2 rounded-md bg-orange-50 border border-orange-200 text-orange-700 shrink-0">
            <BarChart3 className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id="supervisor-analytics-heading"
              className="text-base font-semibold text-slate-900"
            >
              Supervisor Analytics
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time attendance trends per tower, weekly worker retention, and active vs. pending deployment ({analytics.windowStart} to {analytics.windowEnd})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-md text-xs">
            <button
              type="button"
              onClick={() => setWindowDays(7)}
              aria-pressed={windowDays === 7}
              className={`px-2.5 py-1 font-semibold rounded whitespace-nowrap ${
                windowDays === 7
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => setWindowDays(14)}
              aria-pressed={windowDays === 14}
              className={`px-2.5 py-1 font-semibold rounded whitespace-nowrap ${
                windowDays === 14
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              14 Days
            </button>
          </div>

          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-md text-xs">
            <button
              type="button"
              onClick={() => setTrendMode('count')}
              aria-pressed={trendMode === 'count'}
              className={`px-2.5 py-1 font-semibold rounded whitespace-nowrap ${
                trendMode === 'count'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Headcount
            </button>
            <button
              type="button"
              onClick={() => setTrendMode('pct')}
              aria-pressed={trendMode === 'pct'}
              className={`px-2.5 py-1 font-semibold rounded whitespace-nowrap ${
                trendMode === 'pct'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Attendance %
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            {collapsed ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Expand</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 rounded-md bg-emerald-50/60 border border-emerald-200">
              <div className="flex items-center justify-between text-[11px] font-medium text-emerald-800">
                <span>Active Deployed ({analytics.referenceDate})</span>
                <Users className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              </div>
              <div className="mt-1 text-xl font-mono font-bold text-emerald-950 tabular-nums">
                {analytics.totalActiveDeployed}{' '}
                <span className="text-xs font-sans font-normal text-emerald-800">
                  / {analytics.totalAllocatedCrew} allocated
                </span>
              </div>
              <div className="text-[11px] text-emerald-800/90 mt-0.5">
                {analytics.todayAttendanceRatePct}% tower muster present/HD
              </div>
            </div>

            <div className="p-3 rounded-md bg-amber-50/70 border border-amber-200">
              <div className="flex items-center justify-between text-[11px] font-medium text-amber-800">
                <span>Pending Deployment</span>
                <Clock className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
              </div>
              <div className="mt-1 text-xl font-mono font-bold text-amber-950 tabular-nums">
                {analytics.totalPendingDeployment}
              </div>
              <div className="text-[11px] text-amber-900/90 mt-0.5">
                Unmarked: {totalPendingMuster} · Unassigned pool: {analytics.unassignedPoolCount}
              </div>
            </div>

            <div className="p-3 rounded-md bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-medium text-slate-600">
                {windowDays}-Day Avg Attendance Rate
              </div>
              <div className="mt-1 text-xl font-mono font-bold text-slate-900 tabular-nums">
                {analytics.avgAttendanceRatePct}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Across {analytics.towerSeries.length} scoped tower
                {analytics.towerSeries.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="p-3 rounded-md bg-orange-50/60 border border-orange-200">
              <div className="flex items-center justify-between text-[11px] font-medium text-orange-900">
                <span>Weekly Worker Retention</span>
                <Repeat className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              </div>
              <div className="mt-1 text-xl font-mono font-bold text-orange-950 tabular-nums">
                {analytics.overallWeeklyRetentionPct}%
              </div>
              <div className="text-[11px] text-orange-900/90 mt-0.5">
                {analytics.returningCrewTotal}/{analytics.cohortTotal} crew ·{' '}
                {analytics.retentionBasis === 'week_over_week'
                  ? 'Week-over-Week'
                  : '7d Multi-Day Continuity'}
              </div>
            </div>
          </div>

          {/* Dual Recharts Visualizations */}
          {analytics.towerSeries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md">
              No towers match the current Project / Tower filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              {/* Chart 1: Per-Tower Attendance Trends */}
              <div
                data-testid="supervisor-attendance-trend-chart"
                className="xl:col-span-7 p-3.5 border border-slate-200 rounded-lg bg-slate-50/40 space-y-2 min-w-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900">
                      Per-Tower Attendance Trend ({windowDays} Days)
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {trendMode === 'count'
                        ? 'Daily Present + Half-Day crew headcount per tower'
                        : 'Daily attendance rate % against tower allocated crew'}
                    </p>
                  </div>
                </div>

                <div className="h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height={256}>
                    <LineChart
                      data={analytics.dailyTrendRows}
                      margin={{ top: 14, right: 16, left: -12, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                      <XAxis
                        dataKey="shortDate"
                        tick={{ fontSize: 11, fill: chartTickFill }}
                        tickLine={false}
                        axisLine={{ stroke: chartAxisStroke }}
                      />
                      <YAxis
                        allowDecimals={false}
                        domain={trendMode === 'pct' ? [0, 100] : [0, 'auto']}
                        tickFormatter={trendMode === 'pct' ? (v) => `${v}%` : undefined}
                        tick={{ fontSize: 11, fill: chartTickFill }}
                        tickLine={false}
                        axisLine={{ stroke: chartAxisStroke }}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value, name) => [
                          trendMode === 'pct' ? `${value}%` : `${value} crew`,
                          String(name),
                        ]}
                        labelFormatter={(label, payload) => {
                          const fullDate = payload?.[0]?.payload?.date;
                          return fullDate ? `Date: ${fullDate}` : `Date: ${label}`;
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                      {analytics.towerSeries.map((series) => (
                        <Line
                          key={series.towerId}
                          type="monotone"
                          dataKey={trendMode === 'count' ? series.countKey : series.pctKey}
                          name={series.chartLabel}
                          stroke={series.color}
                          strokeWidth={2.5}
                          dot={{ r: 3.5, strokeWidth: 1.5 }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Active vs. Pending Deployment + Weekly Retention % */}
              <div
                data-testid="supervisor-deployment-retention-chart"
                className="xl:col-span-5 p-3.5 border border-slate-200 rounded-lg bg-slate-50/40 space-y-2 min-w-0"
              >
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">
                    Active vs. Pending Deployment &amp; Retention %
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Crew status on {analytics.referenceDate} (bars) &amp; weekly retention (line)
                  </p>
                </div>

                <div className="h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height={256}>
                    <ComposedChart
                      data={analytics.deploymentRows}
                      margin={{ top: 14, right: 8, left: -14, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: chartTickFill }}
                        tickLine={false}
                        axisLine={{ stroke: chartAxisStroke }}
                      />
                      <YAxis
                        yAxisId="left"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: chartTickFill }}
                        tickLine={false}
                        axisLine={{ stroke: chartAxisStroke }}
                      />
                      <YAxis
                        yAxisId="pct"
                        orientation="right"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 10, fill: chartTickFill }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value, name) => [
                          String(name).includes('Retention') ? `${value}%` : `${value} workers`,
                          String(name),
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                      <Bar
                        yAxisId="left"
                        dataKey="activeDeployed"
                        name="Active Deployed"
                        fill="#059669"
                        radius={[3, 3, 0, 0]}
                        barSize={18}
                        isAnimationActive={false}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="pendingDeployment"
                        name="Pending Deployment"
                        fill="#d97706"
                        radius={[3, 3, 0, 0]}
                        barSize={18}
                        isAnimationActive={false}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="absentCount"
                        name="Absent"
                        fill="#dc2626"
                        radius={[3, 3, 0, 0]}
                        barSize={14}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="pct"
                        type="monotone"
                        dataKey="weeklyRetentionPct"
                        name="Weekly Retention %"
                        stroke={chartRetentionStroke}
                        strokeWidth={2.2}
                        dot={{ r: 3.5, fill: chartRetentionStroke }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Tower Deployment & Weekly Retention Breakdown Table */}
          {analytics.towerBreakdown.length > 0 && (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2 px-3">Tower / Project</th>
                      <th className="py-2 px-2.5 text-right">Allocated</th>
                      <th className="py-2 px-2.5 text-right">Active Deployed</th>
                      <th className="py-2 px-2.5 text-right">Pending Deployment</th>
                      <th className="py-2 px-2.5 text-right">Zone Assigned</th>
                      <th className="py-2 px-2.5 text-right">Absent</th>
                      <th className="py-2 px-3 text-right">Weekly Retention</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.towerBreakdown.map((row) => (
                      <tr key={row.towerId} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3">
                          <span className="font-semibold text-slate-900">{row.towerName}</span>
                          <span className="text-[11px] text-slate-500 ml-1.5">
                            · {row.projectName}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-slate-800">
                          {row.allocatedCrew}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-semibold text-emerald-800">
                          {row.activeDeployed} ({row.attendancePctToday}%)
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-semibold text-amber-800">
                          {row.pendingDeployment}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-slate-700">
                          {row.zoneAssignedCount}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-red-700">
                          {row.absentCount}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 font-mono font-semibold rounded border text-[11px] ${
                              row.weeklyRetentionPct >= 75
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : row.weeklyRetentionPct >= 45
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-red-50 text-red-800 border-red-200'
                            }`}
                          >
                            {row.weeklyRetentionPct}% ({row.retainedWorkersCount}/{row.retentionDenominator})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
