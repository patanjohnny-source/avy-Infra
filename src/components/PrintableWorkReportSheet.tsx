import React from 'react';
import type { CompanyProfile } from '../types/avy';
import {
  type ProjectWorkStatusOverview,
  type WorkAreaFilter,
  type WorkBreakdownLevel,
  type WorkStatusFilter,
  WORK_AREA_FILTER_OPTIONS,
} from '../utils/operations';
import { ZONE_STATUS_LABELS } from '../utils/tileZones';

interface PrintableWorkReportSheetProps {
  company: CompanyProfile;
  title: string;
  projectScopeLabel: string;
  towerFilterLabel: string;
  floorFilterLabel: string;
  areaFilter: WorkAreaFilter;
  areaSearch: string;
  statusFilter: WorkStatusFilter;
  breakdownLevel: WorkBreakdownLevel;
  overview: ProjectWorkStatusOverview;
}

const STATUS_FILTER_TEXT: Record<WorkStatusFilter, string> = {
  all: 'All Statuses',
  pending: 'Pending / Not Started',
  prechecking: 'Prechecking',
  in_progress: 'In Progress',
  cleaning_in_progress: 'Cleaning Running',
  cleaning_done: 'Cleaning Done',
  completed: 'Completed',
};

export function PrintableWorkReportSheet({
  company,
  title,
  projectScopeLabel,
  towerFilterLabel,
  floorFilterLabel,
  areaFilter,
  areaSearch,
  statusFilter,
  breakdownLevel,
  overview,
}: PrintableWorkReportSheetProps) {
  const areaLabel =
    WORK_AREA_FILTER_OPTIONS.find((opt) => opt.id === areaFilter)?.label || 'All Tile Areas';
  const generatedOn = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <article
      data-testid="printable-work-report-sheet"
      className="invoice-a4-page bg-white text-slate-900 border border-slate-200 rounded shadow-sm mx-auto p-6 space-y-4 text-xs"
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-4 pb-3 border-b-2 border-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          {company.logoDataUrl && (
            <img
              src={company.logoDataUrl}
              alt={company.companyName}
              className="w-12 h-12 object-contain border border-slate-200 rounded p-1 shrink-0"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-slate-900 uppercase">
              {company.companyName}
            </h1>
            <p className="text-[11px] text-slate-600">
              {company.tagline || 'Tile Laying & Stone Finishing Contractors'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono">
              {company.address ? `${company.address} · ` : ''}
              {company.hrContact ? `Ph: ${company.hrContact}` : ''}
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="inline-block px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-slate-900 text-orange-300 rounded">
            {title}
          </div>
          <div className="text-[11px] font-semibold text-slate-800 mt-1 capitalize">
            {breakdownLevel}-Wise Site Record
          </div>
          <div className="text-[10px] font-mono text-slate-500">Printed: {generatedOn}</div>
        </div>
      </header>

      {/* Filter Criteria Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">Project Scope</div>
          <div className="font-semibold text-slate-900 break-words leading-snug">{projectScopeLabel}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">Tower Filter</div>
          <div className="font-semibold text-slate-900 break-words leading-snug">{towerFilterLabel}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">Floors Scope</div>
          <div className="font-semibold text-slate-900 break-words leading-snug">{floorFilterLabel}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">Tile Area</div>
          <div className="font-semibold text-orange-800 break-words leading-snug">
            {areaLabel}
            {areaSearch.trim() ? ` (“${areaSearch.trim()}”)` : ''}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">Work Status</div>
          <div className="font-semibold text-slate-900 break-words leading-snug">
            {STATUS_FILTER_TEXT[statusFilter]}
          </div>
        </div>
      </section>

      {/* Summary KPI Bar */}
      <section className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        <div className="p-2 border border-slate-200 rounded bg-white">
          <div className="text-[10px] text-slate-500">Flats Matched</div>
          <div className="text-sm font-mono font-bold text-slate-900">{overview.totalFlats}</div>
        </div>
        <div className="p-2 border border-slate-200 rounded bg-white">
          <div className="text-[10px] text-slate-500">Areas Matched</div>
          <div className="text-sm font-mono font-bold text-orange-800">
            {overview.matchingZonesTotal}
          </div>
        </div>
        <div className="p-2 border border-slate-200 rounded bg-white">
          <div className="text-[10px] text-slate-500">Matched Sq.Ft</div>
          <div className="text-sm font-mono font-bold text-slate-900">
            {Math.round(overview.matchingSqftTotal).toLocaleString('en-IN')}
          </div>
        </div>
        <div className="p-2 border border-slate-200 rounded bg-slate-50">
          <div className="text-[10px] text-slate-600">Pending</div>
          <div className="text-sm font-mono font-bold text-slate-800">{overview.pendingZones}</div>
        </div>
        <div className="p-2 border border-amber-200 rounded bg-amber-50/70">
          <div className="text-[10px] text-amber-800">In Progress</div>
          <div className="text-sm font-mono font-bold text-amber-900">
            {overview.inProgressZones}
          </div>
        </div>
        <div className="p-2 border border-emerald-200 rounded bg-emerald-50/70">
          <div className="text-[10px] text-emerald-800">Completed</div>
          <div className="text-sm font-mono font-bold text-emerald-900">
            {overview.completedZones} ({overview.overallProgressPct}%)
          </div>
        </div>
      </section>

      {/* Breakdown Table */}
      <section className="border border-slate-200 rounded overflow-hidden">
        {breakdownLevel === 'tower' && (
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="py-2 px-2.5">Project / Tower</th>
                <th className="py-2 px-2 text-right">Flats</th>
                <th className="py-2 px-2 text-right">Matched Areas</th>
                <th className="py-2 px-2 text-right">Sq.Ft</th>
                <th className="py-2 px-2 text-right">Pending</th>
                <th className="py-2 px-2 text-right">In Progress</th>
                <th className="py-2 px-2.5 text-right">Done (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {overview.towerRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No towers match the active filters.
                  </td>
                </tr>
              ) : (
                overview.towerRows.map((row) => (
                  <tr key={row.tower.id}>
                    <td className="py-1.5 px-2.5">
                      <div className="font-semibold text-slate-900">{row.tower.name}</div>
                      <div className="text-[10px] text-slate-500">{row.projectName}</div>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{row.flatCount}</td>
                    <td className="py-1.5 px-2 text-right font-mono font-semibold text-orange-800">
                      {row.matchingZonesCount}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {Math.round(row.matchingSqft).toLocaleString('en-IN')}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{row.pendingZones}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-amber-800">
                      {row.inProgressZones}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono font-semibold text-emerald-800">
                      {row.completedZones} ({row.progressPct}%)
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {breakdownLevel === 'floor' && (
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="py-2 px-2.5">Floor / Level</th>
                <th className="py-2 px-2">Project · Tower</th>
                <th className="py-2 px-2 text-right">Flats</th>
                <th className="py-2 px-2 text-right">Matched Areas</th>
                <th className="py-2 px-2 text-right">Sq.Ft</th>
                <th className="py-2 px-2 text-right">Pending / Run</th>
                <th className="py-2 px-2.5 text-right">Done (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {overview.floorRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No floors match the active filters.
                  </td>
                </tr>
              ) : (
                overview.floorRows.map((row) => (
                  <tr key={row.key}>
                    <td className="py-1.5 px-2.5 font-semibold text-slate-900">
                      {row.floorLabel}
                    </td>
                    <td className="py-1.5 px-2 text-slate-600">
                      {row.projectName} · {row.towerName}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{row.flatCount}</td>
                    <td className="py-1.5 px-2 text-right font-mono font-semibold text-orange-800">
                      {row.matchingZonesCount}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {Math.round(row.matchingSqft).toLocaleString('en-IN')}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {row.pendingZones} / {row.inProgressZones}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono font-semibold text-emerald-800">
                      {row.completedZones} ({row.progressPct}%)
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {breakdownLevel === 'flat' && (
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="py-2 px-2.5">Flat / Unit</th>
                <th className="py-2 px-2">Tower · Floor</th>
                <th className="py-2 px-2 text-right">P / IP / D</th>
                <th className="py-2 px-2 text-right">Sq.Ft</th>
                <th className="py-2 px-2.5">Matched Tile Areas &amp; Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {overview.flatRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No flats match the active filters.
                  </td>
                </tr>
              ) : (
                overview.flatRows.slice(0, 150).map((row) => (
                  <tr key={row.flat.id} className="align-top">
                    <td className="py-1.5 px-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {row.flat.unitNumber}{' '}
                      <span className="font-sans font-normal text-slate-600">
                        ({row.flat.unitType})
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-slate-700 whitespace-nowrap">
                      {row.towerName} · {row.floorLabel}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono whitespace-nowrap">
                      {row.pendingZones}/{row.inProgressZones}/{row.completedZones}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono font-semibold whitespace-nowrap">
                      {Math.round(row.matchingSqft).toLocaleString('en-IN')}
                    </td>
                    <td className="py-1.5 px-2.5">
                      <div className="flex flex-wrap gap-1">
                        {row.matchingZoneDetails.map((d) => (
                          <span
                            key={d.zoneKey}
                            className="inline-block px-1.5 py-0.5 text-[10px] bg-slate-50 border border-slate-200 rounded text-slate-800"
                          >
                            <strong>{d.label}</strong> ({d.sqft} sf · {ZONE_STATUS_LABELS[d.status]})
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </section>

      {breakdownLevel === 'flat' && overview.flatRows.length > 150 && (
        <p className="text-[10px] text-slate-500">
          Showing first 150 matching flats on printable sheet. Narrow Tower / Floor filter or download Exact PDF for full flat rows.
        </p>
      )}

      {/* Signature Strip */}
      <footer className="pt-8 grid grid-cols-2 gap-12 text-[11px] text-slate-700">
        <div>
          <div className="border-t border-slate-400 pt-1.5 font-semibold">
            Site Supervisor / Engineer Verification
          </div>
          <div className="text-[10px] text-slate-500">Name &amp; Date</div>
        </div>
        <div className="text-right">
          <div className="border-t border-slate-400 pt-1.5 font-semibold">
            For {company.companyName} — Authorized Signatory
          </div>
          <div className="text-[10px] text-slate-500">
            {company.signatoryName || 'Project Manager / Director'}
          </div>
        </div>
      </footer>
    </article>
  );
}
