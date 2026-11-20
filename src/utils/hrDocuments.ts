import { jsPDF } from 'jspdf';
import type {
  AdvanceEntry,
  AttendanceRecord,
  CompanyProfile,
  Employee,
  FlatUnit,
  Project,
  SettlementEntry,
  SiteExpense,
  Tower,
} from '../types/avy';
import { formatAmountInWordsINR } from './billing';
import { computeEmployeePayroll, formatINR, type EmployeePayrollSummary } from './payroll';
import { calculateFlatProgress } from './tileZones';

export type EmployeeLetterType =
  | 'employment_proof'
  | 'payslip'
  | 'joining_letter'
  | 'relieving_letter'
  | 'travel_security_letter';

export interface GeneratedEmployeeDocument {
  docType: EmployeeLetterType;
  title: string;
  refNumber: string;
  issueDate: string;
  recipientBlock: string;
  subject: string;
  htmlBody: string;
  plainTextLines: string[];
  whatsappMessage: string;
  payslip?: {
    monthKey: string;
    monthLabel: string;
    summary: EmployeePayrollSummary;
    amountInWords: string;
  };
  travelMeta?: {
    route: string;
    purpose: string;
    validFrom: string;
    validTo: string;
    emergencyContact: string;
    verificationPhone: string;
    maskedAadhaar: string;
    bloodGroup: string;
  };
}

export interface WordTemplatePreset {
  id: string;
  label: string;
  subject: string;
  recipient: string;
  htmlBody: string;
}

export type SlideThemeKey =
  | 'executive_slate'
  | 'site_amber'
  | 'clean_corporate'
  | 'blueprint_navy';

export type SlideLayoutKey =
  | 'title_cover'
  | 'bullets_metrics'
  | 'two_column'
  | 'project_summary';

export interface SlideMetricItem {
  label: string;
  value: string;
}

export interface PresentationSlide {
  id: string;
  title: string;
  subtitle: string;
  layout: SlideLayoutKey;
  bullets: string[];
  secondaryTitle?: string;
  secondaryBullets?: string[];
  metrics: SlideMetricItem[];
  footerNote?: string;
}

export interface PresentationDeck {
  id: string;
  title: string;
  theme: SlideThemeKey;
  updatedAt: string;
  slides: PresentationSlide[];
}

export const SLIDE_THEMES: Record<
  SlideThemeKey,
  {
    label: string;
    bgHex: string;
    surfaceHex: string;
    accentHex: string;
    textHex: string;
    mutedHex: string;
    borderHex: string;
    isDark: boolean;
  }
> = {
  executive_slate: {
    label: 'Executive Slate',
    bgHex: '#0f172a',
    surfaceHex: '#1e293b',
    accentHex: '#ea580c',
    textHex: '#f8fafc',
    mutedHex: '#94a3b8',
    borderHex: '#334155',
    isDark: true,
  },
  site_amber: {
    label: 'Site Amber & Charcoal',
    bgHex: '#1c1917',
    surfaceHex: '#292524',
    accentHex: '#f59e0b',
    textHex: '#fafaf9',
    mutedHex: '#d6d3d1',
    borderHex: '#44403c',
    isDark: true,
  },
  clean_corporate: {
    label: 'Clean Corporate Light',
    bgHex: '#ffffff',
    surfaceHex: '#f8fafc',
    accentHex: '#c2410c',
    textHex: '#0f172a',
    mutedHex: '#475569',
    borderHex: '#cbd5e1',
    isDark: false,
  },
  blueprint_navy: {
    label: 'Engineering Blueprint',
    bgHex: '#0c1e38',
    surfaceHex: '#132c52',
    accentHex: '#38bdf8',
    textHex: '#f0f9ff',
    mutedHex: '#bae6fd',
    borderHex: '#1e4273',
    isDark: true,
  },
};

export const WORD_LETTERHEAD_TEMPLATES: WordTemplatePreset[] = [
  {
    id: 'general_notice',
    label: 'Official Site Circular / Notice',
    recipient: 'To All Site Supervisors, Engineers & Crew Members',
    subject: 'Site Safety, Attendance & Daily Tile Execution Protocol',
    htmlBody: `<p>Dear Team,</p>
<p>Please ensure strict adherence to daily attendance registration at the start of shift (08:30 AM) via Quick Scan ID cards. All Masons and Helpers must wear helmets, safety shoes, and carry their company QR ID cards at all times inside the project premises.</p>
<ul>
  <li><strong>Daily Progress Logging:</strong> Update completed sqft &amp; tile zone status before 06:30 PM.</li>
  <li><strong>Material &amp; Tool Handover:</strong> Record adhesive bags, spacers, and tile cutter issues at the tower store.</li>
  <li><strong>Weekly Food Advance:</strong> Acknowledge food advance receipts within 24 hours on WhatsApp / Worker Portal.</li>
</ul>
<p>Cooperation from all tower teams is expected for timely handover and QC approval.</p>`,
  },
  {
    id: 'gate_pass',
    label: 'Material / Worker Gate Pass Authorization',
    recipient: 'To Project Security Officer / Main Gate In-Charge',
    subject: 'Authorization for Site Entry & Material / Tool Movement',
    htmlBody: `<p>Sir / Madam,</p>
<p>This is to certify that our authorized contracting team is executing tiling and stone installation works on site. Kindly permit entry and movement of the listed personnel, tools, and consumables as per company safety norms.</p>
<table>
  <thead>
    <tr><th>Item / Personnel</th><th>Details / Quantity</th><th>Authorized Tower</th></tr>
  </thead>
  <tbody>
    <tr><td>Tile Cutting Machines &amp; Levellers</td><td>6 Units + Diamond Blades</td><td>Tower A &amp; Tower B</td></tr>
    <tr><td>Assigned Crew Batch</td><td>Valid Company QR ID Holders</td><td>All Active Floors</td></tr>
  </tbody>
</table>
<p>For gate verification at any hour, please contact our HR &amp; Site Desk on the helpline printed above.</p>`,
  },
  {
    id: 'client_handover',
    label: 'Client Quality Inspection & Handover Note',
    recipient: 'To Project Manager / Client Engineering Team',
    subject: 'Floor-Wise Tiling Completion & Joint QC Inspection Request',
    htmlBody: `<p>Respected Sir,</p>
<p>We are pleased to inform you that tiling, skirting, dado, and joint grouting works for the designated flats and common corridor zones have been completed as per approved GFC drawings and level tolerances.</p>
<p>Kindly schedule a joint QC walk-through at your earliest convenience so we can obtain sign-off and proceed with acid-wash cleaning and final handover.</p>`,
  },
  {
    id: 'blank',
    label: 'Blank Official Letterhead',
    recipient: 'To Whomsoever It May Concern',
    subject: 'Official Correspondence',
    htmlBody: `<p>Dear Sir / Madam,</p>
<p>Write your official letter content here. Use the formatting toolbar above to add headings, bold text, bullet points, or tables before printing or exporting as PDF / Word (.doc).</p>`,
  },
];

export function sanitizeRichHtml(rawHtml: string): string {
  return (rawHtml || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function stripHtmlToLines(html: string): string[] {
  const withBreaks = (html || '')
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<t[dh][^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"');

  return withBreaks
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0));
}

export function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function maskAadhaarRef(raw?: string): string {
  const cleaned = (raw || '').trim();
  if (!cleaned) return 'On Record';
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 4) {
    const tail = digits.slice(-4);
    return `XXXX-XXXX-${tail}`;
  }
  if (cleaned.length > 4) {
    return `${'*'.repeat(Math.max(4, cleaned.length - 4))}${cleaned.slice(-4)}`;
  }
  return cleaned;
}

export function formatHumanDate(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || 'N/A';
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function getMonthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
  const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function buildOfficialDocumentRefNo(
  docType: EmployeeLetterType | 'custom',
  empCodeOrTag: string,
  dateIso: string
): string {
  const year = (dateIso || '').slice(0, 4) || String(new Date().getFullYear());
  const compactDate = (dateIso || '').replace(/-/g, '').slice(4, 8) || '0101';
  const prefixMap: Record<EmployeeLetterType | 'custom', string> = {
    employment_proof: 'EMP-PRF',
    payslip: 'PAY',
    joining_letter: 'APT',
    relieving_letter: 'REL',
    travel_security_letter: 'TRV-SEC',
    custom: 'DOC',
  };
  const cleanTag = (empCodeOrTag || 'GEN').replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
  return `AVY/${prefixMap[docType]}/${year}/${compactDate}-${cleanTag}`;
}

export interface BuildAutoEmployeeDocInput {
  docType: EmployeeLetterType;
  employee: Employee;
  company: CompanyProfile;
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  settlements: SettlementEntry[];
  projects?: Project[];
  towers?: Tower[];
  issueDate: string;
  monthKey?: string;
  relievingDate?: string;
  conductRemark?: string;
  travelRoute?: string;
  travelPurpose?: string;
  travelValidFrom?: string;
  travelValidTo?: string;
}

export function buildAutoEmployeeDocument(
  input: BuildAutoEmployeeDocInput
): GeneratedEmployeeDocument {
  const { docType, employee, company, issueDate } = input;
  const companyName = company.companyName || 'AVY INFRA';
  const projectObj = input.projects?.find((p) => p.id === employee.currentProjectId);
  const towerObj = input.towers?.find((t) => t.id === employee.currentTowerId);
  const siteName = employee.currentProjectName || projectObj?.name || 'Assigned Company Site';
  const siteLocation = projectObj?.location ? `, ${projectObj.location}` : '';
  const towerName = employee.currentTowerName || towerObj?.name || 'Active Tower';
  const supervisorPhone =
    towerObj?.supervisorPhone || towerObj?.inchargePhone || company.hrContact || '';

  const refNumber = buildOfficialDocumentRefNo(docType, employee.empCode, issueDate);

  if (docType === 'employment_proof') {
    const maskedAadhaar = maskAadhaarRef(employee.aadharRef);
    const estMonthlySalary = Math.round((Number(employee.dailyRate) || 0) * 26);
    const estMonthlyFood = Math.round((Number(employee.foodAllowanceDaily) || 0) * 26);
    const subject = `Bonafide Employment & Salary Proof Certificate — ${employee.fullName} (${employee.empCode})`;

    const htmlBody = `<p><strong>TO WHOMSOEVER IT MAY CONCERN</strong></p>
<p>This is to certify that <strong>${escapeHtml(employee.fullName)}</strong> (Employee ID: <strong>${escapeHtml(
      employee.empCode
    )}</strong>) is a bonafide active employee working with <strong>${escapeHtml(
      companyName
    )}</strong> since <strong>${escapeHtml(formatHumanDate(employee.joiningDate))}</strong>.</p>
<p>His/her current employment and compensation particulars on company records as of <strong>${escapeHtml(
      formatHumanDate(issueDate)
    )}</strong> are detailed below:</p>
<ul>
  <li><strong>Designation / Trade:</strong> ${escapeHtml(employee.role)} (${
      employee.status === 'active' ? 'Active Full-Time Site Deployment' : 'Inactive'
    })</li>
  <li><strong>Assigned Project &amp; Tower:</strong> ${escapeHtml(siteName)}${escapeHtml(
      siteLocation
    )} — ${escapeHtml(towerName)}</li>
  <li><strong>Daily Wage Rate:</strong> ${escapeHtml(
    formatINR(employee.dailyRate)
  )} / day · <strong>Overtime:</strong> ${escapeHtml(formatINR(employee.overtimeRate))} / hr</li>
  <li><strong>Estimated Monthly Gross (26 Shifts):</strong> ${escapeHtml(
    formatINR(estMonthlySalary)
  )} + ${escapeHtml(formatINR(estMonthlyFood))} Food Allowance (${escapeHtml(
      formatINR(employee.foodAllowanceDaily)
    )}/day)</li>
  <li><strong>Identity &amp; Statutory KYC:</strong> Aadhaar ${escapeHtml(maskedAadhaar)}${
      employee.pfNumber ? ` · PF UAN: ${escapeHtml(employee.pfNumber)}` : ''
    }${employee.esiNumber ? ` · ESI: ${escapeHtml(employee.esiNumber)}` : ''}</li>
  <li><strong>Contact / Emergency:</strong> ${escapeHtml(employee.phone)}${
      employee.emergencyContact ? ` · Emergency: ${escapeHtml(employee.emergencyContact)}` : ''
    }</li>
</ul>
<p>This certificate is issued upon the request of the employee for bank account, accommodation, or official verification purposes without any liability on the company.</p>`;

    const plainTextLines = [
      `TO WHOMSOEVER IT MAY CONCERN`,
      `This certifies that ${employee.fullName} (Emp ID: ${employee.empCode}) is employed with ${companyName} as ${employee.role} since ${formatHumanDate(employee.joiningDate)}.`,
      `Current Deployment: ${siteName}${siteLocation} (${towerName})`,
      `Wage Terms: ${formatINR(employee.dailyRate)}/day | OT: ${formatINR(employee.overtimeRate)}/hr | Est. Monthly (26 shifts): ${formatINR(estMonthlySalary)} + ${formatINR(estMonthlyFood)} food allowance`,
      `KYC Reference: Aadhaar ${maskedAadhaar}${employee.pfNumber ? ` | PF: ${employee.pfNumber}` : ''}${employee.esiNumber ? ` | ESI: ${employee.esiNumber}` : ''}`,
      `Contact: ${employee.phone} | Employer HR Verification: ${company.hrContact}`,
      `Issued at the employee's request for employment & identity verification purposes.`,
    ];

    const whatsappMessage = [
      `*${companyName} — Employment Proof Certificate*`,
      `Ref: ${refNumber}`,
      `Employee: ${employee.fullName} (${employee.empCode}) · ${employee.role}`,
      `Joined: ${formatHumanDate(employee.joiningDate)} | Site: ${siteName} (${towerName})`,
      `Daily Rate: ${formatINR(employee.dailyRate)}/day (Est. ${formatINR(estMonthlySalary)}/mo)`,
      `HR Verification: ${company.hrContact}`,
    ].join('\n');

    return {
      docType,
      title: 'Employment Proof Certificate',
      refNumber,
      issueDate,
      recipientBlock: `To Whomsoever It May Concern\nEmployee: ${employee.fullName} (${employee.empCode}) · ${employee.role}`,
      subject,
      htmlBody,
      plainTextLines,
      whatsappMessage,
    };
  }

  if (docType === 'payslip') {
    const monthKey =
      input.monthKey && /^\d{4}-\d{2}$/.test(input.monthKey)
        ? input.monthKey
        : issueDate.slice(0, 7);
    const monthLabel = getMonthLabel(monthKey);
    const start = `${monthKey}-01`;
    const end = `${monthKey}-31`;
    const summary = computeEmployeePayroll(
      employee,
      input.attendance,
      input.advances,
      input.settlements,
      { start, end }
    );
    const amountInWords = formatAmountInWordsINR(Math.max(0, summary.netPayable));
    const subject = `Salary & Wage Payslip for ${monthLabel} — ${employee.fullName} (${employee.empCode})`;

    const htmlBody = `<p>Official monthly wage &amp; settlement statement issued by <strong>${escapeHtml(
      companyName
    )}</strong> for the month of <strong>${escapeHtml(monthLabel)}</strong>.</p>
<ul>
  <li><strong>Employee:</strong> ${escapeHtml(employee.fullName)} (${escapeHtml(
      employee.empCode
    )}) · ${escapeHtml(employee.role)}</li>
  <li><strong>Site / Tower:</strong> ${escapeHtml(siteName)} · ${escapeHtml(towerName)}</li>
  <li><strong>Attendance Summary:</strong> ${summary.presentDays} Present, ${
      summary.halfDays
    } Half-Day, ${summary.absentDays} Absent (${summary.effectiveDaysWorked} Effective Days + ${
      summary.overtimeHours
    }h OT)</li>
  <li><strong>Gross Earnings:</strong> ${escapeHtml(
    formatINR(summary.totalEarned)
  )} (Wages ${escapeHtml(formatINR(summary.grossWages))} + OT ${escapeHtml(
      formatINR(summary.overtimePay)
    )})</li>
  <li><strong>Total Advances Deducted:</strong> ${escapeHtml(
    formatINR(summary.totalAdvances)
  )} (Daily Food ${escapeHtml(formatINR(summary.dailyFoodAdvance))}, Weekly Food ${escapeHtml(
      formatINR(summary.weeklyFoodAdvance)
    )}, Cash ${escapeHtml(formatINR(summary.cashAdvance))})</li>
  <li><strong>Already Settled:</strong> ${escapeHtml(formatINR(summary.totalSettled))}</li>
  <li><strong>Net Balance Payable:</strong> ${escapeHtml(formatINR(summary.netPayable))}</li>
</ul>
<p><strong>Amount in Words:</strong> ${escapeHtml(amountInWords)}</p>`;

    const plainTextLines = [
      `Payslip Month: ${monthLabel}`,
      `Employee: ${employee.fullName} (${employee.empCode}) - ${employee.role}`,
      `Deployed Site: ${siteName} (${towerName})`,
      `Attendance: ${summary.presentDays} Full | ${summary.halfDays} Half | ${summary.absentDays} Absent | ${summary.overtimeHours}h OT`,
      `Wages Earned: ${formatINR(summary.grossWages)} | OT Pay: ${formatINR(summary.overtimePay)} | Gross: ${formatINR(summary.totalEarned)}`,
      `Deductions (Food & Cash Advances): ${formatINR(summary.totalAdvances)}`,
      `Previous Settlements: ${formatINR(summary.totalSettled)}`,
      `Net Payable Balance: ${formatINR(summary.netPayable)}`,
      `In Words: ${amountInWords}`,
    ];

    const whatsappMessage = [
      `*${companyName} — Payslip (${monthLabel})*`,
      `Ref: ${refNumber}`,
      `Worker: ${employee.fullName} (${employee.empCode}) · ${employee.role}`,
      `Attendance: ${summary.effectiveDaysWorked} days + ${summary.overtimeHours}h OT`,
      `Gross Earned: ${formatINR(summary.totalEarned)}`,
      `Advances: ${formatINR(summary.totalAdvances)} | Settled: ${formatINR(summary.totalSettled)}`,
      `*Net Payable: ${formatINR(summary.netPayable)}*`,
      `HR Contact: ${company.hrContact}`,
    ].join('\n');

    return {
      docType,
      title: `Employee Payslip — ${monthLabel}`,
      refNumber,
      issueDate,
      recipientBlock: `${employee.fullName} (${employee.empCode})\nRole: ${employee.role} · Phone: ${employee.phone}`,
      subject,
      htmlBody,
      plainTextLines,
      whatsappMessage,
      payslip: { monthKey, monthLabel, summary, amountInWords },
    };
  }

  if (docType === 'joining_letter') {
    const subject = `Letter of Appointment & Site Joining — ${employee.fullName} (${employee.empCode})`;
    const maskedAadhaar = maskAadhaarRef(employee.aadharRef);
    const htmlBody = `<p>Dear <strong>${escapeHtml(employee.fullName)}</strong>,</p>
<p>With reference to your trade verification and onboarding with <strong>${escapeHtml(
      companyName
    )}</strong>, we are pleased to confirm your appointment as <strong>${escapeHtml(
      employee.role
    )}</strong> effective from <strong>${escapeHtml(
      formatHumanDate(employee.joiningDate)
    )}</strong>.</p>
<p>Your employment registration and compensation terms are summarized below:</p>
<ul>
  <li><strong>Employee ID Code:</strong> ${escapeHtml(employee.empCode)}</li>
  <li><strong>Designation / Trade:</strong> ${escapeHtml(employee.role)}</li>
  <li><strong>Initial Site Deployment:</strong> ${escapeHtml(siteName)}${escapeHtml(
      siteLocation
    )} — ${escapeHtml(towerName)}</li>
  <li><strong>Daily Wage Rate:</strong> ${escapeHtml(
    formatINR(employee.dailyRate)
  )} per full shift (Half-day at 50%)</li>
  <li><strong>Overtime Rate:</strong> ${escapeHtml(formatINR(employee.overtimeRate))} per hour</li>
  <li><strong>Daily Food Allowance:</strong> ${escapeHtml(
    formatINR(employee.foodAllowanceDaily)
  )} per active day</li>
  <li><strong>KYC / Statutory Refs:</strong> Aadhaar ${escapeHtml(maskedAadhaar)}${
      employee.pfNumber ? ` · PF: ${escapeHtml(employee.pfNumber)}` : ''
    }${employee.esiNumber ? ` · ESI: ${escapeHtml(employee.esiNumber)}` : ''}</li>
</ul>
<p><strong>Site Safety &amp; Attendance Terms:</strong> You are required to scan your official company QR ID card daily at the site gate, wear mandatory PPE (helmet, safety shoes, reflective vest), and report work progress to your assigned Tower Supervisor. All advances and weekly food disbursements are settled transparently against monthly attendance registers.</p>
<p>We welcome you to ${escapeHtml(companyName)} and wish you a safe and productive tenure.</p>`;

    const plainTextLines = [
      `Dear ${employee.fullName},`,
      `We are pleased to confirm your appointment with ${companyName} as ${employee.role} effective ${formatHumanDate(employee.joiningDate)}.`,
      `Employee Code: ${employee.empCode}`,
      `Site Deployment: ${siteName}${siteLocation} (${towerName})`,
      `Daily Wage Rate: ${formatINR(employee.dailyRate)} / day | Overtime: ${formatINR(employee.overtimeRate)} / hr`,
      `Daily Food Allowance: ${formatINR(employee.foodAllowanceDaily)} / day`,
      `KYC Reference: Aadhaar ${maskedAadhaar}${employee.pfNumber ? ` | PF: ${employee.pfNumber}` : ''}${employee.esiNumber ? ` | ESI: ${employee.esiNumber}` : ''}`,
      `Terms: Daily gate QR scan attendance, mandatory site PPE compliance, and transparent monthly payroll settlement.`,
      `Welcome to ${companyName}.`,
    ];

    const whatsappMessage = [
      `*${companyName} — Joining / Appointment Letter*`,
      `Ref: ${refNumber}`,
      `Employee: ${employee.fullName} (${employee.empCode})`,
      `Role: ${employee.role} | Joining: ${formatHumanDate(employee.joiningDate)}`,
      `Site: ${siteName} (${towerName})`,
      `Wage: ${formatINR(employee.dailyRate)}/day + ${formatINR(employee.overtimeRate)}/hr OT`,
      `HR Desk: ${company.hrContact}`,
    ].join('\n');

    return {
      docType,
      title: 'Joining & Appointment Letter',
      refNumber,
      issueDate,
      recipientBlock: `To,\n${employee.fullName} (Emp ID: ${employee.empCode})\nPhone: ${employee.phone}${
        employee.emergencyContact ? `\nEmergency Contact: ${employee.emergencyContact}` : ''
      }`,
      subject,
      htmlBody,
      plainTextLines,
      whatsappMessage,
    };
  }

  if (docType === 'relieving_letter') {
    const relievingDate = input.relievingDate || issueDate;
    const conductRemark =
      input.conductRemark?.trim() ||
      'sincere, disciplined, and skilled in floor/wall tiling and site execution standards';
    const overallPayroll = computeEmployeePayroll(
      employee,
      input.attendance,
      input.advances,
      input.settlements
    );
    const duesStatus =
      overallPayroll.netPayable === 0
        ? 'Full and final accounts cleared with zero pending balance.'
        : overallPayroll.netPayable > 0
          ? `Pending net wage balance of ${formatINR(overallPayroll.netPayable)} scheduled for full & final settlement.`
          : `Advance recovery balance of ${formatINR(Math.abs(overallPayroll.netPayable))} noted at clearance.`;

    const subject = `Relieving & Experience Certificate — ${employee.fullName} (${employee.empCode})`;
    const htmlBody = `<p><strong>TO WHOMSOEVER IT MAY CONCERN</strong></p>
<p>This is to certify that <strong>${escapeHtml(
      employee.fullName
    )}</strong> (Employee ID: <strong>${escapeHtml(
      employee.empCode
    )}</strong>) worked with <strong>${escapeHtml(companyName)}</strong> as a <strong>${escapeHtml(
      employee.role
    )}</strong> from <strong>${escapeHtml(
      formatHumanDate(employee.joiningDate)
    )}</strong> to <strong>${escapeHtml(formatHumanDate(relievingDate))}</strong>.</p>
<p>During his/her tenure at <strong>${escapeHtml(siteName)}${escapeHtml(
      siteLocation
    )} (${escapeHtml(towerName)})</strong>, we found his/her work conduct to be <strong>${escapeHtml(
      conductRemark
    )}</strong>.</p>
<ul>
  <li><strong>Total Recorded Work Days:</strong> ${overallPayroll.effectiveDaysWorked} effective days (+ ${overallPayroll.overtimeHours} OT hours)</li>
  <li><strong>Final Clearance Status:</strong> ${escapeHtml(duesStatus)}</li>
  <li><strong>Company Property / ID Card:</strong> Verified at Site Desk</li>
</ul>
<p>He/she is relieved from duties on <strong>${escapeHtml(
      formatHumanDate(relievingDate)
    )}</strong>. We thank ${escapeHtml(
      employee.fullName
    )} for their contribution and wish them every success in future endeavours.</p>`;

    const plainTextLines = [
      `TO WHOMSOEVER IT MAY CONCERN`,
      `This certifies that ${employee.fullName} (Emp ID: ${employee.empCode}) served with ${companyName} as ${employee.role} from ${formatHumanDate(employee.joiningDate)} to ${formatHumanDate(relievingDate)}.`,
      `Last Deployed Site: ${siteName}${siteLocation} (${towerName}).`,
      `Work & Conduct: Found to be ${conductRemark}.`,
      `Attendance Record: ${overallPayroll.effectiveDaysWorked} effective days (+ ${overallPayroll.overtimeHours} OT hours).`,
      `Accounts & Clearance: ${duesStatus}`,
      `Relieved effective ${formatHumanDate(relievingDate)}. We wish them continued success.`,
    ];

    const whatsappMessage = [
      `*${companyName} — Relieving & Experience Letter*`,
      `Ref: ${refNumber}`,
      `Worker: ${employee.fullName} (${employee.empCode}) · ${employee.role}`,
      `Tenure: ${formatHumanDate(employee.joiningDate)} to ${formatHumanDate(relievingDate)}`,
      `Clearance: ${duesStatus}`,
      `HR Desk: ${company.hrContact}`,
    ].join('\n');

    return {
      docType,
      title: 'Relieving & Experience Letter',
      refNumber,
      issueDate,
      recipientBlock: `To,\n${employee.fullName} (Emp ID: ${employee.empCode})\nDesignation: ${employee.role}\nPhone: ${employee.phone}`,
      subject,
      htmlBody,
      plainTextLines,
      whatsappMessage,
    };
  }

  // Default: Travel & Security Verification Letter
  const validFrom = input.travelValidFrom || issueDate;
  const validTo = input.travelValidTo || issueDate;
  const travelRoute =
    input.travelRoute?.trim() ||
    `Home Residence <-> ${siteName}${siteLocation} (${towerName})`;
  const travelPurpose =
    input.travelPurpose?.trim() ||
    'Official Site Construction & Tiling Duty Transit / Security Verification';
  const maskedAadhaar = maskAadhaarRef(employee.aadharRef);
  const bloodGroup = employee.bloodGroup || 'Not Specified';
  const emergencyContact = employee.emergencyContact || employee.phone;
  const verificationPhone = supervisorPhone || company.hrContact;

  const subject = `Bonafide Employee Travel & Security Verification Letter — ${employee.fullName} (${employee.empCode})`;
  const htmlBody = `<p><strong>TO POLICE, TRANSIT SECURITY, CHECKPOSTS &amp; PROJECT GATE AUTHORITIES</strong></p>
<p>This is to formally certify that the bearer of this letter, <strong>${escapeHtml(
    employee.fullName
  )}</strong>, is a bonafide active worker employed by <strong>${escapeHtml(
    companyName
  )}</strong> (${escapeHtml(company.tagline || 'Construction & Tiling Contractors')}).</p>
<p>He/she is travelling for <strong>${escapeHtml(
    travelPurpose
  )}</strong> along the route <strong>${escapeHtml(
    travelRoute
  )}</strong>, valid from <strong>${escapeHtml(
    formatHumanDate(validFrom)
  )}</strong> to <strong>${escapeHtml(formatHumanDate(validTo))}</strong>.</p>
<ul>
  <li><strong>Employee ID &amp; Trade:</strong> ${escapeHtml(employee.empCode)} · ${escapeHtml(
    employee.role
  )} (Joined ${escapeHtml(formatHumanDate(employee.joiningDate))})</li>
  <li><strong>Deployed Project &amp; Tower:</strong> ${escapeHtml(siteName)}${escapeHtml(
    siteLocation
  )} — ${escapeHtml(towerName)}</li>
  <li><strong>Mobile / Blood Group:</strong> ${escapeHtml(employee.phone)} · Blood Group: ${escapeHtml(
    bloodGroup
  )}</li>
  <li><strong>Aadhaar Reference:</strong> ${escapeHtml(maskedAadhaar)} · Emergency Contact: ${escapeHtml(
    emergencyContact
  )}</li>
  <li><strong>24×7 Employer Verification Phone:</strong> ${escapeHtml(
    verificationPhone
  )} (HR: ${escapeHtml(company.hrContact)})</li>
</ul>
<p>Kindly allow safe passage and site/gate clearance upon inspection of this official letterhead along with the employee&apos;s physical company QR ID card or Aadhaar proof.</p>`;

  const plainTextLines = [
    `TO POLICE, TRANSIT SECURITY, CHECKPOSTS & SITE GATE AUTHORITIES`,
    `Certifies that ${employee.fullName} (Emp ID: ${employee.empCode}) is an active employee of ${companyName} working as ${employee.role}.`,
    `Travel Route: ${travelRoute}`,
    `Purpose: ${travelPurpose}`,
    `Validity Period: ${formatHumanDate(validFrom)} to ${formatHumanDate(validTo)}`,
    `Project Site: ${siteName}${siteLocation} (${towerName})`,
    `Worker Mobile: ${employee.phone} | Aadhaar Ref: ${maskedAadhaar} | Blood Group: ${bloodGroup}`,
    `Emergency Contact: ${emergencyContact}`,
    `24x7 Verification Contact: ${verificationPhone} (Company HR: ${company.hrContact})`,
    `Please grant safe transit and security clearance upon presenting this letter and company ID card.`,
  ];

  const whatsappMessage = [
    `*${companyName} — Travel & Security Verification Letter*`,
    `Ref: ${refNumber}`,
    `Worker: ${employee.fullName} (${employee.empCode}) · ${employee.role}`,
    `Route: ${travelRoute}`,
    `Valid: ${formatHumanDate(validFrom)} to ${formatHumanDate(validTo)}`,
    `Site: ${siteName} (${towerName})`,
    `Aadhaar Ref: ${maskedAadhaar} | Emergency: ${emergencyContact}`,
    `Employer Verification Call: ${verificationPhone}`,
  ].join('\n');

  return {
    docType: 'travel_security_letter',
    title: 'Travel & Security Verification Letter',
    refNumber,
    issueDate,
    recipientBlock: `To,\nTransit Security / Checkpost / Gate Officer\nSubject Worker: ${employee.fullName} (${employee.empCode})`,
    subject,
    htmlBody,
    plainTextLines,
    whatsappMessage,
    travelMeta: {
      route: travelRoute,
      purpose: travelPurpose,
      validFrom,
      validTo,
      emergencyContact,
      verificationPhone,
      maskedAadhaar,
      bloodGroup,
    },
  };
}

/**
 * Generates an MS Word (.doc) compatible MIME HTML document on official company letterhead.
 */
export function buildWordDocumentBlob(params: {
  company: CompanyProfile;
  refNumber: string;
  issueDate: string;
  recipient: string;
  subject: string;
  bodyHtml: string;
}): { blob: Blob; fileName: string } {
  const { company, refNumber, issueDate, recipient, subject, bodyHtml } = params;
  const cleanBody = sanitizeRichHtml(bodyHtml);
  const safeCompany = escapeHtml(company.companyName || 'AVY INFRA');

  const docHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(subject || safeCompany)}</title>
<style>
  @page { size: A4 portrait; margin: 16mm 18mm; }
  body { font-family: Calibri, Arial, sans-serif; color: #0f172a; font-size: 11pt; line-height: 1.5; }
  .lh-header { border-bottom: 3px solid #c2410c; padding-bottom: 10px; margin-bottom: 14px; }
  .lh-company { font-size: 20pt; font-weight: bold; color: #0f172a; margin: 0; }
  .lh-tagline { font-size: 9.5pt; color: #c2410c; font-weight: bold; margin: 2px 0 4px 0; text-transform: uppercase; }
  .lh-meta { font-size: 8.5pt; color: #475569; margin: 0; }
  .ref-row { width: 100%; margin: 10px 0 14px 0; font-size: 9.5pt; color: #334155; }
  .recipient { white-space: pre-line; margin-bottom: 12px; font-size: 10.5pt; }
  .subject { font-weight: bold; font-size: 11.5pt; border-left: 3px solid #c2410c; padding-left: 8px; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 10pt; text-align: left; }
  th { background-color: #f1f5f9; }
  .sign-block { margin-top: 32px; text-align: right; font-size: 10pt; }
  .lh-footer { border-top: 1px solid #cbd5e1; margin-top: 28px; padding-top: 6px; font-size: 8pt; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <div class="lh-header">
    <p class="lh-company">${safeCompany}</p>
    <p class="lh-tagline">${escapeHtml(company.tagline || 'Building Trust & Precision')}</p>
    <p class="lh-meta">${escapeHtml(company.address || '')}</p>
    <p class="lh-meta">HR Contact: ${escapeHtml(company.hrContact || '')} | Email: ${escapeHtml(
      company.hrEmail || ''
    )} | GSTIN: ${escapeHtml(company.gstNumber || 'N/A')}</p>
  </div>

  <table class="ref-row" style="border:none;">
    <tr>
      <td style="border:none;padding:0;"><strong>Ref No:</strong> ${escapeHtml(refNumber)}</td>
      <td style="border:none;padding:0;text-align:right;"><strong>Date:</strong> ${escapeHtml(
        formatHumanDate(issueDate)
      )}</td>
    </tr>
  </table>

  ${recipient ? `<div class="recipient">${escapeHtml(recipient)}</div>` : ''}
  ${subject ? `<div class="subject">Subject: ${escapeHtml(subject)}</div>` : ''}

  <div class="doc-body">${cleanBody}</div>

  <div class="sign-block">
    <p>For <strong>${safeCompany}</strong></p>
    <br /><br />
    <p><strong>${escapeHtml(company.signatoryName || 'Authorized Signatory')}</strong><br />Authorized Signatory &amp; Company Seal</p>
  </div>

  <div class="lh-footer">
    ${safeCompany} · PF Est: ${escapeHtml(company.pfEstCode || 'N/A')} · ESI: ${escapeHtml(
    company.esiCode || 'N/A'
  )} · Generated via Official Company Desk
  </div>
</body>
</html>`;

  const blob = new Blob(['\ufeff', docHtml], {
    type: 'application/msword;charset=utf-8',
  });
  const slug = (subject || refNumber || 'official_letter')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

  return {
    blob,
    fileName: `${slug || 'avy_letterhead'}.doc`,
  };
}

/**
 * Generates a crisp A4 Official Company Letterhead PDF using jsPDF.
 */
export function buildLetterheadPdfBlob(params: {
  company: CompanyProfile;
  refNumber: string;
  issueDate: string;
  recipient: string;
  subject: string;
  plainTextLines: string[];
  payslip?: GeneratedEmployeeDocument['payslip'];
  travelMeta?: GeneratedEmployeeDocument['travelMeta'];
  employee?: Employee;
}): { blob: Blob; fileName: string } {
  const {
    company,
    refNumber,
    issueDate,
    recipient,
    subject,
    plainTextLines,
    payslip,
    travelMeta,
    employee,
  } = params;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 16;
  const contentW = pageW - margin * 2;
  let y = 14;

  // Top Header Strip
  pdf.setFillColor(194, 65, 12); // orange-700 accent bar
  pdf.rect(0, 0, pageW, 3.5, 'F');

  if (company.logoDataUrl && company.logoDataUrl.startsWith('data:image/')) {
    try {
      const fmt = company.logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(company.logoDataUrl, fmt, margin, y, 16, 16);
    } catch {
      // Ignore malformed image silently
    }
  }

  const textStartX = company.logoDataUrl?.startsWith('data:image/') ? margin + 20 : margin;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(17);
  pdf.setTextColor(15, 23, 42);
  pdf.text(company.companyName || 'AVY INFRA', textStartX, y + 6);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(194, 65, 12);
  pdf.text((company.tagline || 'CONSTRUCTION & TILING CONTRACTORS').toUpperCase(), textStartX, y + 11.5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(71, 85, 105);
  const addrLines = pdf.splitTextToSize(company.address || '', pageW - textStartX - margin);
  pdf.text(addrLines, textStartX, y + 16);
  y += 18 + Math.max(0, addrLines.length - 1) * 3.8;

  pdf.text(
    `Tel: ${company.hrContact || '-'}  |  Email: ${company.hrEmail || '-'}  |  GSTIN: ${
      company.gstNumber || '-'
    }`,
    margin,
    y + 3
  );
  y += 6;

  pdf.setDrawColor(194, 65, 12);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y, pageW - margin, y);
  y += 6;

  // Ref & Date Row
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(30, 41, 59);
  pdf.text(`Ref No: ${refNumber}`, margin, y);
  pdf.text(`Date: ${formatHumanDate(issueDate)}`, pageW - margin, y, { align: 'right' });
  y += 7;

  // Recipient Block
  if (recipient.trim()) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9.5);
    pdf.setTextColor(51, 65, 85);
    const recLines = pdf.splitTextToSize(recipient, contentW);
    pdf.text(recLines, margin, y);
    y += recLines.length * 4.5 + 3;
  }

  // Subject Box
  if (subject.trim()) {
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(203, 213, 225);
    const subjLines = pdf.splitTextToSize(`Subject: ${subject}`, contentW - 6);
    const boxH = subjLines.length * 4.8 + 4;
    pdf.rect(margin, y, contentW, boxH, 'FD');
    pdf.setFillColor(194, 65, 12);
    pdf.rect(margin, y, 1.5, boxH, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(15, 23, 42);
    pdf.text(subjLines, margin + 4, y + 4.8);
    y += boxH + 6;
  }

  // Payslip structured table if present
  if (payslip && employee) {
    const rows: Array<[string, string, string, string]> = [
      ['Employee Name', employee.fullName, 'Employee Code', employee.empCode],
      ['Trade / Role', employee.role, 'Pay Period', payslip.monthLabel],
      [
        'Present / Half / Absent',
        `${payslip.summary.presentDays}P / ${payslip.summary.halfDays}H / ${payslip.summary.absentDays}A`,
        'Effective Days & OT',
        `${payslip.summary.effectiveDaysWorked} d + ${payslip.summary.overtimeHours}h OT`,
      ],
      [
        'Basic Wages Earned',
        formatINR(payslip.summary.grossWages),
        'Overtime Pay',
        formatINR(payslip.summary.overtimePay),
      ],
      [
        'Daily Food Advances',
        formatINR(payslip.summary.dailyFoodAdvance),
        'Weekly Food Advances',
        formatINR(payslip.summary.weeklyFoodAdvance),
      ],
      [
        'Cash / Custom Advances',
        formatINR(payslip.summary.cashAdvance + payslip.summary.customAdvance),
        'Already Settled',
        formatINR(payslip.summary.totalSettled),
      ],
    ];

    pdf.setFontSize(8.5);
    rows.forEach((row) => {
      pdf.setDrawColor(203, 213, 225);
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, contentW, 7.5, 'S');
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(71, 85, 105);
      pdf.text(row[0], margin + 2, y + 5);
      pdf.text(row[2], margin + contentW / 2 + 2, y + 5);

      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(15, 23, 42);
      pdf.text(row[1], margin + 44, y + 5);
      pdf.text(row[3], margin + contentW / 2 + 42, y + 5);
      y += 7.5;
    });

    y += 3;
    pdf.setFillColor(236, 253, 245);
    pdf.setDrawColor(16, 185, 129);
    pdf.rect(margin, y, contentW, 11, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(6, 78, 59);
    pdf.text(`NET PAYABLE BALANCE: ${formatINR(payslip.summary.netPayable)}`, margin + 4, y + 7);
    y += 15;
  } else if (travelMeta && employee) {
    // Travel & Security highlight box
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(148, 163, 184);
    pdf.rect(margin, y, contentW, 28, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`TRAVEL & GATE SECURITY PASS DETAILS — ${employee.empCode}`, margin + 4, y + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.text(`Route: ${travelMeta.route}`, margin + 4, y + 12);
    pdf.text(
      `Valid: ${formatHumanDate(travelMeta.validFrom)} to ${formatHumanDate(travelMeta.validTo)}`,
      margin + 4,
      y + 17.5
    );
    pdf.text(
      `Aadhaar Ref: ${travelMeta.maskedAadhaar}  |  Blood Group: ${travelMeta.bloodGroup}  |  24x7 Verification: ${travelMeta.verificationPhone}`,
      margin + 4,
      y + 23
    );
    y += 33;
  }

  // Main Letter Body Lines
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(30, 41, 59);

  for (const line of plainTextLines) {
    const wrapped = pdf.splitTextToSize(line, contentW);
    if (y + wrapped.length * 5 > 246) {
      pdf.addPage();
      y = 18;
    }
    pdf.text(wrapped, margin, y);
    y += wrapped.length * 4.9 + 2.2;
  }

  // Signatory & Footer
  const sigY = Math.max(y + 12, 238);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(51, 65, 85);
  pdf.text(`For ${company.companyName || 'AVY INFRA'}`, pageW - margin, sigY, { align: 'right' });
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  pdf.text(company.signatoryName || 'Authorized Signatory', pageW - margin, sigY + 14, {
    align: 'right',
  });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text('Authorized Signatory & Company Seal', pageW - margin, sigY + 18.5, {
    align: 'right',
  });

  // Footer Bar
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, 281, pageW - margin, 281);
  pdf.setFontSize(7.5);
  pdf.text(
    `${company.companyName || 'AVY INFRA'} · PF: ${company.pfEstCode || 'N/A'} · ESI: ${
      company.esiCode || 'N/A'
    } · GSTIN: ${company.gstNumber || 'N/A'}`,
    pageW / 2,
    286,
    { align: 'center' }
  );

  const blob = pdf.output('blob');
  const slug = (subject || refNumber || 'avy_letterhead')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

  return {
    blob,
    fileName: `${slug || 'avy_letterhead'}.pdf`,
  };
}

/**
 * Generates a 16:9 widescreen Presentation Deck PDF using jsPDF.
 */
export function buildPresentationDeckPdfBlob(params: {
  deck: PresentationDeck;
  company: CompanyProfile;
}): { blob: Blob; fileName: string } {
  const { deck, company } = params;
  const theme = SLIDE_THEMES[deck.theme] || SLIDE_THEMES.executive_slate;
  const hexToRgb = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16) || 15,
      parseInt(clean.slice(2, 4), 16) || 23,
      parseInt(clean.slice(4, 6), 16) || 42,
    ];
  };

  // 16:9 widescreen 297mm x 167mm
  const w = 297;
  const h = 167;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [w, h] });

  const bgRgb = hexToRgb(theme.bgHex);
  const surfaceRgb = hexToRgb(theme.surfaceHex);
  const accentRgb = hexToRgb(theme.accentHex);
  const textRgb = hexToRgb(theme.textHex);
  const mutedRgb = hexToRgb(theme.mutedHex);

  deck.slides.forEach((slide, index) => {
    if (index > 0) pdf.addPage([w, h], 'landscape');

    // Slide Background
    pdf.setFillColor(...bgRgb);
    pdf.rect(0, 0, w, h, 'F');

    // Left / Top Accent Stripe
    pdf.setFillColor(...accentRgb);
    pdf.rect(0, 0, w, 3.2, 'F');

    // Company & Slide Number Header
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...accentRgb);
    pdf.text((company.companyName || 'AVY INFRA').toUpperCase(), 16, 13);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...mutedRgb);
    pdf.text(`Slide ${index + 1} / ${deck.slides.length}`, w - 16, 13, { align: 'right' });

    // Title & Subtitle
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(slide.layout === 'title_cover' ? 28 : 20);
    pdf.setTextColor(...textRgb);
    const titleLines = pdf.splitTextToSize(slide.title || 'Untitled Slide', w - 32);
    const titleY = slide.layout === 'title_cover' ? 54 : 28;
    pdf.text(titleLines, 16, titleY);

    let cursorY = titleY + titleLines.length * (slide.layout === 'title_cover' ? 11.5 : 8.5) + 3;
    if (slide.subtitle) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(slide.layout === 'title_cover' ? 13 : 11);
      pdf.setTextColor(...mutedRgb);
      const subLines = pdf.splitTextToSize(slide.subtitle, w - 36);
      pdf.text(subLines, 16, cursorY);
      cursorY += subLines.length * 6 + 6;
    }

    // Metrics Strip if available
    if (slide.metrics.length > 0) {
      const cols = Math.min(4, slide.metrics.length);
      const gap = 5;
      const cardW = (w - 32 - gap * (cols - 1)) / cols;
      slide.metrics.slice(0, 4).forEach((m, mIdx) => {
        const cx = 16 + mIdx * (cardW + gap);
        pdf.setFillColor(...surfaceRgb);
        pdf.roundedRect(cx, cursorY, cardW, 22, 2, 2, 'F');
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...mutedRgb);
        pdf.text(m.label.slice(0, 26), cx + 4, cursorY + 7);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(13.5);
        pdf.setTextColor(...textRgb);
        pdf.text(m.value.slice(0, 18), cx + 4, cursorY + 16);
      });
      cursorY += 29;
    }

    // Bullet Points (Single or Two Column)
    const isTwoCol = slide.layout === 'two_column' && (slide.secondaryBullets?.length || 0) > 0;
    const bulletColW = isTwoCol ? (w - 40) / 2 : w - 36;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(...textRgb);
    let leftY = cursorY;
    slide.bullets.forEach((b) => {
      if (!b.trim()) return;
      const lines = pdf.splitTextToSize(`•  ${b.trim()}`, bulletColW);
      if (leftY + lines.length * 6 < h - 14) {
        pdf.text(lines, 16, leftY);
        leftY += lines.length * 6 + 2.5;
      }
    });

    if (isTwoCol && slide.secondaryBullets) {
      let rightY = cursorY;
      const rightX = 16 + bulletColW + 8;
      if (slide.secondaryTitle) {
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...accentRgb);
        pdf.text(slide.secondaryTitle, rightX, rightY);
        rightY += 7;
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...textRgb);
      }
      slide.secondaryBullets.forEach((b) => {
        if (!b.trim()) return;
        const lines = pdf.splitTextToSize(`•  ${b.trim()}`, bulletColW);
        if (rightY + lines.length * 6 < h - 14) {
          pdf.text(lines, rightX, rightY);
          rightY += lines.length * 6 + 2.5;
        }
      });
    }

    // Footer
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...mutedRgb);
    pdf.text(
      slide.footerNote || `${company.companyName || 'AVY INFRA'} · Confidential Site Presentation`,
      16,
      h - 7
    );
  });

  const blob = pdf.output('blob');
  const slug = (deck.title || 'avy_presentation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

  return {
    blob,
    fileName: `${slug || 'avy_presentation'}.pdf`,
  };
}

/**
 * Generates a Microsoft PowerPoint (.ppt) compatible MIME HTML slide presentation file.
 */
export function buildPowerPointDocBlob(params: {
  deck: PresentationDeck;
  company: CompanyProfile;
}): { blob: Blob; fileName: string } {
  const { deck, company } = params;
  const theme = SLIDE_THEMES[deck.theme] || SLIDE_THEMES.executive_slate;
  const safeCompany = escapeHtml(company.companyName || 'AVY INFRA');

  const slidesMarkup = deck.slides
    .map((slide, idx) => {
      const metricsHtml =
        slide.metrics.length > 0
          ? `<table style="width:100%;border-collapse:separate;border-spacing:8px;margin:14px 0;"><tr>${slide.metrics
              .slice(0, 4)
              .map(
                (m) =>
                  `<td style="background:${theme.surfaceHex};border:1px solid ${theme.borderHex};padding:10px 14px;border-radius:6px;"><div style="font-size:9pt;color:${theme.mutedHex};">${escapeHtml(
                    m.label
                  )}</div><div style="font-size:16pt;font-weight:bold;color:${theme.textHex};margin-top:4px;">${escapeHtml(
                    m.value
                  )}</div></td>`
              )
              .join('')}</tr></table>`
          : '';

      const leftList = `<ul>${slide.bullets
        .filter((b) => b.trim())
        .map((b) => `<li style="margin-bottom:6px;">${escapeHtml(b.trim())}</li>`)
        .join('')}</ul>`;

      const rightBlock =
        slide.layout === 'two_column' && (slide.secondaryBullets?.length || 0) > 0
          ? `<td style="width:48%;vertical-align:top;background:${theme.surfaceHex};border:1px solid ${theme.borderHex};padding:12px 16px;">${
              slide.secondaryTitle
                ? `<div style="font-weight:bold;color:${theme.accentHex};margin-bottom:8px;">${escapeHtml(
                    slide.secondaryTitle
                  )}</div>`
                : ''
            }<ul>${(slide.secondaryBullets || [])
              .filter((b) => b.trim())
              .map((b) => `<li style="margin-bottom:6px;">${escapeHtml(b.trim())}</li>`)
              .join('')}</ul></td>`
          : '';

      return `<div class="ppt-slide" style="page-break-after:always;background:${theme.bgHex};color:${theme.textHex};border:2px solid ${theme.borderHex};border-top:6px solid ${theme.accentHex};padding:26px 32px;margin-bottom:18px;">
  <table style="width:100%;border:none;margin-bottom:12px;">
    <tr>
      <td style="border:none;color:${theme.accentHex};font-weight:bold;font-size:10pt;text-transform:uppercase;">${safeCompany}</td>
      <td style="border:none;text-align:right;color:${theme.mutedHex};font-size:9pt;">Slide ${idx + 1} / ${deck.slides.length}</td>
    </tr>
  </table>
  <h1 style="margin:0 0 6px 0;font-size:22pt;color:${theme.textHex};">${escapeHtml(
        slide.title || 'Untitled Slide'
      )}</h1>
  ${
    slide.subtitle
      ? `<p style="margin:0 0 12px 0;font-size:11.5pt;color:${theme.mutedHex};">${escapeHtml(
          slide.subtitle
        )}</p>`
      : ''
  }
  ${metricsHtml}
  <table style="width:100%;border:none;">
    <tr>
      <td style="vertical-align:top;padding-right:12px;color:${theme.textHex};font-size:11.5pt;">${leftList}</td>
      ${rightBlock}
    </tr>
  </table>
  <p style="margin-top:18px;padding-top:8px;border-top:1px solid ${theme.borderHex};font-size:8.5pt;color:${theme.mutedHex};">${escapeHtml(
        slide.footerNote || `${company.companyName || 'AVY INFRA'} · Site Presentation`
      )}</p>
</div>`;
    })
    .join('\n');

  const pptHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:p="urn:schemas-microsoft-com:office:powerpoint"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(deck.title || 'Presentation Deck')}</title>
<style>
  @page { size: 297mm 167mm landscape; margin: 8mm; }
  body { font-family: Calibri, Arial, sans-serif; margin: 0; padding: 0; background: #0f172a; }
</style>
</head>
<body>
${slidesMarkup}
</body>
</html>`;

  const blob = new Blob(['\ufeff', pptHtml], {
    type: 'application/vnd.ms-powerpoint;charset=utf-8',
  });
  const slug = (deck.title || 'avy_presentation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

  return {
    blob,
    fileName: `${slug || 'avy_presentation'}.ppt`,
  };
}

/**
 * Generates a starter PowerPoint deck hydrated with real project, tower, crew, and tiling metrics.
 */
export function createLiveProjectDeck(params: {
  company: CompanyProfile;
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  expenses: SiteExpense[];
  todayIso: string;
}): PresentationDeck {
  const { company, projects, towers, flats, employees, attendance, expenses, todayIso } = params;
  const activeCrew = employees.filter((e) => e.status === 'active');
  const todayAtt = attendance.filter((a) => a.date === todayIso);
  const presentToday = todayAtt.filter(
    (a) => a.status === 'present' || a.status === 'half_day'
  ).length;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  let totalZones = 0;
  let completedZones = 0;
  for (const flat of flats) {
    const prog = calculateFlatProgress(flat, company.tileZoneCatalog);
    totalZones += prog.totalZones;
    completedZones += prog.completedCount;
  }
  const completionPct = totalZones > 0 ? Math.round((completedZones / totalZones) * 100) : 0;

  return {
    id: `deck_live_${Date.now()}`,
    title: `${company.companyName || 'AVY INFRA'} — Site Operations Briefing`,
    theme: 'executive_slate',
    updatedAt: new Date().toISOString(),
    slides: [
      {
        id: 'slide_1',
        title: `${company.companyName || 'AVY INFRA'} — Project & Workforce Briefing`,
        subtitle: `${company.tagline || 'Construction & Tiling Contractors'} · Generated ${formatHumanDate(
          todayIso
        )}`,
        layout: 'title_cover',
        metrics: [
          { label: 'Active Projects', value: String(projects.length) },
          { label: 'Towers Monitored', value: String(towers.length) },
          { label: 'Active Workforce', value: String(activeCrew.length) },
          { label: 'Tile Completion', value: `${completionPct}%` },
        ],
        bullets: [
          `Site Operations Lead: ${company.signatoryName || 'Project Management'}`,
          `HR & Verification Contact: ${company.hrContact || 'On Record'}`,
          `GSTIN: ${company.gstNumber || 'Registered'}`,
        ],
        footerNote: `${company.companyName || 'AVY INFRA'} · Executive Site Review`,
      },
      {
        id: 'slide_2',
        title: 'Project & Tiling Execution Status',
        subtitle: 'Floor-by-floor apartment & common area progress across managed towers',
        layout: 'bullets_metrics',
        metrics: [
          { label: 'Total Units / Zones', value: `${flats.length} / ${totalZones}` },
          { label: 'Completed Areas', value: String(completedZones) },
          { label: 'Pending Areas', value: String(Math.max(0, totalZones - completedZones)) },
        ],
        bullets:
          projects.length > 0
            ? projects.slice(0, 5).map(
                (p) =>
                  `${p.name} (${p.location || 'Site'}) — Client: ${p.clientName || 'N/A'} · Status: ${
                    p.status
                  }`
              )
            : ['All active towers tracked floor-wise across hall, bedroom, balcony, skirting & corridors.'],
        footerNote: 'Live Floor & Tower Progress Summary',
      },
      {
        id: 'slide_3',
        title: 'Manpower Deployment & Financial Snapshot',
        subtitle: 'Daily gate attendance, trade mix, and site expense governance',
        layout: 'two_column',
        metrics: [
          { label: 'Present Today', value: `${presentToday} / ${activeCrew.length}` },
          { label: 'Site Expenses Logged', value: formatINR(totalExpenses) },
        ],
        bullets: [
          `Masons Deployed: ${activeCrew.filter((e) => e.role === 'Mason').length}`,
          `Helpers & Shifting: ${
            activeCrew.filter((e) => e.role === 'Helper' || e.role === 'Material Shifting').length
          }`,
          `Supervisors & Engineers: ${
            activeCrew.filter((e) => e.role === 'Supervisor' || e.role === 'Engineer').length
          }`,
        ],
        secondaryTitle: 'Governance & Safety Priorities',
        secondaryBullets: [
          '100% Quick Scan QR attendance compliance at shift start',
          'Weekly food advance acknowledgement & 24h WhatsApp follow-ups',
          'Zero-pendency QC handover before billing & final cleaning',
        ],
        footerNote: 'Workforce & Cost Control Briefing',
      },
    ],
  };
}

export function createBlankSlide(layout: SlideLayoutKey = 'bullets_metrics'): PresentationSlide {
  return {
    id: `slide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: 'New Site Briefing Slide',
    subtitle: 'Add key site milestone or client update',
    layout,
    metrics:
      layout === 'bullets_metrics'
        ? [
            { label: 'Metric 1', value: '100%' },
            { label: 'Metric 2', value: 'On Track' },
          ]
        : [],
    bullets: [
      'Key operational milestone or site update',
      'Quality inspection & safety observation',
      'Next week action plan',
    ],
    secondaryTitle: layout === 'two_column' ? 'Action Items' : undefined,
    secondaryBullets:
      layout === 'two_column'
        ? ['Assign tower supervisor check', 'Verify material stock']
        : undefined,
  };
}
