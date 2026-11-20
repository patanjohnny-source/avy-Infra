import { jsPDF } from 'jspdf';
import type { BillingDocument, CompanyProfile, Employee } from '../types/avy';
import {
  BILLING_DOC_TYPE_LABELS,
  formatAmountInWordsINR,
} from './billing';
import {
  type BulkCardLayout,
  type BulkPaperSize,
  type BulkWorkerCardModel,
  getBulkCardLayoutSpec,
  getBulkPaperSpec,
  paginateBulkWorkerCards,
} from './bulkWorkerCards';
import type { ProjectWorkStatusOverview, WorkAreaFilter } from './operations';
import { WORK_AREA_FILTER_OPTIONS } from './operations';
import { generateQrPngDataUrl } from './qrProfile';
import { ZONE_STATUS_LABELS } from './tileZones';

export const MAX_DOCUMENT_BYTES = 450 * 1024; // 450 KB raw file ceiling for Firestore & localStorage safety

function hexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex || typeof hex !== 'string') return fallback;
  const cleaned = hex.replace('#', '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return [
      parseInt(cleaned.slice(0, 2), 16),
      parseInt(cleaned.slice(2, 4), 16),
      parseInt(cleaned.slice(4, 6), 16),
    ];
  }
  return fallback;
}

/**
 * Compresses an uploaded image file to a bounded JPEG data URL for fast ID card & profile storage.
 */
export function compressImageToDataUrl(
  file: File,
  maxWidth = 320,
  maxHeight = 380,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image format.'));
      img.onload = () => {
        const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses a screenshot to a bounded JPEG data URL suitable both for OCR reading
 * and safe Firestore document storage (<= maxChars characters).
 */
export async function compressBoundedScreenshotDataUrl(
  file: File,
  options?: { maxWidth?: number; maxHeight?: number; quality?: number; maxChars?: number }
): Promise<string> {
  const maxWidth = options?.maxWidth ?? 760;
  const maxHeight = options?.maxHeight ?? 1200;
  const startQuality = options?.quality ?? 0.72;
  const maxChars = options?.maxChars ?? 220000;

  let quality = startQuality;
  let result = await compressImageToDataUrl(file, maxWidth, maxHeight, quality);
  if (result.length <= maxChars) return result;

  for (const [w, h, q] of [
    [640, 960, 0.6],
    [520, 820, 0.52],
    [420, 680, 0.45],
  ] as const) {
    result = await compressImageToDataUrl(file, w, h, q);
    if (result.length <= maxChars) return result;
  }

  return result.slice(0, maxChars);
}

/**
 * Reads a PDF or document file as a data URL with strict size guardrails.
 */
export function readDocumentAsDataUrl(file: File): Promise<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return Promise.reject(
      new Error(
        `File "${file.name}" is ${Math.round(file.size / 1024)} KB. Max allowed size is 450 KB for cloud sync.`
      )
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read document file.'));
    reader.onload = () => {
      resolve({
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        sizeBytes: file.size,
        dataUrl: String(reader.result),
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Generates an exact CR80 Vertical Portrait (54mm x 86mm) Front & Back Employee ID Card PDF:
 * Page 1 = Front Side (54mm x 86mm)
 * Page 2 = Back Side (54mm x 86mm)
 * Applies company-wide custom ID card background images and colors cleanly.
 */
export function buildEmployeeIdCardPdfBlob(
  employee: Employee,
  company: CompanyProfile,
  qrPngDataUrl?: string
): { blob: Blob; fileName: string } {
  const cardW = 54;
  const cardH = 86;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [cardW, cardH] });

  const bgRgb = hexToRgb(company.idCardBgColor, [255, 255, 255]);
  const headerRgb = hexToRgb(company.idCardHeaderColor, [15, 23, 42]);
  const accentRgb = hexToRgb(company.idCardAccentColor, [194, 65, 12]);
  const textRgb = hexToRgb(company.idCardTextColor, [15, 23, 42]);

  const drawCustomBackground = (dataUrl?: string) => {
    doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
    doc.rect(0, 0, cardW, cardH, 'F');
    if (dataUrl && dataUrl.startsWith('data:image/')) {
      try {
        const fmt = dataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        doc.addImage(dataUrl, fmt, 0, 0, cardW, cardH);
      } catch {
        // Fallback silently to solid bgRgb
      }
      // Subtle translucent white scrim to preserve crisp legibility when opacity < 0.85
      const opacity = typeof company.idCardBgOpacity === 'number' ? company.idCardBgOpacity : 0.25;
      const veilAlpha = Math.max(0, Math.min(0.85, 0.9 - opacity * 0.75));
      if (veilAlpha > 0.08) {
        try {
          const GStateCtor = (doc as unknown as { GState?: new (opts: { opacity: number }) => unknown }).GState;
          if (GStateCtor) {
            doc.saveGraphicsState();
            doc.setGState(new GStateCtor({ opacity: veilAlpha }) as never);
            doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
            doc.rect(0, 0, cardW, cardH, 'F');
            doc.restoreGraphicsState();
          }
        } catch {
          // Ignore GState unsupported fallback
        }
      }
    }
  };

  // ==================== PAGE 1: VERTICAL FRONT SIDE (54x86mm) ====================
  drawCustomBackground(company.idCardFrontBgDataUrl);

  // Header band
  doc.setFillColor(headerRgb[0], headerRgb[1], headerRgb[2]);
  doc.rect(0, 0, cardW, 14.5, 'F');
  // Accent stripe
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 14.5, cardW, 1.5, 'F');

  if (company.logoDataUrl && company.logoDataUrl.startsWith('data:image/')) {
    try {
      const fmt = company.logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(3, 2.5, 8.5, 8.5, 1, 1, 'F');
      doc.addImage(company.logoDataUrl, fmt, 3.4, 2.9, 7.7, 7.7);
    } catch {
      // Ignore logo render failure
    }
  }

  const titleX = company.logoDataUrl ? 13.5 : 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(255, 255, 255);
  doc.text(company.companyName.toUpperCase().slice(0, 20), titleX, 6.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.4);
  doc.setTextColor(226, 232, 240);
  doc.text((company.tagline || 'Tile Laying & Stone Finishing').slice(0, 32), titleX, 10.6);

  // STAFF ID pill
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(253, 186, 116);
  doc.text('STAFF ID', cardW - 3.5, 5.2, { align: 'right' });

  // Vertical Centered Photo Frame
  const photoW = 21;
  const photoH = 25;
  const photoX = (cardW - photoW) / 2;
  const photoY = 19;

  doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.setLineWidth(0.4);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(photoX, photoY, photoW, photoH, 1.5, 1.5, 'FD');

  if (employee.photoDataUrl && employee.photoDataUrl.startsWith('data:image/')) {
    try {
      const fmt = employee.photoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(employee.photoDataUrl, fmt, photoX + 0.4, photoY + 0.4, photoW - 0.8, photoH - 0.8);
    } catch {
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('PHOTO', cardW / 2, photoY + photoH / 2, { align: 'center' });
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(100, 116, 139);
    const initials = employee.fullName
      .split(' ')
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    doc.text(initials || 'ID', cardW / 2, photoY + photoH / 2 + 2, { align: 'center' });
  }

  // Name & Code Centered
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  doc.text(employee.fullName.slice(0, 24), cardW / 2, 49.5, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text(`${employee.empCode} · ${employee.role.toUpperCase()}`, cardW / 2, 53.8, {
    align: 'center',
  });

  // Divider line
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.line(5, 56.2, cardW - 5, 56.2);

  // Employee Details Rows
  let fy = 60.4;
  const drawFrontKv = (lbl: string, val: string, isBlood = false) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(71, 85, 105);
    doc.text(lbl, 5, fy);
    doc.setFont('helvetica', isBlood ? 'bold' : 'normal');
    if (isBlood) doc.setTextColor(185, 28, 28);
    else doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
    doc.text(val.slice(0, 26), 19, fy);
    fy += 4.2;
  };

  drawFrontKv('Mobile:', employee.phone || '-');
  drawFrontKv('Blood Grp:', employee.bloodGroup || 'N/A', true);
  drawFrontKv('Joined:', employee.joiningDate || '-');
  const siteTxt = employee.currentProjectName
    ? `${employee.currentProjectName}${employee.currentTowerName ? ` (${employee.currentTowerName})` : ''}`
    : 'All Active Sites';
  drawFrontKv('Site:', siteTxt);

  // Front Footer Bar
  doc.setFillColor(headerRgb[0], headerRgb[1], headerRgb[2]);
  doc.rect(0, cardH - 7, cardW, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.6);
  doc.setTextColor(255, 255, 255);
  doc.text(`STATUS: ${employee.status.toUpperCase()}`, 3.5, cardH - 2.6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(226, 232, 240);
  doc.text(`HR: ${(company.hrContact || '').slice(0, 18)}`, cardW - 3.5, cardH - 2.6, {
    align: 'right',
  });

  // ==================== PAGE 2: VERTICAL BACK SIDE (54x86mm) ====================
  doc.addPage([cardW, cardH], 'portrait');
  drawCustomBackground(company.idCardBackBgDataUrl || company.idCardFrontBgDataUrl);

  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 0, cardW, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(255, 255, 255);
  doc.text('STATUTORY & SITE QR PASS', cardW / 2, 5.8, { align: 'center' });

  // QR Block Centered at Top of Back
  const qrSize = 24;
  const qrX = (cardW - qrSize) / 2;
  const qrY = 12;
  if (qrPngDataUrl) {
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qrX - 1.5, qrY - 1.2, qrSize + 3, qrSize + 5.2, 1.2, 1.2, 'FD');
    try {
      doc.addImage(qrPngDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    } catch {
      // Ignore invalid QR image
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.8);
    doc.setTextColor(15, 23, 42);
    doc.text('SCAN FOR LIVE SITE STATUS', cardW / 2, qrY + qrSize + 2.8, { align: 'center' });
  }

  let rowY = 44.5;
  const lineGap = 4.1;
  doc.setFontSize(5.9);

  const printBackKv = (label: string, val: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(label, 4, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
    doc.text(val.slice(0, 24), 21, rowY);
    rowY += lineGap;
  };

  printBackKv('Aadhaar:', employee.aadharRef || 'Not recorded');
  printBackKv('PF / UAN:', employee.pfNumber || 'Pending');
  printBackKv('ESI No:', employee.esiNumber || 'Pending');
  printBackKv('Alt Mob:', employee.alternatePhone || '-');
  printBackKv('Emergency:', employee.emergencyContact || 'Not recorded');

  doc.setDrawColor(203, 213, 225);
  doc.line(4, rowY - 1, cardW - 4, rowY - 1);
  rowY += 2.3;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  doc.text(company.companyName.slice(0, 28), 4, rowY);
  rowY += 3.1;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.4);
  doc.setTextColor(71, 85, 105);
  const addrLines = doc.splitTextToSize(company.address || '', cardW - 8) as string[];
  for (const line of addrLines.slice(0, 2)) {
    doc.text(line, 4, rowY);
    rowY += 2.7;
  }
  doc.text(`HR: ${(company.hrContact || '').slice(0, 26)}`, 4, rowY + 0.5);

  // Back Footer Bar
  doc.setFillColor(headerRgb[0], headerRgb[1], headerRgb[2]);
  doc.rect(0, cardH - 7, cardW, 7, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.setTextColor(226, 232, 240);
  doc.text('If found, return to HR.', 3.5, cardH - 2.6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text((company.signatoryName || 'Authorized Signatory').slice(0, 22), cardW - 3.5, cardH - 2.6, {
    align: 'right',
  });

  const blob = doc.output('blob');
  const fileName = `${employee.empCode}_${employee.fullName.replace(/[^a-zA-Z0-9]+/g, '_')}_Vertical_ID_Card.pdf`;
  return { blob, fileName };
}

/**
 * Generates an A4 PDF register of Present, Half-Day, Absent & Unmarked employees for a Tower/Project & Date.
 */
export function buildTowerAttendancePdfBlob(params: {
  companyName: string;
  projectName: string;
  towerName: string;
  date: string;
  supervisorInfo?: string;
  inchargeInfo?: string;
  engineerInfo?: string;
  presentNames: string[];
  halfDayNames: string[];
  absentNames: string[];
  unmarkedNames: string[];
  totalWageText: string;
}): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(`${params.companyName} — Tower Attendance & Absent/Present Report`, 14, y);
  y += 6.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Project: ${params.projectName}   |   Tower: ${params.towerName}   |   Date: ${params.date}`, 14, y);
  y += 5;

  const contacts = [params.inchargeInfo, params.supervisorInfo, params.engineerInfo]
    .filter(Boolean)
    .join('  |  ');
  if (contacts) {
    doc.setFontSize(8.5);
    doc.text(contacts.slice(0, 110), 14, y);
    y += 5.5;
  }

  // Summary Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, 182, 13, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Present: ${params.presentNames.length}    Half-Day: ${params.halfDayNames.length}    Absent: ${params.absentNames.length}    Unmarked: ${params.unmarkedNames.length}    Day Wage Total: ${params.totalWageText}`,
    18,
    y + 8
  );
  y += 20;

  const renderSection = (title: string, items: string[], color: [number, number, number]) => {
    if (y > 265) {
      doc.addPage();
      y = 16;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(`${title} (${items.length})`, 14, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    if (items.length === 0) {
      doc.setTextColor(148, 163, 184);
      doc.text('None', 18, y);
      y += 6;
    } else {
      items.forEach((line, idx) => {
        if (y > 276) {
          doc.addPage();
          y = 16;
        }
        doc.text(`${idx + 1}. ${line}`, 18, y);
        y += 5;
      });
      y += 3;
    }
  };

  renderSection('PRESENT CREW', params.presentNames, [4, 120, 87]);
  renderSection('HALF-DAY CREW', params.halfDayNames, [180, 83, 9]);
  renderSection('ABSENT CREW', params.absentNames, [185, 28, 28]);
  if (params.unmarkedNames.length > 0) {
    renderSection('UNMARKED / PENDING', params.unmarkedNames, [100, 116, 139]);
  }

  const safeTower = params.towerName.replace(/[^a-zA-Z0-9]+/g, '_');
  const fileName = `Attendance_${safeTower}_${params.date}.pdf`;
  return { blob: doc.output('blob'), fileName };
}

/**
 * Generates an A4 PDF report for Project-wise & Tower-wise Expenses and Food Advances.
 */
export function buildExpenseReportPdfBlob(params: {
  companyName: string;
  reportTitle: string;
  periodLabel: string;
  rows: {
    label: string;
    sublabel: string;
    wages: string;
    food: string;
    cash: string;
    siteExp: string;
    total: string;
  }[];
  grandTotal: string;
}): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${params.companyName} — ${params.reportTitle}`, 14, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Period: ${params.periodLabel}   |   Grand Total: ${params.grandTotal}`, 14, y);
  y += 8;

  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text('Project / Tower', 16, y + 5.3);
  doc.text('Wages', 98, y + 5.3, { align: 'right' });
  doc.text('Food Adv', 122, y + 5.3, { align: 'right' });
  doc.text('Cash Adv', 146, y + 5.3, { align: 'right' });
  doc.text('Site Exp', 170, y + 5.3, { align: 'right' });
  doc.text('Total', 194, y + 5.3, { align: 'right' });
  y += 10;

  doc.setFont('helvetica', 'normal');
  for (const row of params.rows) {
    if (y > 272) {
      doc.addPage();
      y = 16;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(row.label.slice(0, 34), 16, y + 3.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(row.sublabel.slice(0, 42), 16, y + 7.2);

    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(row.wages, 98, y + 4.5, { align: 'right' });
    doc.text(row.food, 122, y + 4.5, { align: 'right' });
    doc.text(row.cash, 146, y + 4.5, { align: 'right' });
    doc.text(row.siteExp, 170, y + 4.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(row.total, 194, y + 4.5, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 9.5, 196, y + 9.5);
    y += 11;
  }

  const fileName = `${params.companyName.replace(/[^a-zA-Z0-9]+/g, '_')}_Expense_Report.pdf`;
  return { blob: doc.output('blob'), fileName };
}

/**
 * Generates an A4 printable Employee Monthly Attendance Card PDF.
 */
export function buildEmployeeAttendanceCardPdfBlob(params: {
  companyName: string;
  empCode: string;
  employeeName: string;
  role: string;
  phone: string;
  siteLabel: string;
  dailyRateText: string;
  monthLabel: string;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  effectiveDays: number;
  overtimeHours: number;
  totalWagesEarnedText: string;
  monthAdvancesText: string;
  days: {
    day: number;
    date: string;
    weekdayShort: string;
    statusLabel: string;
    siteLabel: string;
    otHours: number;
    earnedText: string;
    notes: string;
  }[];
}): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 14;

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(14, y, 182, 16, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(`${params.companyName} — EMPLOYEE ATTENDANCE CARD`, 18, y + 6.8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(226, 232, 240);
  doc.text(`Month: ${params.monthLabel}`, 18, y + 12.2);
  doc.text(`ID: ${params.empCode}`, 192, y + 6.8, { align: 'right' });
  doc.text(`Daily Rate: ${params.dailyRateText}`, 192, y + 12.2, { align: 'right' });
  y += 20;

  // Employee Identity Strip
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${params.employeeName}  (${params.role})`, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Mob: ${params.phone || '-'}   |   Assigned Site: ${params.siteLabel || 'Not Assigned'}`, 14, y + 4.8);
  y += 9;

  // Monthly Summary Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, 182, 12, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `P: ${params.presentDays}   HD: ${params.halfDays}   A: ${params.absentDays}   Eff Days: ${params.effectiveDays}d   OT: ${params.overtimeHours}h   Wages: ${params.totalWagesEarnedText}   Adv: ${params.monthAdvancesText}`,
    18,
    y + 7.5
  );
  y += 16;

  // Day Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 6.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Date', 16, y + 4.4);
  doc.text('Day', 38, y + 4.4);
  doc.text('Status', 52, y + 4.4);
  doc.text('Site / Tower', 76, y + 4.4);
  doc.text('OT (h)', 135, y + 4.4, { align: 'right' });
  doc.text('Earned', 158, y + 4.4, { align: 'right' });
  doc.text('Notes', 162, y + 4.4);
  y += 7.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  for (const row of params.days) {
    if (y > 274) {
      doc.addPage();
      y = 14;
    }
    doc.setTextColor(15, 23, 42);
    doc.text(row.date, 16, y + 3.4);
    doc.setTextColor(100, 116, 139);
    doc.text(row.weekdayShort, 38, y + 3.4);

    if (row.statusLabel === 'Present') doc.setTextColor(4, 120, 87);
    else if (row.statusLabel === 'Half Day') doc.setTextColor(180, 83, 9);
    else if (row.statusLabel === 'Absent') doc.setTextColor(185, 28, 28);
    else doc.setTextColor(148, 163, 184);
    doc.text(row.statusLabel, 52, y + 3.4);

    doc.setTextColor(51, 65, 85);
    doc.text((row.siteLabel || '-').slice(0, 26), 76, y + 3.4);
    doc.text(row.otHours > 0 ? String(row.otHours) : '-', 135, y + 3.4, { align: 'right' });
    doc.text(row.earnedText, 158, y + 3.4, { align: 'right' });
    doc.text((row.notes || '').slice(0, 18), 162, y + 3.4);

    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 4.8, 196, y + 4.8);
    y += 5.4;
  }

  y += 8;
  if (y > 278) {
    doc.addPage();
    y = 20;
  }
  doc.setDrawColor(148, 163, 184);
  doc.line(16, y, 76, y);
  doc.line(130, y, 192, y);
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Employee Signature', 16, y + 4.5);
  doc.text('Tower Supervisor / Site Engineer', 130, y + 4.5);

  const safeName = params.employeeName.replace(/[^a-zA-Z0-9]+/g, '_');
  const safeMonth = params.monthLabel.replace(/[^a-zA-Z0-9]+/g, '_');
  const fileName = `${params.empCode}_${safeName}_Attendance_Card_${safeMonth}.pdf`;
  return { blob: doc.output('blob'), fileName };
}

export async function buildWorkforceQrSheetPdfBlob(params: {
  companyName: string;
  layout: 'badges' | 'stickers';
  items: Array<{
    empCode: string;
    fullName: string;
    role: string;
    siteLabel: string;
    status: string;
    scanUrl: string;
  }>;
}): Promise<{ blob: Blob; fileName: string }> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const qrDataUrls = await Promise.all(
    params.items.map((item) => generateQrPngDataUrl(item.scanUrl, 260))
  );

  const isStickers = params.layout === 'stickers';
  const cols = isStickers ? 3 : 2;
  const rowsPerPage = isStickers ? 4 : 3;
  const perPage = cols * rowsPerPage;

  const marginX = 12;
  const startY = 22;
  const gapX = isStickers ? 5 : 8;
  const gapY = isStickers ? 6 : 8;
  const cardW = (210 - marginX * 2 - gapX * (cols - 1)) / cols;
  const cardH = isStickers ? 62 : 82;

  const drawPageHeader = (pageIdx: number, totalPages: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${params.companyName} — Workforce QR Verification ${isStickers ? 'Stickers' : 'Badges'}`,
      marginX,
      12
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Scan any QR code to view live read-only site deployment & work status · Page ${pageIdx + 1}/${totalPages}`,
      marginX,
      17
    );
  };

  const totalPages = Math.max(1, Math.ceil(params.items.length / perPage));
  drawPageHeader(0, totalPages);

  params.items.forEach((item, index) => {
    const pageIdx = Math.floor(index / perPage);
    const slotIdx = index % perPage;
    if (index > 0 && slotIdx === 0) {
      doc.addPage();
      drawPageHeader(pageIdx, totalPages);
    }

    const col = slotIdx % cols;
    const row = Math.floor(slotIdx / cols);
    const x = marginX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');

    // Header band
    doc.setFillColor(15, 23, 42);
    doc.rect(x, y, cardW, isStickers ? 7 : 9, 'F');
    doc.setFillColor(194, 65, 12);
    doc.rect(x, y + (isStickers ? 7 : 9), cardW, 1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isStickers ? 7 : 8.5);
    doc.setTextColor(255, 255, 255);
    doc.text(params.companyName.slice(0, 22).toUpperCase(), x + 3, y + (isStickers ? 4.8 : 6));
    doc.setFontSize(isStickers ? 6.2 : 7.5);
    doc.setTextColor(253, 186, 116);
    doc.text(item.empCode, x + cardW - 3, y + (isStickers ? 4.8 : 6), { align: 'right' });

    if (isStickers) {
      const qrSize = 31;
      const qrX = x + (cardW - qrSize) / 2;
      const qrY = y + 10.5;
      doc.addImage(qrDataUrls[index], 'PNG', qrX, qrY, qrSize, qrSize);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(item.fullName.slice(0, 22), x + cardW / 2, qrY + qrSize + 5.2, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(194, 65, 12);
      doc.text(item.role, x + cardW / 2, qrY + qrSize + 9.2, { align: 'center' });

      doc.setFontSize(6.3);
      doc.setTextColor(71, 85, 105);
      doc.text(item.siteLabel.slice(0, 28), x + cardW / 2, qrY + qrSize + 13.2, { align: 'center' });
    } else {
      const qrSize = 38;
      const qrX = x + (cardW - qrSize) / 2;
      const qrY = y + 13;
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(qrX - 1.5, qrY - 1.5, qrSize + 3, qrSize + 3, 1.2, 1.2, 'D');
      doc.addImage(qrDataUrls[index], 'PNG', qrX, qrY, qrSize, qrSize);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(item.fullName.slice(0, 24), x + cardW / 2, qrY + qrSize + 7.5, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(194, 65, 12);
      doc.text(`${item.empCode}  ·  ${item.role}`, x + cardW / 2, qrY + qrSize + 12.2, {
        align: 'center',
      });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(51, 65, 85);
      doc.text(item.siteLabel.slice(0, 34), x + cardW / 2, qrY + qrSize + 16.8, {
        align: 'center',
      });

      doc.setFontSize(6.3);
      doc.setTextColor(100, 116, 139);
      doc.text('SCAN QR FOR LIVE SITE & WORK STATUS', x + cardW / 2, y + cardH - 3.5, {
        align: 'center',
      });
    }
  });

  const safeCo = params.companyName.replace(/[^a-zA-Z0-9]+/g, '_');
  const fileName = `${safeCo}_Workforce_QR_${isStickers ? 'Stickers' : 'Badges'}.pdf`;
  return { blob: doc.output('blob'), fileName };
}

/**
 * Generates an A4 formal PDF for Quotation, Invoice, or GST Tax Invoice.
 */
export function buildBillingDocumentPdfBlob(
  billingDoc: BillingDocument,
  company: CompanyProfile
): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 14;

  const docTitle = BILLING_DOC_TYPE_LABELS[billingDoc.docType].toUpperCase();

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, y, contentW, 24, 'F');
  doc.setFillColor(194, 65, 12);
  doc.rect(margin, y + 24, contentW, 1.5, 'F');

  if (company.logoDataUrl && company.logoDataUrl.startsWith('data:image/')) {
    try {
      const fmt = company.logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin + 3, y + 3, 18, 18, 1.5, 1.5, 'F');
      doc.addImage(company.logoDataUrl, fmt, margin + 4, y + 4, 16, 16);
    } catch {
      // Ignore invalid logo
    }
  }

  const coX = company.logoDataUrl ? margin + 24 : margin + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(company.companyName.toUpperCase(), coX, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text((company.tagline || 'Tile Laying & Stone Finishing Contractors').slice(0, 56), coX, y + 12.5);
  doc.text((company.address || '').slice(0, 74), coX, y + 16.8);
  doc.text(
    `GSTIN: ${company.gstNumber || 'N/A'}   |   Ph: ${company.hrContact || '-'}   |   ${company.hrEmail || ''}`.slice(
      0,
      78
    ),
    coX,
    y + 21
  );

  // Right Document Type & Number badge
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(253, 186, 116);
  doc.text(docTitle, pageW - margin - 4, y + 9, { align: 'right' });
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(billingDoc.docNumber, pageW - margin - 4, y + 14.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(226, 232, 240);
  doc.text(`Date: ${billingDoc.issueDate}`, pageW - margin - 4, y + 19.5, { align: 'right' });

  y += 30;

  // Client & Project Details Split Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, contentW, 28, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('BILL TO / CLIENT DETAILS', margin + 4, y + 5.5);
  doc.text('PROJECT & TAX METADATA', margin + 98, y + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(billingDoc.clientName.slice(0, 44), margin + 4, y + 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  const clientAddr = doc.splitTextToSize(billingDoc.clientAddress || 'Site / Office Address on file', 84) as string[];
  doc.text(clientAddr[0] || '', margin + 4, y + 15.5);
  if (clientAddr[1]) doc.text(clientAddr[1], margin + 4, y + 19.2);
  doc.text(
    `GSTIN: ${billingDoc.clientGstin || 'Unregistered'}  |  Ph: ${billingDoc.clientPhone || '-'}`,
    margin + 4,
    y + 24.5
  );

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const projTxt = billingDoc.projectName
    ? `${billingDoc.projectName}${billingDoc.towerName ? ` (${billingDoc.towerName})` : ''}`
    : 'General Site Contract';
  doc.text(`Project: ${projTxt.slice(0, 38)}`, margin + 98, y + 11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(`Place of Supply: ${billingDoc.placeOfSupply || 'Local State'}`, margin + 98, y + 15.5);
  doc.text(
    `Due / Valid Till: ${billingDoc.dueDate || 'Immediate'}   |   Status: ${billingDoc.status.toUpperCase()}`,
    margin + 98,
    y + 20
  );
  doc.text(
    `Tax Scheme: ${
      billingDoc.taxMode === 'cgst_sgst'
        ? 'CGST + SGST (Intra-State)'
        : billingDoc.taxMode === 'igst'
          ? 'IGST (Inter-State)'
          : 'No Tax / Exempt'
    }`,
    margin + 98,
    y + 24.5
  );

  y += 33;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, y, contentW, 8, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('#', margin + 2.5, y + 5.2);
  doc.text('Work Description / BOQ Item', margin + 9, y + 5.2);
  doc.text('HSN/SAC', margin + 92, y + 5.2);
  doc.text('Qty', margin + 120, y + 5.2, { align: 'right' });
  doc.text('Unit', margin + 123, y + 5.2);
  doc.text('Rate', margin + 149, y + 5.2, { align: 'right' });
  doc.text('GST%', margin + 164, y + 5.2, { align: 'right' });
  doc.text('Amount', pageW - margin - 2.5, y + 5.2, { align: 'right' });
  y += 9;

  for (let i = 0; i < billingDoc.items.length; i += 1) {
    const it = billingDoc.items[i];
    const descLines = doc.splitTextToSize(it.description || 'Tile Work', 78) as string[];
    const rowH = Math.max(7.5, descLines.length * 4 + 3);
    if (y + rowH > 245) {
      doc.addPage();
      y = 16;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(String(i + 1), margin + 2.5, y + 4.5);
    descLines.slice(0, 3).forEach((ln, idx) => {
      doc.text(ln, margin + 9, y + 4.5 + idx * 3.8);
    });
    doc.setTextColor(71, 85, 105);
    doc.text((it.hsnSac || '995433').slice(0, 10), margin + 92, y + 4.5);
    doc.setTextColor(15, 23, 42);
    doc.text(String(it.quantity), margin + 120, y + 4.5, { align: 'right' });
    doc.text((it.unit || 'Sq.Ft').slice(0, 8), margin + 123, y + 4.5);
    doc.text(`Rs.${Math.round(it.rate).toLocaleString('en-IN')}`, margin + 149, y + 4.5, {
      align: 'right',
    });
    doc.text(`${billingDoc.taxMode === 'none' ? 0 : it.gstRate}%`, margin + 164, y + 4.5, {
      align: 'right',
    });
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Rs.${Math.round(it.lineTotal).toLocaleString('en-IN')}`,
      pageW - margin - 2.5,
      y + 4.5,
      { align: 'right' }
    );

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + rowH, pageW - margin, y + rowH);
    y += rowH;
  }

  y += 5;
  if (y > 228) {
    doc.addPage();
    y = 16;
  }

  // Summary Split: Left Amount in Words + Notes, Right Totals Box
  const totalsBoxX = margin + 112;
  const totalsBoxW = contentW - 112;
  const totalsStartY = y;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Amount in Words:', margin, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(15, 23, 42);
  const wordsLines = doc.splitTextToSize(formatAmountInWordsINR(billingDoc.grandTotal), 104) as string[];
  wordsLines.slice(0, 2).forEach((ln, idx) => {
    doc.text(ln, margin, y + 8.5 + idx * 4);
  });

  if (billingDoc.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('Notes:', margin, y + 18.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    const noteLines = doc.splitTextToSize(billingDoc.notes, 104) as string[];
    noteLines.slice(0, 3).forEach((ln, idx) => {
      doc.text(ln, margin, y + 22.5 + idx * 3.6);
    });
  }

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  const boxHeight = billingDoc.docType !== 'quotation' && billingDoc.amountPaid > 0 ? 37 : 29;
  doc.roundedRect(totalsBoxX, totalsStartY, totalsBoxW, boxHeight, 1.5, 1.5, 'FD');

  let ty = totalsStartY + 5.5;
  const drawTotalRow = (lbl: string, val: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9 : 7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(lbl, totalsBoxX + 4, ty);
    doc.text(val, totalsBoxX + totalsBoxW - 4, ty, { align: 'right' });
    ty += bold ? 5.5 : 4.5;
  };

  drawTotalRow('Taxable Subtotal:', `Rs.${Math.round(billingDoc.subtotal).toLocaleString('en-IN')}`);
  if (billingDoc.taxMode === 'cgst_sgst') {
    drawTotalRow('CGST:', `Rs.${Math.round(billingDoc.cgstTotal).toLocaleString('en-IN')}`);
    drawTotalRow('SGST:', `Rs.${Math.round(billingDoc.sgstTotal).toLocaleString('en-IN')}`);
  } else if (billingDoc.taxMode === 'igst') {
    drawTotalRow('IGST:', `Rs.${Math.round(billingDoc.igstTotal).toLocaleString('en-IN')}`);
  }
  drawTotalRow('Round Off:', `Rs.${billingDoc.roundOff.toFixed(2)}`);
  doc.setDrawColor(203, 213, 225);
  doc.line(totalsBoxX + 3, ty - 2.5, totalsBoxX + totalsBoxW - 3, ty - 2.5);
  drawTotalRow('GRAND TOTAL:', `Rs.${Math.round(billingDoc.grandTotal).toLocaleString('en-IN')}`, true);

  if (billingDoc.docType !== 'quotation' && billingDoc.amountPaid > 0) {
    const bal = Math.max(0, billingDoc.grandTotal - billingDoc.amountPaid);
    drawTotalRow(
      'Paid / Balance:',
      `Rs.${Math.round(billingDoc.amountPaid).toLocaleString('en-IN')} / Rs.${Math.round(bal).toLocaleString('en-IN')}`
    );
  }

  y = totalsStartY + Math.max(boxHeight + 8, 38);
  if (billingDoc.terms) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('Terms & Conditions:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const termLines = doc.splitTextToSize(billingDoc.terms, 115) as string[];
    termLines.slice(0, 4).forEach((ln, idx) => {
      doc.text(ln, margin, y + 4 + idx * 3.5);
    });
  }

  // Signatory Block
  doc.setDrawColor(148, 163, 184);
  doc.line(pageW - margin - 58, y + 14, pageW - margin, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${company.companyName}`, pageW - margin, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(company.signatoryName || 'Authorized Signatory', pageW - margin, y + 18.5, {
    align: 'right',
  });

  const safeDocNo = billingDoc.docNumber.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const fileName = `${safeDocNo}_${billingDoc.clientName.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 24)}.pdf`;
  return { blob: doc.output('blob'), fileName };
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Generates an A4 Portrait PDF of Filtered Work Progress (Tower-wise / Floor-wise / Flat-wise + Area Filter).
 */
export function buildWorkReportPdfBlob(params: {
  company: CompanyProfile;
  title: string;
  scopeSummary: string;
  filterSummary: string;
  breakdownLevel: 'tower' | 'floor' | 'flat';
  areaFilter: WorkAreaFilter;
  overview: ProjectWorkStatusOverview;
}): { blob: Blob; fileName: string } {
  const { company, title, scopeSummary, filterSummary, breakdownLevel, areaFilter, overview } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 12;
  const contentW = pageW - margin * 2;
  let y = 12;

  const areaLabel = WORK_AREA_FILTER_OPTIONS.find((a) => a.id === areaFilter)?.label || 'All Tile Areas';
  const genDate = new Date().toLocaleDateString('en-IN');

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, y, contentW, 20, 'F');
  doc.setFillColor(194, 65, 12);
  doc.rect(margin, y + 20, contentW, 1.4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(255, 255, 255);
  doc.text(company.companyName.toUpperCase(), margin + 4, y + 7.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text((company.tagline || 'Tile Laying & Stone Finishing Contractors').slice(0, 62), margin + 4, y + 12.2);
  doc.text(scopeSummary.slice(0, 82), margin + 4, y + 16.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(253, 186, 116);
  doc.text(title.toUpperCase().slice(0, 34), pageW - margin - 4, y + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(226, 232, 240);
  doc.text(`Area: ${areaLabel}`, pageW - margin - 4, y + 12.8, { align: 'right' });
  doc.text(`Printed: ${genDate}`, pageW - margin - 4, y + 17.2, { align: 'right' });
  y += 25;

  // Filter Metadata & KPIs
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, contentW, 18, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`Filters: ${filterSummary.slice(0, 108)}`, margin + 3.5, y + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Flats: ${overview.totalFlats}   |   Matching Areas: ${overview.matchingZonesTotal} (${Math.round(overview.matchingSqftTotal).toLocaleString('en-IN')} Sq.Ft)   |   Pending: ${overview.pendingZones}   |   Running: ${overview.inProgressZones}   |   Done: ${overview.completedZones} (${overview.overallProgressPct}%)`,
    margin + 3.5,
    y + 12.8
  );
  y += 22;

  const ensureSpace = (needed: number) => {
    if (y + needed > 276) {
      doc.addPage();
      y = 14;
    }
  };

  // Table header helper
  const drawTableHeader = (cols: Array<{ label: string; x: number; align?: 'right' | 'left' }>) => {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentW, 7.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(51, 65, 85);
    for (const c of cols) {
      doc.text(c.label, c.x, y + 5, c.align === 'right' ? { align: 'right' } : undefined);
    }
    y += 8;
  };

  if (breakdownLevel === 'tower') {
    const cols = [
      { label: 'Tower / Project', x: margin + 2.5 },
      { label: 'Flats', x: margin + 78, align: 'right' as const },
      { label: 'Matched Areas', x: margin + 104, align: 'right' as const },
      { label: 'Matched Sq.Ft', x: margin + 130, align: 'right' as const },
      { label: 'Pending', x: margin + 148, align: 'right' as const },
      { label: 'Running', x: margin + 166, align: 'right' as const },
      { label: 'Done %', x: pageW - margin - 2.5, align: 'right' as const },
    ];
    drawTableHeader(cols);

    for (const row of overview.towerRows) {
      ensureSpace(9);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.6);
      doc.setTextColor(15, 23, 42);
      doc.text(`${row.tower.name} (${row.projectName})`.slice(0, 42), margin + 2.5, y + 4.8);
      doc.setFont('helvetica', 'normal');
      doc.text(String(row.flatCount), margin + 78, y + 4.8, { align: 'right' });
      doc.text(String(row.matchingZonesCount), margin + 104, y + 4.8, { align: 'right' });
      doc.text(Math.round(row.matchingSqft).toLocaleString('en-IN'), margin + 130, y + 4.8, { align: 'right' });
      doc.text(String(row.pendingZones), margin + 148, y + 4.8, { align: 'right' });
      doc.text(String(row.inProgressZones), margin + 166, y + 4.8, { align: 'right' });
      doc.text(`${row.completedZones} (${row.progressPct}%)`, pageW - margin - 2.5, y + 4.8, { align: 'right' });
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 7.2, pageW - margin, y + 7.2);
      y += 7.5;
    }
  } else if (breakdownLevel === 'floor') {
    const cols = [
      { label: 'Floor / Level', x: margin + 2.5 },
      { label: 'Project · Tower', x: margin + 40 },
      { label: 'Flats', x: margin + 102, align: 'right' as const },
      { label: 'Matched Areas', x: margin + 128, align: 'right' as const },
      { label: 'Sq.Ft', x: margin + 148, align: 'right' as const },
      { label: 'Pend / Run', x: margin + 168, align: 'right' as const },
      { label: 'Done %', x: pageW - margin - 2.5, align: 'right' as const },
    ];
    drawTableHeader(cols);

    for (const row of overview.floorRows) {
      ensureSpace(9);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.text(row.floorLabel.slice(0, 22), margin + 2.5, y + 4.8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.text(`${row.projectName} · ${row.towerName}`.slice(0, 32), margin + 40, y + 4.8);
      doc.setTextColor(15, 23, 42);
      doc.text(String(row.flatCount), margin + 102, y + 4.8, { align: 'right' });
      doc.text(String(row.matchingZonesCount), margin + 128, y + 4.8, { align: 'right' });
      doc.text(Math.round(row.matchingSqft).toLocaleString('en-IN'), margin + 148, y + 4.8, { align: 'right' });
      doc.text(`${row.pendingZones}/${row.inProgressZones}`, margin + 168, y + 4.8, { align: 'right' });
      doc.text(`${row.progressPct}%`, pageW - margin - 2.5, y + 4.8, { align: 'right' });
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 7.2, pageW - margin, y + 7.2);
      y += 7.5;
    }
  } else {
    const cols = [
      { label: 'Flat / Type', x: margin + 2.5 },
      { label: 'Tower · Floor', x: margin + 36 },
      { label: 'P/IP/D', x: margin + 84, align: 'right' as const },
      { label: 'Sq.Ft', x: margin + 100, align: 'right' as const },
      { label: 'Matching Tile Areas & Status', x: margin + 105 },
    ];
    drawTableHeader(cols);

    for (const row of overview.flatRows) {
      const zoneSummaryText =
        row.matchingZoneDetails
          .map((d) => `${d.label} (${d.sqft}sf: ${ZONE_STATUS_LABELS[d.status]})`)
          .join(', ') || 'No matching areas';
      const lines = doc.splitTextToSize(zoneSummaryText, 78) as string[];
      const rowH = Math.max(7.5, lines.length * 3.8 + 3);
      ensureSpace(rowH + 2);
      if (y === 14) {
        drawTableHeader(cols);
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      doc.setTextColor(15, 23, 42);
      doc.text(`${row.flat.unitNumber} (${row.flat.unitType})`.slice(0, 20), margin + 2.5, y + 4.6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.text(`${row.towerName} · ${row.floorLabel}`.slice(0, 24), margin + 36, y + 4.6);
      doc.setTextColor(15, 23, 42);
      doc.text(`${row.pendingZones}/${row.inProgressZones}/${row.completedZones}`, margin + 84, y + 4.6, { align: 'right' });
      doc.text(String(Math.round(row.matchingSqft)), margin + 100, y + 4.6, { align: 'right' });
      lines.slice(0, 5).forEach((ln, idx) => {
        doc.text(ln, margin + 105, y + 4.6 + idx * 3.8);
      });
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + rowH, pageW - margin, y + rowH);
      y += rowH;
    }
  }

  ensureSpace(22);
  y += 10;
  doc.setDrawColor(148, 163, 184);
  doc.line(margin, y + 6, margin + 52, y + 6);
  doc.line(pageW - margin - 52, y + 6, pageW - margin, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(71, 85, 105);
  doc.text('Site Supervisor / Engineer', margin, y + 10.5);
  doc.text('Project Manager / Authorized Sign', pageW - margin, y + 10.5, { align: 'right' });

  const safeTitle = title.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 28);
  const fileName = `${company.companyName.replace(/[^a-zA-Z0-9]+/g, '_')}_${safeTitle}_${genDate.replace(/\//g, '-')}.pdf`;
  return { blob: doc.output('blob'), fileName };
}

/**
 * Generates a single paginated multi-page PDF (A4 or US Letter) containing neat attendance/ID cards
 * for multiple selected workers (2-Up Profile & Muster, 4-Up Vertical ID Cards, or 6-Up Wallet Grid).
 */
export async function buildBulkWorkerProfileCardsPdfBlob(params: {
  company: CompanyProfile;
  cards: BulkWorkerCardModel[];
  paperSize: BulkPaperSize;
  layout: BulkCardLayout;
  monthLabel: string;
  showCutMarks: boolean;
  showWageSummary: boolean;
}): Promise<{ blob: Blob; fileName: string }> {
  const { company, cards, paperSize, layout, monthLabel, showCutMarks, showWageSummary } = params;
  const paperSpec = getBulkPaperSpec(paperSize);
  const layoutSpec = getBulkCardLayoutSpec(layout);
  const pages = paginateBulkWorkerCards(cards, layoutSpec.cardsPerPage);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: paperSize === 'letter' ? 'letter' : 'a4',
  });

  const qrDataUrls = await Promise.all(
    cards.map((c) => generateQrPngDataUrl(c.scanUrl || c.employee.empCode, 220))
  );
  const qrByEmpId = new Map<string, string>();
  cards.forEach((c, idx) => {
    qrByEmpId.set(c.employee.id, qrDataUrls[idx]);
  });

  const headerRgb = hexToRgb(company.idCardHeaderColor, [15, 23, 42]);
  const accentRgb = hexToRgb(company.idCardAccentColor, [194, 65, 12]);
  const textRgb = hexToRgb(company.idCardTextColor, [15, 23, 42]);
  const bgRgb = hexToRgb(company.idCardBgColor, [255, 255, 255]);

  const margin = paperSpec.marginMm;
  const contentW = paperSpec.contentWidthMm;
  const headerBandH = 9.5;
  const gapX = layoutSpec.columns > 1 ? 5 : 0;
  const gapY = layoutSpec.rows > 2 ? 4.5 : 6;
  const availH = paperSpec.contentHeightMm - headerBandH - 5;
  const cardW = (contentW - gapX * (layoutSpec.columns - 1)) / layoutSpec.columns;
  const cardH = (availH - gapY * (layoutSpec.rows - 1)) / layoutSpec.rows;

  pages.forEach((page, pageIdx) => {
    if (pageIdx > 0) {
      doc.addPage(paperSize === 'letter' ? 'letter' : 'a4', 'portrait');
    }

    // Sheet Header Strip
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${company.companyName} — WORKER PROFILE & ATTENDANCE CARDS`,
      margin,
      margin + 4
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Period: ${monthLabel} · Format: ${layoutSpec.shortLabel} (${paperSpec.shortLabel}) · Batch: ${cards.length} Workers`,
      margin,
      margin + 7.6
    );
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Page ${page.pageNumber} of ${page.totalPages}`,
      margin + contentW,
      margin + 4,
      { align: 'right' }
    );
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.line(margin, margin + headerBandH - 0.8, margin + contentW, margin + headerBandH - 0.8);

    page.cards.forEach((model, slotIdx) => {
      const col = slotIdx % layoutSpec.columns;
      const row = Math.floor(slotIdx / layoutSpec.columns);
      const x = margin + col * (cardW + gapX);
      const y = margin + headerBandH + 1 + row * (cardH + gapY);

      const { employee: emp, attendanceCard: att, payrollSummary: pay } = model;
      const qrImg = qrByEmpId.get(emp.id);

      // Card container background
      doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
      doc.setDrawColor(showCutMarks ? 148 : 203, showCutMarks ? 163 : 213, showCutMarks ? 184 : 225);
      doc.setLineWidth(0.3);
      if (showCutMarks && typeof doc.setLineDashPattern === 'function') {
        doc.setLineDashPattern([1.5, 1.5], 0);
      }
      doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
      if (typeof doc.setLineDashPattern === 'function') {
        doc.setLineDashPattern([], 0);
      }

      // Header Banner
      const hdrH = layout === 'id_grid_6up' ? 8.5 : 10.5;
      doc.setFillColor(headerRgb[0], headerRgb[1], headerRgb[2]);
      doc.rect(x, y, cardW, hdrH, 'F');
      doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.rect(x, y + hdrH, cardW, 1.2, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(layout === 'id_grid_6up' ? 7 : 8.2);
      doc.setTextColor(255, 255, 255);
      doc.text(company.companyName.toUpperCase().slice(0, layout === 'profile_attendance_2up' ? 42 : 24), x + 3, y + (hdrH * 0.56));
      doc.setFontSize(layout === 'id_grid_6up' ? 6.4 : 7.2);
      doc.setTextColor(253, 186, 116);
      doc.text(`${emp.empCode} · ${emp.role.toUpperCase()}`, x + cardW - 3, y + (hdrH * 0.56), {
        align: 'right',
      });
      if (layout === 'profile_attendance_2up') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        doc.setTextColor(226, 232, 240);
        doc.text(
          `${company.tagline || 'Tile Laying & Stone Finishing'} · ${att.monthLabel}`,
          x + 3,
          y + hdrH - 1.6
        );
      }

      const bodyY = y + hdrH + 3.2;

      if (layout === 'profile_attendance_2up') {
        // 2-Up Rich Landscape Profile + Monthly Attendance Strip
        const photoW = 22;
        const photoH = 27;
        doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
        doc.setLineWidth(0.35);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x + 3, bodyY, photoW, photoH, 1.2, 1.2, 'FD');

        if (emp.photoDataUrl && emp.photoDataUrl.startsWith('data:image/')) {
          try {
            const fmt = emp.photoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
            doc.addImage(emp.photoDataUrl, fmt, x + 3.4, bodyY + 0.4, photoW - 0.8, photoH - 0.8);
          } catch {
            // Fallback to initials below
          }
        } else {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(100, 116, 139);
          doc.text(model.initials, x + 3 + photoW / 2, bodyY + photoH / 2 + 1.5, { align: 'center' });
        }

        const infoX = x + photoW + 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
        doc.text(emp.fullName.slice(0, 32), infoX, bodyY + 4.2);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(71, 85, 105);
        doc.text(`Site: ${model.siteLabel.slice(0, 48)}`, infoX, bodyY + 9.2);
        doc.text(
          `Mob: ${emp.phone || '-'}   |   Blood Grp: ${emp.bloodGroup || 'N/A'}   |   Joined: ${emp.joiningDate || '-'}`,
          infoX,
          bodyY + 13.8
        );
        doc.text(
          `Aadhaar: ${emp.aadharRef || 'Not recorded'}   |   PF: ${emp.pfNumber || 'Pending'}   |   ESI: ${emp.esiNumber || 'Pending'}`,
          infoX,
          bodyY + 18.2
        );
        doc.text(
          `Emergency: ${emp.emergencyContact || 'Not recorded'}   |   Status: ${emp.status.toUpperCase()}`,
          infoX,
          bodyY + 22.6
        );

        // QR Code right side
        const qrSize = 23;
        const qrX = x + cardW - qrSize - 4;
        if (qrImg) {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(203, 213, 225);
          doc.roundedRect(qrX - 1, bodyY - 0.5, qrSize + 2, qrSize + 4.5, 1, 1, 'FD');
          doc.addImage(qrImg, 'PNG', qrX, bodyY + 0.3, qrSize, qrSize);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(4.6);
          doc.setTextColor(51, 65, 85);
          doc.text('SCAN QR PASS', qrX + qrSize / 2, bodyY + qrSize + 3.2, { align: 'center' });
        }

        // Monthly Attendance KPI Strip
        const kpiY = bodyY + 30.5;
        const kpiBoxH = 11.5;
        const kpiCols = showWageSummary ? 6 : 4;
        const kpiW = (cardW - 6 - (kpiCols - 1) * 2) / kpiCols;
        const kpis = [
          { lbl: 'Present (P)', val: String(att.presentDays), fg: [4, 120, 87] as [number, number, number] },
          { lbl: 'Half-Day', val: String(att.halfDays), fg: [180, 83, 9] as [number, number, number] },
          { lbl: 'Absent (A)', val: String(att.absentDays), fg: [185, 28, 28] as [number, number, number] },
          { lbl: 'Paid / OT', val: `${att.effectiveDays}d · ${att.overtimeHours}h`, fg: [15, 23, 42] as [number, number, number] },
        ];
        if (showWageSummary) {
          kpis.push({
            lbl: 'Month Wages',
            val: `Rs.${Math.round(att.totalWagesEarned).toLocaleString('en-IN')}`,
            fg: [15, 23, 42],
          });
          kpis.push({
            lbl: 'Net Payable',
            val: `Rs.${Math.round(pay.netPayable).toLocaleString('en-IN')}`,
            fg: [4, 120, 87],
          });
        }
        kpis.forEach((k, kIdx) => {
          const kx = x + 3 + kIdx * (kpiW + 2);
          doc.setFillColor(248, 250, 252);
          doc.setDrawColor(226, 232, 240);
          doc.roundedRect(kx, kpiY, kpiW, kpiBoxH, 1, 1, 'FD');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5.5);
          doc.setTextColor(100, 116, 139);
          doc.text(k.lbl, kx + kpiW / 2, kpiY + 3.8, { align: 'center' });
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.8);
          doc.setTextColor(k.fg[0], k.fg[1], k.fg[2]);
          doc.text(k.val, kx + kpiW / 2, kpiY + 9, { align: 'center' });
        });

        // 31-day Compact Muster Strip
        const gridY = kpiY + kpiBoxH + 3.5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.2);
        doc.setTextColor(71, 85, 105);
        doc.text(`Daily Muster (${att.monthLabel}):`, x + 3, gridY + 2.5);

        const cellAreaY = gridY + 4;
        const colsPerRow = 16;
        const cellGap = 0.8;
        const cellW = (cardW - 6 - (colsPerRow - 1) * cellGap) / colsPerRow;
        const cellH = 7.2;

        att.days.forEach((dCell, dIdx) => {
          const r = Math.floor(dIdx / colsPerRow);
          const c = dIdx % colsPerRow;
          const cx = x + 3 + c * (cellW + cellGap);
          const cy = cellAreaY + r * (cellH + 1);
          const code =
            dCell.status === 'present'
              ? 'P'
              : dCell.status === 'half_day'
                ? 'H'
                : dCell.status === 'absent'
                  ? 'A'
                  : '·';

          if (dCell.status === 'present') doc.setFillColor(236, 253, 245);
          else if (dCell.status === 'half_day') doc.setFillColor(255, 251, 235);
          else if (dCell.status === 'absent') doc.setFillColor(254, 242, 242);
          else doc.setFillColor(255, 255, 255);

          doc.setDrawColor(203, 213, 225);
          doc.roundedRect(cx, cy, cellW, cellH, 0.5, 0.5, 'FD');

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(4.6);
          doc.setTextColor(100, 116, 139);
          doc.text(String(dCell.day), cx + cellW / 2, cy + 2.4, { align: 'center' });

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6);
          if (dCell.status === 'present') doc.setTextColor(4, 120, 87);
          else if (dCell.status === 'half_day') doc.setTextColor(180, 83, 9);
          else if (dCell.status === 'absent') doc.setTextColor(185, 28, 28);
          else doc.setTextColor(148, 163, 184);
          doc.text(code, cx + cellW / 2, cy + 5.9, { align: 'center' });
        });

        // Signatures Strip
        const sigY = y + cardH - 5.5;
        doc.setDrawColor(148, 163, 184);
        doc.line(x + 4, sigY, x + 52, sigY);
        doc.line(x + cardW - 56, sigY, x + cardW - 4, sigY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.8);
        doc.setTextColor(71, 85, 105);
        doc.text('Worker Signature / Thumb', x + 4, sigY + 3.2);
        doc.text('Site Supervisor Verification', x + cardW - 4, sigY + 3.2, { align: 'right' });
      } else {
        // 4-Up Portrait ID Card OR 6-Up Wallet Card
        const is6Up = layout === 'id_grid_6up';
        const photoW = is6Up ? 16 : 20;
        const photoH = is6Up ? 20 : 24;
        doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x + 3, bodyY, photoW, photoH, 1.2, 1.2, 'FD');

        if (emp.photoDataUrl && emp.photoDataUrl.startsWith('data:image/')) {
          try {
            const fmt = emp.photoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
            doc.addImage(emp.photoDataUrl, fmt, x + 3.3, bodyY + 0.3, photoW - 0.6, photoH - 0.6);
          } catch {
            // Fallback below
          }
        } else {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(is6Up ? 9 : 11);
          doc.setTextColor(100, 116, 139);
          doc.text(model.initials, x + 3 + photoW / 2, bodyY + photoH / 2 + 1.5, {
            align: 'center',
          });
        }

        const qrSize = is6Up ? 19 : 23;
        const qrX = x + cardW - qrSize - 3;
        if (qrImg) {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(203, 213, 225);
          doc.roundedRect(qrX - 0.8, bodyY - 0.3, qrSize + 1.6, qrSize + 1.6, 0.8, 0.8, 'FD');
          doc.addImage(qrImg, 'PNG', qrX, bodyY + 0.5, qrSize, qrSize);
        }

        const midX = x + photoW + 5;
        const midMaxW = qrX - midX - 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(is6Up ? 8.2 : 9.4);
        doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
        const nameLines = doc.splitTextToSize(emp.fullName, midMaxW) as string[];
        doc.text(nameLines[0] || emp.fullName, midX, bodyY + 3.6);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(is6Up ? 6.4 : 7.1);
        doc.setTextColor(71, 85, 105);
        doc.text(`Mob: ${emp.phone || '-'}`, midX, bodyY + 8.2);
        doc.text(`Blood: ${emp.bloodGroup || 'N/A'}`, midX, bodyY + 12);
        const siteLines = doc.splitTextToSize(model.siteLabel, midMaxW) as string[];
        doc.text(siteLines[0] || '', midX, bodyY + 15.8);
        if (!is6Up && siteLines[1]) {
          doc.text(siteLines[1], midX, bodyY + 19.3);
        }

        // Attendance Summary Bar
        const statsY = bodyY + Math.max(photoH, qrSize) + (is6Up ? 4 : 6);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x + 3, statsY, cardW - 6, is6Up ? 12 : 16, 1, 1, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(is6Up ? 6.2 : 7);
        doc.setTextColor(15, 23, 42);
        doc.text(
          `${att.monthLabel} — P: ${att.presentDays}  |  HD: ${att.halfDays}  |  A: ${att.absentDays}  |  OT: ${att.overtimeHours}h`,
          x + cardW / 2,
          statsY + (is6Up ? 4.8 : 6),
          { align: 'center' }
        );
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(is6Up ? 5.8 : 6.6);
        doc.setTextColor(71, 85, 105);
        const line2 = showWageSummary
          ? `Eff: ${att.effectiveDays}d · Wages: Rs.${Math.round(att.totalWagesEarned).toLocaleString('en-IN')} · Net Bal: Rs.${Math.round(pay.netPayable).toLocaleString('en-IN')}`
          : `Joined: ${emp.joiningDate} · Emergency: ${emp.emergencyContact || 'N/A'}`;
        doc.text(line2, x + cardW / 2, statsY + (is6Up ? 9.6 : 12), { align: 'center' });

        if (!is6Up) {
          // Statutory + Mini Signature for 4-Up
          const statY = statsY + 21;
          doc.setFontSize(6.5);
          doc.setTextColor(71, 85, 105);
          doc.text(
            `Aadhaar: ${emp.aadharRef || '-'}  |  PF: ${emp.pfNumber || 'Pending'}  |  ESI: ${emp.esiNumber || 'Pending'}`,
            x + 3.5,
            statY
          );
          const sigY = y + cardH - 11;
          doc.setDrawColor(148, 163, 184);
          doc.line(x + 3.5, sigY, x + 36, sigY);
          doc.line(x + cardW - 38, sigY, x + cardW - 3.5, sigY);
          doc.setFontSize(5.5);
          doc.text('Worker Sign', x + 3.5, sigY + 3);
          doc.text('Supervisor Sign', x + cardW - 3.5, sigY + 3, { align: 'right' });
        }

        // Card Footer Band
        const ftrH = 5.5;
        doc.setFillColor(headerRgb[0], headerRgb[1], headerRgb[2]);
        doc.rect(x, y + cardH - ftrH, cardW, ftrH, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.4);
        doc.setTextColor(255, 255, 255);
        doc.text(`STATUS: ${emp.status.toUpperCase()}`, x + 3, y + cardH - 1.8);
        doc.setFont('helvetica', 'normal');
        doc.text(`HR: ${(company.hrContact || '').slice(0, 18)}`, x + cardW - 3, y + cardH - 1.8, {
          align: 'right',
        });
      }
    });
  });

  const safeCo = (company.companyName || 'AVY_INFRA').replace(/[^a-zA-Z0-9]+/g, '_');
  const fileName = `${safeCo}_Bulk_Worker_Cards_${cards.length}Staff_${paperSize.toUpperCase()}.pdf`;
  return { blob: doc.output('blob'), fileName };
}

export function buildEmployeePayrollExpensePdfBlob(params: {
  companyName: string;
  periodLabel: string;
  scopeLabel: string;
  rows: Array<{
    empCode: string;
    fullName: string;
    role: string;
    siteLabel: string;
    effectiveDays: number;
    overtimeHours: number;
    totalEarned: number;
    dailyFoodAdvance: number;
    weeklyFoodAdvance: number;
    cashAndCustomAdvance: number;
    totalAdvances: number;
    advanceCount: number;
    totalSettled: number;
    totalDisbursed: number;
    totalEmployeeExpenses: number;
    netPayable: number;
  }>;
  totals: {
    workerCount: number;
    totalDaysWorked: number;
    totalOvertimeHours: number;
    totalWagesEarned: number;
    totalFoodAdvance: number;
    totalCashAndCustom: number;
    totalAdvances: number;
    totalAdvanceEntries: number;
    totalSettled: number;
    totalDisbursed: number;
    totalEmployeeExpenses: number;
    totalNetPayable: number;
  };
}): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const margin = 12;
  const contentW = pageW - margin * 2;
  const fmtRs = (v: number) => {
    const sign = v < 0 ? '-' : '';
    return `${sign}Rs.${Math.abs(Math.round(v)).toLocaleString('en-IN')}`;
  };

  let y = 12;

  const drawHeader = (pageNum: number) => {
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, 10, contentW, 18, 'F');
    doc.setFillColor(194, 65, 12);
    doc.rect(margin, 28, contentW, 1.2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text(
      `${params.companyName.toUpperCase()} — EMPLOYEE-WISE PAYROLL, ADVANCES & TOTAL EXPENSES`,
      margin + 4,
      17.5
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(226, 232, 240);
    doc.text(`Period: ${params.periodLabel}   |   Scope: ${params.scopeLabel}`, margin + 4, 24);
    doc.text(
      `Generated: ${new Date().toLocaleDateString('en-IN')}   |   Page ${pageNum}`,
      pageW - margin - 4,
      24,
      { align: 'right' }
    );
  };

  let pageNum = 1;
  drawHeader(pageNum);
  y = 33;

  // KPI Strip (6 boxes across 273mm)
  const kpis = [
    { label: 'Wages + OT Earned', value: fmtRs(params.totals.totalWagesEarned) },
    { label: 'Food Adv (D + W)', value: fmtRs(params.totals.totalFoodAdvance) },
    { label: 'Cash & Custom Adv', value: fmtRs(params.totals.totalCashAndCustom) },
    { label: `Total Advances (${params.totals.totalAdvanceEntries})`, value: fmtRs(params.totals.totalAdvances) },
    { label: 'Total Worker Expenses', value: fmtRs(params.totals.totalEmployeeExpenses) },
    { label: 'Net Payable Balance', value: fmtRs(params.totals.totalNetPayable) },
  ];
  const gap = 3;
  const boxW = (contentW - gap * 5) / 6;
  kpis.forEach((kpi, idx) => {
    const bx = margin + idx * (boxW + gap);
    doc.setFillColor(idx === 4 ? 255 : 248, idx === 4 ? 247 : 250, idx === 4 ? 237 : 252);
    doc.setDrawColor(idx === 4 ? 251 : 203, idx === 4 ? 146 : 213, idx === 4 ? 60 : 225);
    doc.roundedRect(bx, y, boxW, 13, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(71, 85, 105);
    doc.text(kpi.label, bx + 2.5, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, bx + 2.5, y + 10.2);
  });

  y += 17;

  const drawTableHead = (startY: number) => {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, startY, contentW, 7.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(51, 65, 85);

    doc.text('Employee', margin + 2, startY + 5);
    doc.text('Site / Role', margin + 56, startY + 5);
    doc.text('Days/OT', margin + 106, startY + 5, { align: 'right' });
    doc.text('Wages+OT', margin + 128, startY + 5, { align: 'right' });
    doc.text('Daily Food', margin + 149, startY + 5, { align: 'right' });
    doc.text('Wk Food', margin + 169, startY + 5, { align: 'right' });
    doc.text('Cash/Cust', margin + 190, startY + 5, { align: 'right' });
    doc.text('Total Adv', margin + 212, startY + 5, { align: 'right' });
    doc.text('Settled', margin + 231, startY + 5, { align: 'right' });
    doc.text('Total Exp', margin + 253, startY + 5, { align: 'right' });
    doc.text('Net Payable', pageW - margin - 2, startY + 5, { align: 'right' });
    return startY + 7.5;
  };

  y = drawTableHead(y);

  params.rows.forEach((row, idx) => {
    if (y > 186) {
      doc.addPage();
      pageNum += 1;
      drawHeader(pageNum);
      y = drawTableHead(33);
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentW, 7.5, 'F');
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(15, 23, 42);
    doc.text(`${row.empCode} · ${row.fullName}`.slice(0, 30), margin + 2, y + 4.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(71, 85, 105);
    doc.text(`${row.role} · ${row.siteLabel}`.slice(0, 28), margin + 56, y + 4.8);

    doc.setTextColor(15, 23, 42);
    doc.text(
      `${row.effectiveDays}d${row.overtimeHours > 0 ? `+${row.overtimeHours}h` : ''}`,
      margin + 106,
      y + 4.8,
      { align: 'right' }
    );
    doc.text(fmtRs(row.totalEarned), margin + 128, y + 4.8, { align: 'right' });
    doc.text(fmtRs(row.dailyFoodAdvance), margin + 149, y + 4.8, { align: 'right' });
    doc.text(fmtRs(row.weeklyFoodAdvance), margin + 169, y + 4.8, { align: 'right' });
    doc.text(fmtRs(row.cashAndCustomAdvance), margin + 190, y + 4.8, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text(`${fmtRs(row.totalAdvances)} (${row.advanceCount})`, margin + 212, y + 4.8, {
      align: 'right',
    });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(fmtRs(row.totalSettled), margin + 231, y + 4.8, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(194, 65, 12);
    doc.text(fmtRs(row.totalEmployeeExpenses), margin + 253, y + 4.8, { align: 'right' });

    doc.setTextColor(15, 23, 42);
    doc.text(fmtRs(row.netPayable), pageW - margin - 2, y + 4.8, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 7.5, pageW - margin, y + 7.5);
    y += 7.5;
  });

  // Grand Totals Row
  if (y > 186) {
    doc.addPage();
    pageNum += 1;
    drawHeader(pageNum);
    y = 33;
  }
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, y, contentW, 8.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.3);
  doc.setTextColor(255, 255, 255);
  doc.text(`TOTAL (${params.totals.workerCount} WORKERS)`, margin + 2, y + 5.5);
  doc.text(`${params.totals.totalDaysWorked}d`, margin + 106, y + 5.5, { align: 'right' });
  doc.text(fmtRs(params.totals.totalWagesEarned), margin + 128, y + 5.5, { align: 'right' });
  doc.text(fmtRs(params.totals.totalFoodAdvance), margin + 169, y + 5.5, { align: 'right' });
  doc.text(fmtRs(params.totals.totalCashAndCustom), margin + 190, y + 5.5, { align: 'right' });
  doc.text(fmtRs(params.totals.totalAdvances), margin + 212, y + 5.5, { align: 'right' });
  doc.text(fmtRs(params.totals.totalSettled), margin + 231, y + 5.5, { align: 'right' });
  doc.text(fmtRs(params.totals.totalEmployeeExpenses), margin + 253, y + 5.5, { align: 'right' });
  doc.text(fmtRs(params.totals.totalNetPayable), pageW - margin - 2, y + 5.5, { align: 'right' });

  const safeCo = params.companyName.replace(/[^a-zA-Z0-9]+/g, '_');
  const fileName = `${safeCo}_Employee_Payroll_Advances_Expenses.pdf`;
  return { blob: doc.output('blob'), fileName };
}



