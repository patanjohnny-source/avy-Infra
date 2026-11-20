import React from 'react';
import { Phone, ShieldCheck } from 'lucide-react';
import type { CompanyProfile, Employee } from '../types/avy';
import { formatHumanDate, sanitizeRichHtml, type GeneratedEmployeeDocument } from '../utils/hrDocuments';
import { formatINR } from '../utils/payroll';

interface LetterheadPreviewSheetProps {
  company: CompanyProfile;
  refNumber: string;
  issueDate: string;
  recipient: string;
  subject: string;
  bodyHtml: string;
  fontClass?: string;
  employee?: Employee;
  payslip?: GeneratedEmployeeDocument['payslip'];
  travelMeta?: GeneratedEmployeeDocument['travelMeta'];
  showCompanySeal?: boolean;
}

export function LetterheadPreviewSheet({
  company,
  refNumber,
  issueDate,
  recipient,
  subject,
  bodyHtml,
  fontClass = 'font-sans',
  employee,
  payslip,
  travelMeta,
  showCompanySeal = true,
}: LetterheadPreviewSheetProps) {
  const companyName = company.companyName || 'AVY INFRA';
  const cleanHtml = sanitizeRichHtml(bodyHtml);

  return (
    <div
      data-testid="letterhead-a4-sheet"
      className={`invoice-a4-page no-dark-invert bg-white text-slate-900 border border-slate-300 shadow-sm rounded-sm mx-auto w-full max-w-[794px] min-h-[1040px] flex flex-col justify-between overflow-hidden ${fontClass}`}
    >
      <div>
        {/* Top Corporate Accent Strip */}
        <div className="h-2 bg-orange-700 w-full" />

        {/* Company Letterhead Header */}
        <header className="px-8 pt-6 pb-4 border-b-2 border-orange-700 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 bg-white">
          <div className="flex items-start gap-3.5 flex-1 min-w-0">
            {company.logoDataUrl && company.logoDataUrl.startsWith('data:image/') ? (
              <img
                src={company.logoDataUrl}
                alt={`${companyName} logo`}
                className="w-16 h-16 object-contain rounded border border-slate-200 bg-white p-1 shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded bg-slate-900 text-white flex items-center justify-center font-display font-bold text-xl tracking-tight shrink-0">
                {companyName.slice(0, 3).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 uppercase leading-tight">
                {companyName}
              </h1>
              <p className="text-xs font-semibold uppercase tracking-wider text-orange-700 mt-0.5">
                {company.tagline || 'Construction, Tiling & Interior Contractors'}
              </p>
              {company.address && (
                <p className="text-[11px] text-slate-600 mt-1 max-w-sm leading-snug">
                  {company.address}
                </p>
              )}
            </div>
          </div>

          <div className="text-left sm:text-right text-[11px] text-slate-700 space-y-0.5 shrink-0">
            <div>
              <span className="font-semibold text-slate-900">HR / Verification:</span>{' '}
              <span className="font-mono">{company.hrContact || '-'}</span>
            </div>
            {company.hrEmail && (
              <div>
                <span className="font-semibold text-slate-900">Email:</span> {company.hrEmail}
              </div>
            )}
            {company.gstNumber && (
              <div>
                <span className="font-semibold text-slate-900">GSTIN:</span>{' '}
                <span className="font-mono">{company.gstNumber}</span>
              </div>
            )}
            {(company.pfEstCode || company.esiCode) && (
              <div className="text-[10px] text-slate-500 font-mono">
                {company.pfEstCode ? `PF: ${company.pfEstCode}` : ''}
                {company.pfEstCode && company.esiCode ? ' · ' : ''}
                {company.esiCode ? `ESI: ${company.esiCode}` : ''}
              </div>
            )}
          </div>
        </header>

        {/* Reference & Issue Date Strip */}
        <div className="px-8 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-700">
          <div>
            <span className="font-semibold text-slate-900">Ref No:</span>{' '}
            <span className="font-mono">{refNumber}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-900">Date:</span>{' '}
            <span className="font-mono">{formatHumanDate(issueDate)}</span>
          </div>
        </div>

        {/* Main Letter Content Area */}
        <div className="px-8 py-6 space-y-5 text-[13px] leading-relaxed text-slate-800">
          {/* Recipient + Optional Photo Badge */}
          <div className="flex items-start justify-between gap-4">
            {recipient.trim() ? (
              <div className="whitespace-pre-line text-slate-800 font-medium text-[13px]">
                {recipient}
              </div>
            ) : (
              <div />
            )}

            {employee && (
              <div className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded shrink-0">
                {employee.photoDataUrl && employee.photoDataUrl.startsWith('data:image/') ? (
                  <img
                    src={employee.photoDataUrl}
                    alt={employee.fullName}
                    className="w-12 h-14 object-cover rounded border border-slate-300 bg-white"
                  />
                ) : (
                  <div className="w-12 h-14 rounded bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm">
                    {employee.fullName
                      .split(' ')
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                )}
                <div className="text-[11px] leading-snug">
                  <div className="font-mono font-bold text-slate-900">{employee.empCode}</div>
                  <div className="font-semibold text-slate-800">{employee.fullName}</div>
                  <div className="text-slate-600">{employee.role}</div>
                  <div className="font-mono text-slate-500">{employee.phone}</div>
                </div>
              </div>
            )}
          </div>

          {/* Subject Line */}
          {subject.trim() && (
            <div className="px-3.5 py-2.5 bg-slate-50 border-l-4 border-orange-700 text-slate-900 font-semibold text-sm">
              Subject: {subject}
            </div>
          )}

          {/* Structured Payslip Statement Table (when docType === 'payslip') */}
          {payslip && employee && (
            <div className="border border-slate-300 rounded overflow-hidden">
              <div className="px-4 py-2 bg-slate-900 text-white flex items-center justify-between text-xs font-semibold">
                <span>OFFICIAL PAYSLIP STATEMENT — {payslip.monthLabel.toUpperCase()}</span>
                <span className="font-mono">{employee.empCode}</span>
              </div>
              <div className="grid grid-cols-2 border-b border-slate-200 text-xs">
                <div className="p-3 border-r border-slate-200 space-y-1">
                  <div className="font-semibold text-slate-900 uppercase text-[11px] mb-1.5">
                    Attendance &amp; Rate
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Daily / OT Rate:</span>
                    <span className="font-mono font-medium">
                      {formatINR(employee.dailyRate)}/d · {formatINR(employee.overtimeRate)}/h
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Present / Half / Absent:</span>
                    <span className="font-mono font-medium">
                      {payslip.summary.presentDays}P / {payslip.summary.halfDays}H /{' '}
                      {payslip.summary.absentDays}A
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Effective Days + OT:</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {payslip.summary.effectiveDaysWorked} d + {payslip.summary.overtimeHours}h
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-1">
                  <div className="font-semibold text-slate-900 uppercase text-[11px] mb-1.5">
                    Earnings &amp; Deductions
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Wages + OT Earned:</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {formatINR(payslip.summary.totalEarned)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Food &amp; Cash Advances:</span>
                    <span className="font-mono text-red-700">
                      - {formatINR(payslip.summary.totalAdvances)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Already Settled:</span>
                    <span className="font-mono text-slate-700">
                      - {formatINR(payslip.summary.totalSettled)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="px-4 py-2.5 bg-emerald-50 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-700">
                  <strong>In Words:</strong> {payslip.amountInWords}
                </span>
                <span className="font-mono text-sm font-bold text-emerald-900">
                  NET PAYABLE: {formatINR(payslip.summary.netPayable)}
                </span>
              </div>
            </div>
          )}

          {/* Structured Travel & Security Clearance Card (when docType === 'travel_security_letter') */}
          {travelMeta && employee && (
            <div className="border border-slate-300 rounded overflow-hidden bg-slate-50">
              <div className="px-4 py-2 bg-slate-900 text-white flex items-center justify-between text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                  <span>TRANSIT &amp; GATE SECURITY VERIFICATION PASS</span>
                </span>
                <span className="font-mono">{employee.empCode}</span>
              </div>
              <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div>
                  <span className="text-slate-500">Travel Route:</span>{' '}
                  <span className="font-semibold text-slate-900">{travelMeta.route}</span>
                </div>
                <div>
                  <span className="text-slate-500">Valid Period:</span>{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {formatHumanDate(travelMeta.validFrom)} to {formatHumanDate(travelMeta.validTo)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Aadhaar Ref:</span>{' '}
                  <span className="font-mono font-medium text-slate-900">
                    {travelMeta.maskedAadhaar}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Blood Group / Emergency:</span>{' '}
                  <span className="font-mono font-medium text-slate-900">
                    {travelMeta.bloodGroup} · {travelMeta.emergencyContact}
                  </span>
                </div>
                <div className="sm:col-span-2 pt-1 mt-1 border-t border-slate-200 flex items-center gap-1.5 text-orange-800 font-semibold">
                  <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    24×7 Employer Security &amp; Police Verification Helpline:{' '}
                    <span className="font-mono">{travelMeta.verificationPhone}</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Rich Letter Body */}
          <div
            className="space-y-3 [&_p]:leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-slate-900 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-slate-900 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_td]:border [&_td]:border-slate-300 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-xs"
            dangerouslySetInnerHTML={{ __html: cleanHtml }}
          />
        </div>
      </div>

      {/* Authorized Signatory & Footer */}
      <footer className="px-8 pb-6 pt-8 space-y-5">
        <div className="flex items-end justify-between gap-6">
          <div className="text-[11px] text-slate-500 max-w-xs">
            Issued digitally on official company letterhead. Verify authenticity anytime via HR desk{' '}
            <span className="font-mono text-slate-700">{company.hrContact}</span>.
          </div>

          <div className="flex items-end gap-4 text-right">
            {showCompanySeal && (
              <div className="w-20 h-20 rounded-full border-2 border-dashed border-orange-700/70 flex flex-col items-center justify-center text-center p-1 text-orange-800 rotate-[-8deg] select-none">
                <span className="text-[8px] font-bold uppercase leading-tight tracking-wide">
                  {companyName.slice(0, 14)}
                </span>
                <span className="text-[7px] font-mono border-t border-b border-orange-700/40 my-0.5 px-1">
                  VERIFIED
                </span>
                <span className="text-[7px] uppercase">OFFICIAL SEAL</span>
              </div>
            )}
            <div className="space-y-4">
              <div className="text-xs text-slate-700">
                For <strong>{companyName}</strong>
              </div>
              <div className="pt-4 border-t border-slate-400 min-w-[170px]">
                <div className="text-xs font-bold text-slate-900">
                  {company.signatoryName || 'Authorized Signatory'}
                </div>
                <div className="text-[10px] text-slate-500">
                  Authorized Signatory &amp; HR Desk
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2.5 border-t border-slate-200 text-center text-[10px] text-slate-500">
          {companyName} · {company.address || 'Registered Site Office'} · Email:{' '}
          {company.hrEmail || '-'}
        </div>
      </footer>
    </div>
  );
}
