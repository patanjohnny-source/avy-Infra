import React from 'react';
import type { CompanyProfile } from '../types/avy';
import type { SingleEmployeeAttendanceCard } from '../utils/operations';
import { ATTENDANCE_STATUS_LABELS, formatINR } from '../utils/payroll';

interface PrintableAttendanceCardSheetProps {
  company: CompanyProfile;
  card: SingleEmployeeAttendanceCard;
  siteLabel: string;
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function PrintableAttendanceCardSheet({
  company,
  card,
  siteLabel,
}: PrintableAttendanceCardSheetProps) {
  const { employee } = card;
  const estNet = Math.max(0, card.totalWagesEarned - card.monthAdvancesTotal);
  const printedOn = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const leftHalfDays = card.days.slice(0, 16);
  const rightHalfDays = card.days.slice(16);

  return (
    <article
      data-testid="printable-attendance-card-sheet"
      className="invoice-a4-page bg-white text-slate-900 border border-slate-200 rounded shadow-sm mx-auto p-6 space-y-4 text-xs"
    >
      {/* Top Company & Card Header */}
      <header className="flex items-start justify-between gap-4 pb-3 border-b-2 border-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          {company.logoDataUrl && (
            <img
              src={company.logoDataUrl}
              alt={company.companyName}
              className="w-11 h-11 object-contain border border-slate-200 rounded p-0.5 shrink-0"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-base font-bold uppercase tracking-tight text-slate-900">
              {company.companyName}
            </h1>
            <p className="text-[11px] text-slate-600">
              {company.tagline || 'Tile Laying & Stone Finishing Contractors'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono">
              {company.hrContact ? `HR Contact: ${company.hrContact}` : ''}
              {company.address ? ` · ${company.address}` : ''}
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="inline-block px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-orange-300 rounded">
            Worker Attendance Card
          </div>
          <div className="text-sm font-bold text-slate-900 mt-1">{card.monthLabel}</div>
          <div className="text-[10px] font-mono text-slate-500">Printed: {printedOn}</div>
        </div>
      </header>

      {/* Worker Identity Card Strip */}
      <section className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-200 rounded">
        <div className="w-14 h-16 rounded border border-slate-300 bg-white overflow-hidden flex items-center justify-center shrink-0">
          {employee.photoDataUrl ? (
            <img
              src={employee.photoDataUrl}
              alt={employee.fullName}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="font-mono font-bold text-base text-slate-500">
              {employee.fullName
                .split(' ')
                .slice(0, 2)
                .map((n) => n[0])
                .join('')
                .toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <div className="text-[10px] uppercase text-slate-500 font-semibold">Worker Name</div>
            <div className="text-sm font-bold text-slate-900">{employee.fullName}</div>
            <div className="text-[11px] font-mono text-orange-800 font-semibold">
              ID: {employee.empCode}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500 font-semibold">Trade / Role</div>
            <div className="font-semibold text-slate-900">{employee.role}</div>
            <div className="text-[11px] font-mono text-slate-600">{employee.phone}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500 font-semibold">Site / Tower</div>
            <div className="font-semibold text-slate-900">{siteLabel}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500 font-semibold">Wage Rates</div>
            <div className="font-mono font-semibold text-slate-900">
              {formatINR(employee.dailyRate)} / day
            </div>
            <div className="text-[11px] font-mono text-slate-600">
              OT: {formatINR(employee.overtimeRate || Math.round(employee.dailyRate / 8))}/hr
            </div>
          </div>
        </div>
      </section>

      {/* Clear 6-Box Summary Strip */}
      <section className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        <div className="p-2 rounded border border-emerald-200 bg-emerald-50">
          <div className="text-[10px] font-semibold text-emerald-800">Present (P)</div>
          <div className="text-base font-mono font-bold text-emerald-900">{card.presentDays}</div>
        </div>
        <div className="p-2 rounded border border-amber-200 bg-amber-50">
          <div className="text-[10px] font-semibold text-amber-800">Half-Day (HD)</div>
          <div className="text-base font-mono font-bold text-amber-900">{card.halfDays}</div>
        </div>
        <div className="p-2 rounded border border-red-200 bg-red-50">
          <div className="text-[10px] font-semibold text-red-800">Absent (A)</div>
          <div className="text-base font-mono font-bold text-red-900">{card.absentDays}</div>
        </div>
        <div className="p-2 rounded border border-slate-200 bg-white">
          <div className="text-[10px] font-semibold text-slate-600">Paid Days / OT</div>
          <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">
            {card.effectiveDays}d · {card.overtimeHours}h
          </div>
        </div>
        <div className="p-2 rounded border border-slate-200 bg-white">
          <div className="text-[10px] font-semibold text-slate-600">Month Wages</div>
          <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">
            {formatINR(card.totalWagesEarned)}
          </div>
        </div>
        <div className="p-2 rounded border border-slate-800 bg-slate-900 text-white">
          <div className="text-[10px] text-slate-300">Adv / Net Est.</div>
          <div className="text-xs font-mono font-bold text-emerald-300 mt-0.5">
            -{formatINR(card.monthAdvancesTotal)} | {formatINR(estNet)}
          </div>
        </div>
      </section>

      {/* Visual Calendar Grid (Worker-friendly P / HD / A overview) */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
          <span>Monthly Calendar Overview ({card.monthLabel})</span>
          <span className="font-mono text-[10px] text-slate-500">
            P = Full Day · HD = Half Day · A = Absent · - = Unmarked
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
          {WEEKDAY_HEADERS.map((wd) => (
            <div
              key={wd}
              className="py-1 font-semibold bg-slate-100 text-slate-700 border border-slate-200 rounded-sm"
            >
              {wd}
            </div>
          ))}
          {Array.from({ length: card.mondayOffset }).map((_, idx) => (
            <div key={`pad-${idx}`} className="h-9 bg-slate-50/60 border border-slate-100 rounded-sm" />
          ))}
          {card.days.map((cell) => {
            const shortCode =
              cell.status === 'present'
                ? 'P'
                : cell.status === 'half_day'
                  ? 'HD'
                  : cell.status === 'absent'
                    ? 'A'
                    : '-';
            const badgeCls =
              cell.status === 'present'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : cell.status === 'half_day'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : cell.status === 'absent'
                    ? 'bg-red-50 border-red-300 text-red-900'
                    : 'bg-white border-slate-200 text-slate-400';
            return (
              <div
                key={cell.date}
                className={`h-9 px-1 py-0.5 border rounded-sm flex flex-col justify-between ${badgeCls}`}
              >
                <div className="flex items-center justify-between text-[9px] font-mono">
                  <span className="font-semibold">{cell.day}</span>
                  {cell.overtimeHours > 0 && (
                    <span className="text-[8px] font-bold">+{cell.overtimeHours}h</span>
                  )}
                </div>
                <div className="font-mono font-bold text-[11px] leading-none">{shortCode}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Compact Two-Column Date-Wise Log */}
      <section className="space-y-1.5">
        <div className="text-[11px] font-semibold text-slate-700">Date-Wise Attendance Log</div>
        <div className="grid grid-cols-2 gap-3">
          {[leftHalfDays, rightHalfDays].map((slice, colIdx) => (
            <table
              key={colIdx}
              className="w-full text-left border-collapse border border-slate-200 text-[10px]"
            >
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-600">
                  <th className="py-1 px-1.5">Date</th>
                  <th className="py-1 px-1.5">Status</th>
                  <th className="py-1 px-1.5 text-right">OT</th>
                  <th className="py-1 px-1.5 text-right">Wage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {slice.map((d) => (
                  <tr key={d.date}>
                    <td className="py-0.5 px-1.5 font-mono text-slate-800 whitespace-nowrap">
                      {String(d.day).padStart(2, '0')} ({d.weekdayShort})
                    </td>
                    <td
                      className={`py-0.5 px-1.5 font-semibold ${
                        d.status === 'present'
                          ? 'text-emerald-800'
                          : d.status === 'half_day'
                            ? 'text-amber-800'
                            : d.status === 'absent'
                              ? 'text-red-700'
                              : 'text-slate-400'
                      }`}
                    >
                      {d.status ? ATTENDANCE_STATUS_LABELS[d.status] : '—'}
                    </td>
                    <td className="py-0.5 px-1.5 text-right font-mono text-slate-600">
                      {d.overtimeHours > 0 ? `${d.overtimeHours}h` : '—'}
                    </td>
                    <td className="py-0.5 px-1.5 text-right font-mono font-semibold text-slate-900">
                      {d.earned > 0 ? formatINR(d.earned) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </section>

      {/* Worker & Supervisor Signature Strip */}
      <footer className="pt-6 grid grid-cols-2 gap-12 text-[11px] text-slate-700">
        <div>
          <div className="border-t border-slate-400 pt-1.5 font-semibold">
            Worker Signature / Thumb Impression ({employee.fullName})
          </div>
          <div className="text-[10px] text-slate-500">Attendance &amp; Advance Acknowledged</div>
        </div>
        <div className="text-right">
          <div className="border-t border-slate-400 pt-1.5 font-semibold">
            Site Supervisor / Authorized Signatory ({company.companyName})
          </div>
          <div className="text-[10px] text-slate-500">Verified &amp; Issued</div>
        </div>
      </footer>
    </article>
  );
}
