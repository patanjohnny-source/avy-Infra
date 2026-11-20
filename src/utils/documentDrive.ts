import type {
  CompanyDocument,
  CompanyDocumentApprovalStatus,
  CompanyDocumentCategory,
  CompanyDocumentFormat,
} from '../types/avy';

export const MAX_DRIVE_UPLOAD_BYTES = 450 * 1024; // 450 KB ceiling for Firestore & localStorage sync

export const ACCEPTED_DRIVE_EXTENSIONS = [
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
] as const;

export const DRIVE_CATEGORY_LABELS: Record<CompanyDocumentCategory, string> = {
  employment_proof: 'Employment Proof',
  payslip: 'Salary Payslip',
  joining_letter: 'Joining Letter',
  relieving_letter: 'Relieving Letter',
  travel_security_letter: 'Travel & Security Letter',
  letterhead_doc: 'Word Letterhead',
  presentation_deck: 'PowerPoint Deck',
  uploaded_office: 'Uploaded File',
};

export const DRIVE_FORMAT_LABELS: Record<CompanyDocumentFormat, string> = {
  doc: 'WORD (.DOC)',
  docx: 'WORD (.DOCX)',
  ppt: 'PPT (.PPT)',
  pptx: 'PPT (.PPTX)',
  pdf: 'PDF',
  other: 'FILE',
};

export type DriveCategoryGroupFilter =
  | 'all'
  | 'smart_employee'
  | 'word_letterhead'
  | 'ppt_slides'
  | 'uploaded';

export function detectDocumentFormat(
  fileName: string,
  mimeType?: string
): CompanyDocumentFormat {
  const lower = (fileName || '').trim().toLowerCase();
  const mime = (mimeType || '').trim().toLowerCase();
  if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) return 'docx';
  if (lower.endsWith('.doc') || mime.includes('msword')) return 'doc';
  if (lower.endsWith('.pptx') || mime.includes('presentationml')) return 'pptx';
  if (lower.endsWith('.ppt') || mime.includes('ms-powerpoint') || mime.includes('powerpoint')) {
    return 'ppt';
  }
  if (lower.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  return 'other';
}

export function isSupportedOfficeUploadFile(fileName: string, mimeType?: string): boolean {
  const lower = (fileName || '').trim().toLowerCase();
  if (ACCEPTED_DRIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return true;
  }
  const mime = (mimeType || '').trim().toLowerCase();
  return (
    mime === 'application/pdf' ||
    mime.includes('msword') ||
    mime.includes('wordprocessingml') ||
    mime.includes('ms-powerpoint') ||
    mime.includes('presentationml') ||
    mime.startsWith('image/')
  );
}

export function stripFileExtension(fileName: string): string {
  const cleaned = (fileName || '').trim();
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0) return cleaned || 'Uploaded Document';
  return cleaned.slice(0, dot) || cleaned;
}

export function formatFileSizeBytes(bytes: number): string {
  const val = Math.max(0, Number(bytes) || 0);
  if (val < 1024) return `${val} B`;
  const kb = val / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function readCompanyUploadFile(file: File): Promise<{
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  fileFormat: CompanyDocumentFormat;
}> {
  if (!isSupportedOfficeUploadFile(file.name, file.type)) {
    return Promise.reject(
      new Error(
        `Unsupported file "${file.name}". Please upload Word (.doc/.docx), PowerPoint (.ppt/.pptx), PDF, or image files.`
      )
    );
  }
  if (file.size <= 0) {
    return Promise.reject(new Error(`File "${file.name}" appears empty.`));
  }
  if (file.size > MAX_DRIVE_UPLOAD_BYTES) {
    return Promise.reject(
      new Error(
        `File "${file.name}" is ${Math.round(file.size / 1024)} KB. Maximum allowed size for cloud Drive sync is 450 KB.`
      )
    );
  }

  const fileFormat = detectDocumentFormat(file.name, file.type);
  const fallbackMime =
    fileFormat === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : fileFormat === 'doc'
        ? 'application/msword'
        : fileFormat === 'pptx'
          ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : fileFormat === 'ppt'
            ? 'application/vnd.ms-powerpoint'
            : fileFormat === 'pdf'
              ? 'application/pdf'
              : 'application/octet-stream';

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:')) {
        reject(new Error(`Invalid file encoding for "${file.name}".`));
        return;
      }
      resolve({
        title: stripFileExtension(file.name).slice(0, 140),
        fileName: file.name.slice(0, 180),
        mimeType: (file.type || fallbackMime).slice(0, 120),
        sizeBytes: file.size,
        dataUrl,
        fileFormat,
      });
    };
    reader.readAsDataURL(file);
  });
}

export interface FilterCompanyDocumentsInput {
  categoryGroup?: DriveCategoryGroupFilter;
  statusFilter?: 'all' | CompanyDocumentApprovalStatus;
  employeeIdFilter?: string;
  searchQuery?: string;
  scopedEmployeeIds?: Set<string> | null;
}

export function filterCompanyDocuments(
  docs: CompanyDocument[],
  filters: FilterCompanyDocumentsInput
): CompanyDocument[] {
  const query = (filters.searchQuery || '').trim().toLowerCase();
  const group = filters.categoryGroup || 'all';
  const statusFilter = filters.statusFilter || 'all';
  const empFilter = filters.employeeIdFilter || 'all';

  return docs
    .filter((d) => {
      // Tower supervisor scoping: docs tied to an employee must belong to scoped employees;
      // company-wide docs (no employeeId) remain accessible.
      if (filters.scopedEmployeeIds && d.employeeId) {
        if (!filters.scopedEmployeeIds.has(d.employeeId)) return false;
      }

      if (group === 'smart_employee' && d.source !== 'smart_generator') return false;
      if (group === 'word_letterhead' && d.source !== 'word_letterhead') return false;
      if (group === 'ppt_slides' && d.source !== 'ppt_slides') return false;
      if (group === 'uploaded' && d.source !== 'uploaded') return false;

      if (statusFilter !== 'all' && d.approvalStatus !== statusFilter) return false;
      if (empFilter !== 'all' && d.employeeId !== empFilter) return false;

      if (query) {
        const haystack = [
          d.title,
          d.fileName,
          d.refNumber || '',
          d.employeeName || '',
          d.empCode || '',
          d.subject || '',
          d.recipient || '',
          DRIVE_CATEGORY_LABELS[d.docCategory] || d.docCategory,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    })
    .sort((a, b) => (b.updatedAt || b.issueDate).localeCompare(a.updatedAt || a.issueDate));
}
