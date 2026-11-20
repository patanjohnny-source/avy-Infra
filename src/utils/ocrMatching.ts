import type { AdvanceType, Employee, PaymentMode } from '../types/avy';

export interface OcrEmployeeMatchResult {
  employee: Employee | null;
  matchReason: 'emp_code' | 'code_suffix' | 'exact_name' | 'partial_name' | 'none';
  score: number;
}

function normalizeCode(val: string): string {
  return (val || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeName(val: string): string {
  return (val || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Matches an OCR-extracted worker name and employee ID code against the workforce list.
 */
export function matchOcrEmployeeRow(
  rawName: string,
  rawEmpCode: string,
  employees: Employee[]
): OcrEmployeeMatchResult {
  const cleanCode = normalizeCode(rawEmpCode);
  const cleanName = normalizeName(rawName);

  // 1. Exact empCode match (ignoring hyphens/spaces)
  if (cleanCode.length >= 2) {
    for (const emp of employees) {
      if (normalizeCode(emp.empCode) === cleanCode) {
        return { employee: emp, matchReason: 'emp_code', score: 100 };
      }
    }
  }

  // 2. Numeric/suffix match (e.g. "001", "MSN001", "12")
  const digitsMatch = (rawEmpCode || '').match(/(\d{1,5})$/);
  const targetDigits = digitsMatch ? digitsMatch[1].padStart(3, '0') : '';
  if (targetDigits) {
    const suffixMatches = employees.filter((emp) => {
      const m = emp.empCode.match(/(\d+)$/);
      return m && m[1].padStart(3, '0') === targetDigits;
    });
    if (suffixMatches.length === 1) {
      return { employee: suffixMatches[0], matchReason: 'code_suffix', score: 90 };
    }
    if (suffixMatches.length > 1 && cleanName) {
      const refined = suffixMatches.find((e) => normalizeName(e.fullName).includes(cleanName));
      if (refined) {
        return { employee: refined, matchReason: 'code_suffix', score: 92 };
      }
    }
  }

  // 3. Exact normalized name match
  if (cleanName) {
    const exact = employees.find((emp) => normalizeName(emp.fullName) === cleanName);
    if (exact) {
      return { employee: exact, matchReason: 'exact_name', score: 95 };
    }

    // 4. Token overlap / substring match
    const tokens = cleanName.split(' ').filter((t) => t.length >= 2);
    let bestEmp: Employee | null = null;
    let bestScore = 0;

    for (const emp of employees) {
      const empName = normalizeName(emp.fullName);
      if (empName.includes(cleanName) || cleanName.includes(empName)) {
        const s = 80;
        if (s > bestScore) {
          bestScore = s;
          bestEmp = emp;
        }
        continue;
      }
      if (tokens.length > 0) {
        const empTokens = empName.split(' ');
        const hits = tokens.filter((tok) =>
          empTokens.some((et) => et === tok || (tok.length >= 3 && et.startsWith(tok)))
        ).length;
        if (hits > 0) {
          const score = Math.round((hits / Math.max(tokens.length, empTokens.length)) * 75);
          if (score > bestScore && score >= 35) {
            bestScore = score;
            bestEmp = emp;
          }
        }
      }
    }

    if (bestEmp) {
      return { employee: bestEmp, matchReason: 'partial_name', score: bestScore };
    }
  }

  return { employee: null, matchReason: 'none', score: 0 };
}

/**
 * Resolves OCR advance category text into built-in AdvanceType or customCategory.
 */
export function normalizeOcrAdvanceCategory(
  categoryText: string,
  companyCustomCategories: string[] = []
): { advanceType: AdvanceType; customCategory: string } {
  const clean = (categoryText || '').trim();
  const lower = clean.toLowerCase();

  if (!lower) {
    return { advanceType: 'cash_advance', customCategory: '' };
  }

  const matchedCustom = companyCustomCategories.find(
    (c) => c.trim().toLowerCase() === lower
  );
  if (matchedCustom) {
    return { advanceType: 'custom', customCategory: matchedCustom };
  }

  if (lower.includes('weekly') || lower.includes('sunday') || lower.includes('mess')) {
    return { advanceType: 'weekly_food', customCategory: '' };
  }
  if (lower.includes('daily') && (lower.includes('food') || lower.includes('khana') || lower.includes('tiffin'))) {
    return { advanceType: 'daily_food', customCategory: '' };
  }
  if (lower === 'food' || lower.includes('food') || lower.includes('lunch') || lower.includes('dinner')) {
    return { advanceType: 'daily_food', customCategory: '' };
  }
  if (
    lower === 'cash' ||
    lower === 'advance' ||
    lower === 'cash advance' ||
    lower === 'work advance' ||
    lower.includes('kharchi')
  ) {
    return { advanceType: 'cash_advance', customCategory: '' };
  }

  // Anything specific (Gas, Medical, Travel, Room Rent, Tool Advance, etc.) -> custom category
  return {
    advanceType: 'custom',
    customCategory: clean.slice(0, 60),
  };
}

/**
 * Resolves OCR payment mode text into PaymentMode + optional paymentApp label.
 */
export function normalizeOcrPaymentMode(paymentModeText: string): {
  paymentMode: PaymentMode;
  paymentApp: string;
} {
  const lower = (paymentModeText || '').trim().toLowerCase();
  if (lower.includes('gpay') || lower.includes('google pay')) {
    return { paymentMode: 'upi', paymentApp: 'GPay' };
  }
  if (lower.includes('phonepe') || lower.includes('phone pe')) {
    return { paymentMode: 'upi', paymentApp: 'PhonePe' };
  }
  if (lower.includes('paytm')) {
    return { paymentMode: 'upi', paymentApp: 'Paytm' };
  }
  if (lower.includes('upi') || lower.includes('bhim') || lower.includes('cred')) {
    return { paymentMode: 'upi', paymentApp: 'UPI' };
  }
  if (
    lower.includes('bank') ||
    lower.includes('neft') ||
    lower.includes('imps') ||
    lower.includes('rtgs') ||
    lower.includes('account')
  ) {
    return { paymentMode: 'bank_transfer', paymentApp: 'Bank Transfer' };
  }
  return { paymentMode: 'cash', paymentApp: '' };
}

export function sanitizeIsoDateInput(dateStr: string | undefined, fallbackDate: string): string {
  const clean = (dateStr || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const ddmmyyyy = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0');
    const month = ddmmyyyy[2].padStart(2, '0');
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  return fallbackDate;
}
