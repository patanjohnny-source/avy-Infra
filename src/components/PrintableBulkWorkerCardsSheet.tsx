import React from 'react';
import type { CompanyProfile } from '../types/avy';
import {
  type BulkCardLayout,
  type BulkPaperSize,
  type BulkWorkerCardModel,
  getBulkCardLayoutSpec,
  getBulkPaperSpec,
  paginateBulkWorkerCards,
} from '../utils/bulkWorkerCards';
import { formatINR } from '../utils/payroll';
import { QrCodeSvg } from './QrCodeSvg';

interface PrintableBulkWorkerCardsSheetProps {
  company: CompanyProfile;
  cards: BulkWorkerCardModel[];
  paperSize: BulkPaperSize;
  layout: BulkCardLayout;
  monthLabel: string;
  showCutMarks: boolean;
  showWageSummary: boolean;
}

export function PrintableBulkWorkerCardsSheet({
  company,
  cards,
  paperSize,
  layout,
  monthLabel,
  showCutMarks,
  showWageSummary,
}: PrintableBulkWorkerCardsSheetProps) {
  const paperSpec = getBulkPaperSpec(paperSize);
  const layoutSpec = getBulkCardLayoutSpec(layout);
  const pages = paginateBulkWorkerCards(cards, layoutSpec.cardsPerPage);

  const headerColor = company.idCardHeaderColor || '#0f172a';
  const accentColor = company.idCardAccentColor || '#c2410c';
  const baseBgColor = company.idCardBgColor || '#ffffff';
  const textColor = company.idCardTextColor || '#0f172a';
  const frontBgUrl = company.idCardFrontBgDataUrl || '';
  const bgOpacity =
    typeof company.idCardBgOpacity === 'number' ? company.idCardBgOpacity : 0.16;

  if (pages.length === 0) {
    return (
      <div className="no-dark-invert bg-white text-slate-900 border border-slate-200 rounded p-12 text-center">
        <p className="text-sm font-semibold">No workers selected for printing.</p>
        <p className="text-xs text-slate-500 mt-1">
          Select one or more workers from Workforce view to generate paginated profile &amp; attendance cards.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="printable-bulk-worker-cards"
      data-paper-size={paperSize}
      data-card-layout={layout}
      className="no-dark-invert space-y-6 print:space-y-0"
    >
      {pages.map((page) => (
        <section
          key={page.pageNumber}
          data-testid={`bulk-card-page-${page.pageNumber}`}
          className="bulk-card-page no-dark-invert bg-white text-slate-900 border border-slate-300 rounded shadow-md mx-auto flex flex-col justify-between overflow-hidden"
          style={{
            width: `${paperSpec.contentWidthMm}mm`,
            minHeight: `${paperSpec.contentHeightMm}mm`,
            padding: '3.5mm',
          }}
        >
          {/* Sheet Header Strip */}
          <div className="flex items-center justify-between gap-3 pb-2 mb-2.5 border-b border-slate-300 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {company.logoDataUrl && (
                <img
                  src={company.logoDataUrl}
                  alt={company.companyName}
                  className="w-6 h-6 object-contain border border-slate-200 rounded bg-white p-0.5 shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-tight text-slate-900 truncate">
                  {company.companyName} — Bulk Worker Profile &amp; Attendance Cards
                </div>
                <div className="text-[9px] font-mono text-slate-600 truncate">
                  Period: {monthLabel} · Layout: {layoutSpec.shortLabel} ({paperSpec.shortLabel}) · Batch: {cards.length} Workers
                </div>
              </div>
            </div>
            <div className="text-right shrink-0 font-mono text-[9.5px] font-semibold text-slate-800">
              Page {page.pageNumber} of {page.totalPages}
            </div>
          </div>

          {/* Cards Grid */}
          <div
            className="flex-1 grid gap-2.5"
            style={{
              gridTemplateColumns: `repeat(${layoutSpec.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layoutSpec.rows}, minmax(0, 1fr))`,
            }}
          >
            {page.cards.map((model) => {
              const { employee: emp, attendanceCard: att, payrollSummary: pay } = model;
              return (
                <article
                  key={emp.id}
                  data-testid={`bulk-worker-card-${emp.empCode}`}
                  className={`bulk-worker-card relative rounded overflow-hidden flex flex-col justify-between ${
                    showCutMarks
                      ? 'border border-dashed border-slate-400'
                      : 'border border-slate-300'
                  }`}
                  style={{
                    backgroundColor: baseBgColor,
                    color: textColor,
                  }}
                >
                  {frontBgUrl && (
                    <img
                      src={frontBgUrl}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      style={{ opacity: Math.min(0.22, bgOpacity) }}
                    />
                  )}

                  {/* Card Top Branded Header */}
                  <div className="relative z-10 shrink-0">
                    <div
                      className="px-3 py-1.5 text-white flex items-center justify-between gap-2"
                      style={{ backgroundColor: headerColor }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {company.logoDataUrl ? (
                          <img
                            src={company.logoDataUrl}
                            alt=""
                            className="w-5 h-5 rounded bg-white p-0.5 object-contain shrink-0"
                          />
                        ) : (
                          <div
                            className="w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center shrink-0 text-white"
                            style={{ backgroundColor: accentColor }}
                          >
                            {company.companyName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold tracking-tight truncate">
                            {company.companyName}
                          </div>
                          {layout === 'profile_attendance_2up' && (
                            <div className="text-[8px] text-slate-200 truncate">
                              {company.tagline || 'Tile Laying & Stone Finishing'} · {att.monthLabel}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-[9.5px] font-bold text-orange-200 shrink-0">
                        {emp.empCode} · {emp.role}
                      </span>
                    </div>
                    <div className="h-[3px]" style={{ backgroundColor: accentColor }} />
                  </div>

                  {/* Card Body */}
                  {layout === 'profile_attendance_2up' ? (
                    <div className="relative z-10 flex-1 px-3 py-2 flex flex-col justify-between gap-2">
                      {/* Profile + QR Row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <div
                            className="w-16 h-20 rounded border-2 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0"
                            style={{ borderColor: accentColor }}
                          >
                            {emp.photoDataUrl ? (
                              <img
                                src={emp.photoDataUrl}
                                alt={emp.fullName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="font-bold text-base text-slate-500">
                                {model.initials}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="text-sm font-bold leading-tight truncate">
                                {emp.fullName}
                              </h3>
                              <span className="text-[9px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-800">
                                {emp.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9.5px]">
                              <div className="truncate">
                                <span className="opacity-70">Site:</span>{' '}
                                <strong className="font-semibold">{model.siteLabel}</strong>
                              </div>
                              <div className="font-mono tabular-nums truncate">
                                <span className="opacity-70">Mobile:</span>{' '}
                                <strong className="font-semibold">{emp.phone}</strong>
                              </div>
                              <div className="truncate">
                                <span className="opacity-70">Blood:</span>{' '}
                                <strong className="text-red-700 font-bold">
                                  {emp.bloodGroup || 'N/A'}
                                </strong>
                                <span className="opacity-70 ml-2">Joined:</span>{' '}
                                <span className="font-mono">{emp.joiningDate}</span>
                              </div>
                              <div className="font-mono truncate">
                                <span className="opacity-70">Emergency:</span>{' '}
                                {emp.emergencyContact || '—'}
                              </div>
                              <div className="font-mono truncate col-span-2 text-[9px]">
                                <span className="opacity-70">Aadhaar:</span>{' '}
                                {emp.aadharRef || 'Not recorded'}
                                <span className="opacity-70 ml-2">PF/UAN:</span>{' '}
                                {emp.pfNumber || 'Pending'}
                                <span className="opacity-70 ml-2">ESI:</span>{' '}
                                {emp.esiNumber || 'Pending'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Scannable QR Pass */}
                        <div className="flex flex-col items-center p-1 bg-white border border-slate-200 rounded shrink-0">
                          <QrCodeSvg
                            value={model.scanUrl}
                            size={66}
                            ariaLabel={`QR Pass for ${emp.fullName}`}
                          />
                          <span className="text-[7px] font-mono font-bold uppercase text-slate-700 mt-0.5">
                            Scan QR Pass
                          </span>
                        </div>
                      </div>

                      {/* Monthly Attendance KPIs */}
                      <div
                        className={`grid ${
                          showWageSummary ? 'grid-cols-6' : 'grid-cols-4'
                        } gap-1.5 text-center`}
                      >
                        <div className="px-1.5 py-1 rounded border border-emerald-200 bg-emerald-50">
                          <div className="text-[8px] font-semibold text-emerald-800">Present</div>
                          <div className="text-xs font-mono font-bold tabular-nums text-emerald-900">
                            {att.presentDays}
                          </div>
                        </div>
                        <div className="px-1.5 py-1 rounded border border-amber-200 bg-amber-50">
                          <div className="text-[8px] font-semibold text-amber-800">Half-Day</div>
                          <div className="text-xs font-mono font-bold tabular-nums text-amber-900">
                            {att.halfDays}
                          </div>
                        </div>
                        <div className="px-1.5 py-1 rounded border border-red-200 bg-red-50">
                          <div className="text-[8px] font-semibold text-red-800">Absent</div>
                          <div className="text-xs font-mono font-bold tabular-nums text-red-900">
                            {att.absentDays}
                          </div>
                        </div>
                        <div className="px-1.5 py-1 rounded border border-slate-200 bg-white">
                          <div className="text-[8px] font-semibold text-slate-600">Paid / OT</div>
                          <div className="text-[11px] font-mono font-bold tabular-nums text-slate-900">
                            {att.effectiveDays}d · {att.overtimeHours}h
                          </div>
                        </div>
                        {showWageSummary && (
                          <>
                            <div className="px-1.5 py-1 rounded border border-slate-200 bg-white">
                              <div className="text-[8px] font-semibold text-slate-600">
                                Month Wage
                              </div>
                              <div className="text-[10.5px] font-mono font-bold tabular-nums text-slate-900">
                                {formatINR(att.totalWagesEarned)}
                              </div>
                            </div>
                            <div className="px-1.5 py-1 rounded border border-slate-800 bg-slate-900 text-white">
                              <div className="text-[8px] text-slate-300">Net Payable</div>
                              <div className="text-[10.5px] font-mono font-bold tabular-nums text-emerald-300">
                                {formatINR(pay.netPayable)}
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {/* 31-Day Compact Muster Strip */}
                      <div>
                        <div className="flex items-center justify-between text-[8.5px] font-semibold text-slate-700 mb-1">
                          <span>Daily Muster Grid ({att.monthLabel})</span>
                          <span className="font-mono text-[8px] text-slate-500">
                            P = Present · H = Half-Day · A = Absent · · = Unmarked
                          </span>
                        </div>
                        <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-0.5 text-center">
                          {att.days.map((dCell) => {
                            const code =
                              dCell.status === 'present'
                                ? 'P'
                                : dCell.status === 'half_day'
                                  ? 'H'
                                  : dCell.status === 'absent'
                                    ? 'A'
                                    : '·';
                            const cellCls =
                              dCell.status === 'present'
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : dCell.status === 'half_day'
                                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                                  : dCell.status === 'absent'
                                    ? 'bg-red-50 border-red-300 text-red-900'
                                    : 'bg-white border-slate-200 text-slate-400';
                            return (
                              <div
                                key={dCell.date}
                                className={`border rounded-[2px] py-0.5 leading-none ${cellCls}`}
                              >
                                <div className="text-[6.5px] font-mono opacity-75">
                                  {dCell.day}
                                </div>
                                <div className="text-[8.5px] font-mono font-bold mt-0.5">
                                  {code}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Signature Footer */}
                      <div className="pt-2 flex items-end justify-between text-[8.5px] text-slate-600">
                        <div className="w-40 border-t border-slate-400 pt-0.5 font-medium">
                          Worker Signature / Thumb
                        </div>
                        <div className="font-mono text-[8px] text-slate-500">
                          HR: {company.hrContact}
                        </div>
                        <div className="w-40 border-t border-slate-400 pt-0.5 font-medium text-right">
                          Site Supervisor Verification
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 4-Up Portrait ID Cards OR 6-Up Compact Wallet Pass Grid */
                    <>
                      <div
                        className={`relative z-10 flex-1 flex flex-col ${
                          layout === 'id_grid_6up'
                            ? 'justify-between px-2.5 py-1.5 gap-1'
                            : 'justify-between px-3 py-2.5 gap-2'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className={`${
                              layout === 'id_grid_6up' ? 'w-12 h-14' : 'w-16 h-20'
                            } rounded border-2 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0`}
                            style={{ borderColor: accentColor }}
                          >
                            {emp.photoDataUrl ? (
                              <img
                                src={emp.photoDataUrl}
                                alt={emp.fullName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="font-bold text-sm text-slate-500">
                                {model.initials}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div
                              className={`font-bold leading-tight truncate ${
                                layout === 'id_grid_6up' ? 'text-xs' : 'text-sm'
                              }`}
                            >
                              {emp.fullName}
                            </div>
                            <div className="text-[9.5px] font-mono tabular-nums text-slate-700 truncate">
                              Mob: <strong>{emp.phone}</strong>
                            </div>
                            <div className="text-[9.5px] text-slate-700 truncate">
                              Blood:{' '}
                              <strong className="text-red-700 font-bold">
                                {emp.bloodGroup || 'N/A'}
                              </strong>
                              {layout === 'id_grid_4up' && (
                                <span className="ml-1.5 font-mono text-[8.5px] text-slate-600">
                                  · Joined {emp.joiningDate}
                                </span>
                              )}
                            </div>
                            <div className="text-[9.5px] text-slate-700 line-clamp-2 leading-tight">
                              {model.siteLabel}
                            </div>
                          </div>

                          <div className="p-0.5 bg-white border border-slate-200 rounded shrink-0">
                            <QrCodeSvg
                              value={model.scanUrl}
                              size={layout === 'id_grid_6up' ? 48 : 62}
                              ariaLabel={`QR Pass for ${emp.fullName}`}
                            />
                          </div>
                        </div>

                        {layout === 'id_grid_4up' && (
                          <dl className="grid grid-cols-2 gap-x-2.5 gap-y-1 px-2.5 py-2 rounded border border-slate-200 bg-slate-50/80 text-[8.5px]">
                            <div className="truncate">
                              <dt className="text-slate-500 uppercase text-[7.5px] font-semibold">
                                Aadhaar Ref
                              </dt>
                              <dd className="font-mono font-medium text-slate-900 truncate">
                                {emp.aadharRef || 'Not recorded'}
                              </dd>
                            </div>
                            <div className="truncate">
                              <dt className="text-slate-500 uppercase text-[7.5px] font-semibold">
                                Emergency Contact
                              </dt>
                              <dd className="font-mono font-medium text-slate-900 truncate">
                                {emp.emergencyContact || 'Not recorded'}
                              </dd>
                            </div>
                            <div className="truncate">
                              <dt className="text-slate-500 uppercase text-[7.5px] font-semibold">
                                PF / UAN
                              </dt>
                              <dd className="font-mono font-medium text-slate-900 truncate">
                                {emp.pfNumber || 'Pending'}
                              </dd>
                            </div>
                            <div className="truncate">
                              <dt className="text-slate-500 uppercase text-[7.5px] font-semibold">
                                ESI Number
                              </dt>
                              <dd className="font-mono font-medium text-slate-900 truncate">
                                {emp.esiNumber || 'Pending'}
                              </dd>
                            </div>
                          </dl>
                        )}

                        {/* Monthly Attendance & Wage Strip */}
                        <div className="bg-slate-50/90 border border-slate-200 rounded px-2.5 py-1.5 space-y-1.5">
                          <div className="flex items-center justify-between text-[9px] font-semibold text-slate-700">
                            <span>{att.monthLabel} Attendance</span>
                            <span className="font-mono tabular-nums">
                              Eff: {att.effectiveDays}d · OT: {att.overtimeHours}h
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5 text-center font-mono tabular-nums text-[9.5px]">
                            <div className="py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold">
                              P: {att.presentDays}
                            </div>
                            <div className="py-1 rounded bg-amber-50 border border-amber-200 text-amber-900 font-bold">
                              HD: {att.halfDays}
                            </div>
                            <div className="py-1 rounded bg-red-50 border border-red-200 text-red-900 font-bold">
                              A: {att.absentDays}
                            </div>
                          </div>
                          {showWageSummary && (
                            <div className="flex items-center justify-between text-[9px] font-mono tabular-nums pt-1 border-t border-slate-200 text-slate-800">
                              <span>Wages: {formatINR(att.totalWagesEarned)}</span>
                              <span className="font-bold text-emerald-800">
                                Net: {formatINR(pay.netPayable)}
                              </span>
                            </div>
                          )}
                        </div>

                        {layout === 'id_grid_4up' && (
                          <div className="pt-3 flex items-end justify-between text-[8.5px] text-slate-600">
                            <span className="w-32 border-t border-slate-400 pt-0.5">
                              Worker Signature
                            </span>
                            <span className="w-32 border-t border-slate-400 pt-0.5 text-right">
                              Supervisor Sign
                            </span>
                          </div>
                        )}
                      </div>

                      <div
                        className="relative z-10 px-2.5 py-1.5 text-white flex items-center justify-between text-[8px] font-mono shrink-0"
                        style={{ backgroundColor: headerColor }}
                      >
                        <span className="uppercase font-semibold">STATUS: {emp.status}</span>
                        <span>HR: {company.hrContact}</span>
                      </div>
                    </>
                  )}
                </article>
              );
            })}

            {/* Keep grid symmetry when final page has fewer than full page capacity */}
            {Array.from({ length: page.emptySlots }).map((_, emptyIdx) => (
              <div
                key={`empty-slot-${emptyIdx}`}
                aria-hidden="true"
                className="rounded border border-transparent"
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
