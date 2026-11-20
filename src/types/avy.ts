export type EmployeeRole =
  | 'Mason'
  | 'Helper'
  | 'Material Shifting'
  | 'Supervisor'
  | 'Engineer';

export type ZoneStatus =
  | 'not_started'
  | 'prechecking'
  | 'in_progress'
  | 'completed'
  | 'cleaning_in_progress'
  | 'cleaning_done'
  | 'qc_approved';

export type DefaultTileZoneKey =
  | 'master_bedroom_flooring'
  | 'hall_flooring'
  | 'hall_skirting'
  | 'children_bedroom_flooring'
  | 'guest_bedroom_flooring'
  | 'main_flooring_hall'
  | 'balcony_flooring'
  | 'utility_flooring'
  | 'dado'
  | 'balcony_skirting'
  | 'main_flooring_skirting'
  | 'corridor'
  | 'lobby_area';

export type TileZoneKey = DefaultTileZoneKey | string;

export type TileZoneCategory = 'Flooring' | 'Skirting' | 'Wall / Wet' | 'Common';

export interface TileZoneDefinition {
  key: TileZoneKey;
  label: string;
  category: TileZoneCategory;
  defaultSqft: number;
  isDefault?: boolean;
}

export interface TileZoneState {
  status: ZoneStatus;
  sqft: number;
  label?: string;
  category?: TileZoneCategory;
  assignedEmployeeId?: string;
  assignedEmpCode?: string;
  assignedEmployeeName?: string;
  updatedDate?: string;
  notes?: string;
}

export interface CompanyProfile {
  id: string;
  ownerId: string;
  companyName: string;
  tagline: string;
  address: string;
  hrContact: string;
  hrEmail: string;
  gstNumber: string;
  pfEstCode: string;
  esiCode: string;
  signatoryName: string;
  logoDataUrl?: string;
  requireFinishBeforeNewWork?: boolean;
  adminUsername?: string;
  adminPassword?: string;
  adminEditPin?: string;
  supervisorCanEditAttendance?: boolean;
  customAdvanceCategories?: string[];
  customExpenseCategories?: string[];
  weeklyExpenseBudget?: number;
  idCardFrontBgDataUrl?: string;
  idCardBackBgDataUrl?: string;
  idCardBgColor?: string;
  idCardHeaderColor?: string;
  idCardAccentColor?: string;
  idCardTextColor?: string;
  idCardBgOpacity?: number;
  tileZoneCatalog: TileZoneDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  location: string;
  clientName: string;
  status: 'active' | 'completed' | 'on_hold';
  startDate?: string;
  finishDate?: string;
  managerName?: string;
  managerPhone?: string;
  engineerName?: string;
  engineerPhone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tower {
  id: string;
  ownerId: string;
  projectId: string;
  name: string;
  totalFloors: number;
  unitsPerFloor: number;
  startDate?: string;
  finishDate?: string;
  inchargeName?: string;
  inchargePhone?: string;
  supervisorName?: string;
  supervisorPhone?: string;
  engineerName?: string;
  engineerPhone?: string;
  managerName?: string;
  managerPhone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FlatUnit {
  id: string;
  ownerId: string;
  projectId: string;
  towerId: string;
  floorNumber: number;
  floorLabel?: string;
  unitNumber: string;
  unitType: string;
  zones: Record<string, TileZoneState>;
  createdAt: string;
  updatedAt: string;
}

export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'O+' | 'O-' | 'AB+' | 'AB-' | '';

export interface Employee {
  id: string;
  ownerId: string;
  empCode: string;
  fullName: string;
  role: EmployeeRole;
  phone: string;
  alternatePhone?: string;
  email?: string;
  joiningDate: string;
  dailyRate: number;
  overtimeRate: number;
  foodAllowanceDaily: number;
  aadharRef: string;
  pfNumber?: string;
  esiNumber?: string;
  bloodGroup?: string;
  emergencyContact: string;
  photoDataUrl?: string;
  currentProjectId?: string;
  currentProjectName?: string;
  currentTowerId?: string;
  currentTowerName?: string;
  assignedTowerIds?: string[];
  loginPin?: string;
  qrToken?: string;
  status: 'active' | 'inactive';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface QrActiveAssignmentSummary {
  unitNumber: string;
  projectName: string;
  towerName: string;
  zoneLabel: string;
  status: AssignmentStatus;
  assignedDate: string;
  targetSqft: number;
}

export interface QrDeploymentSummary {
  projectName: string;
  towerName: string;
  assignedDate: string;
  notes: string;
}

export interface QrPassRecord {
  id: string;
  ownerId: string;
  employeeId: string;
  empCode: string;
  fullName: string;
  role: EmployeeRole;
  status: 'active' | 'inactive';
  companyName: string;
  joiningDate: string;
  currentProjectName: string;
  currentTowerName: string;
  deployedSince: string;
  todayAttendanceStatus: AttendanceStatus | 'unmarked';
  todayAttendanceDate: string;
  completedZonesCount: number;
  activeAssignments: QrActiveAssignmentSummary[];
  recentDeployments: QrDeploymentSummary[];
  createdAt?: string;
  updatedAt: string;
}

export interface QrScannedProfile {
  employeeId: string;
  empCode: string;
  fullName: string;
  role: EmployeeRole;
  status: 'active' | 'inactive';
  companyName: string;
  joiningDate: string;
  photoDataUrl?: string;
  currentProjectName: string;
  currentTowerName: string;
  deployedSince: string;
  todayAttendanceStatus: AttendanceStatus | 'unmarked';
  todayAttendanceDate: string;
  completedZonesCount: number;
  activeAssignments: QrActiveAssignmentSummary[];
  recentDeployments: QrDeploymentSummary[];
  updatedAt: string;
}

export interface EmployeeDocument {
  id: string;
  ownerId: string;
  employeeId: string;
  docCategory: 'aadhar_pdf' | 'other';
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRecord {
  id: string;
  ownerId: string;
  employeeId: string;
  empCode: string;
  employeeName: string;
  employeeRole: EmployeeRole;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  fromProjectName?: string;
  fromTowerName?: string;
  assignedDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type AssignmentStatus =
  | 'assigned'
  | 'prechecking'
  | 'in_progress'
  | 'completed'
  | 'cleaning_in_progress'
  | 'cleaning_done'
  | 'qc_approved';

export interface WorkAssignment {
  id: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  flatId: string;
  unitNumber: string;
  zoneKey: TileZoneKey;
  zoneLabel: string;
  employeeId: string;
  empCode: string;
  employeeName: string;
  employeeRole: EmployeeRole;
  assignedDate: string;
  completedDate: string;
  targetSqft: number;
  status: AssignmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type AttendanceStatus = 'present' | 'half_day' | 'absent';

export interface AttendanceRecord {
  id: string;
  ownerId: string;
  date: string;
  employeeId: string;
  empCode: string;
  employeeName: string;
  employeeRole: EmployeeRole;
  projectId: string;
  projectName: string;
  towerId?: string;
  towerName?: string;
  status: AttendanceStatus;
  overtimeHours: number;
  dailyWageEarned: number;
  overtimePayEarned: number;
  notes: string;
  markedByRole?: 'admin' | 'supervisor';
  markedByName?: string;
  editedByName?: string;
  editedAt?: string;
  editReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type AdvanceType = 'daily_food' | 'weekly_food' | 'cash_advance' | 'custom';
export type PaymentMode = 'cash' | 'upi' | 'bank_transfer';

export interface PaymentProofFields {
  paymentApp?: string;
  transactionId?: string;
  upiId?: string;
  proofImageDataUrl?: string;
}

export interface AdvanceEntry extends PaymentProofFields {
  id: string;
  ownerId: string;
  date: string;
  employeeId: string;
  empCode: string;
  employeeName: string;
  employeePhone: string;
  projectId?: string;
  projectName?: string;
  towerId?: string;
  towerName?: string;
  isSundayRun?: boolean;
  advanceType: AdvanceType;
  customCategory?: string;
  amount: number;
  paymentMode: PaymentMode;
  notes: string;
  whatsappShared: boolean;
  acknowledged?: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  followUpSentAt?: string;
  followUpCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type ExpenseCategory =
  | 'food_mess'
  | 'daily_expense'
  | 'special_expense'
  | 'gas_payment'
  | 'medical'
  | 'travel_advance'
  | 'material'
  | 'adhesive_grout'
  | 'shifting_transport'
  | 'tools_equipment'
  | 'contractor_misc'
  | 'custom';

export interface SiteExpense extends PaymentProofFields {
  id: string;
  ownerId: string;
  date: string;
  projectId: string;
  projectName: string;
  towerId?: string;
  towerName?: string;
  category: ExpenseCategory;
  customCategory?: string;
  description: string;
  vendorName?: string;
  amount: number;
  paymentMode: PaymentMode;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementEntry extends PaymentProofFields {
  id: string;
  ownerId: string;
  employeeId: string;
  empCode: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  daysWorked: number;
  grossWages: number;
  overtimePay: number;
  totalAdvances: number;
  netPaid: number;
  paymentMode: PaymentMode;
  settledDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OcrAdvanceSheetRow {
  rawName: string;
  rawEmpCode: string;
  amount: number;
  categoryText: string;
  paymentModeText: string;
  date: string;
  notes: string;
  confidence: string;
}

export interface OcrAdvanceSheetResult {
  sheetTitle: string;
  detectedDate: string;
  rows: OcrAdvanceSheetRow[];
}

export interface OcrPaymentReceiptResult {
  paymentApp: string;
  paymentMode: 'upi' | 'bank_transfer';
  transactionId: string;
  upiId: string;
  amount: number;
  date: string;
  recipientName: string;
  senderInfo: string;
  statusText: string;
  notes: string;
}

export interface DailySiteLog {
  id: string;
  ownerId: string;
  date: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  notes: string;
  photoDataUrl?: string;
  loggedByRole: 'admin' | 'supervisor';
  loggedByName: string;
  loggedByEmployeeId?: string;
  createdAt: string;
  updatedAt: string;
}

export type BillingDocType = 'quotation' | 'invoice' | 'tax_invoice';
export type BillingTaxMode = 'cgst_sgst' | 'igst' | 'none';
export type BillingDocStatus = 'draft' | 'issued' | 'sent' | 'paid' | 'cancelled';

export interface BillingLineItem {
  id: string;
  description: string;
  hsnSac: string;
  unit: string;
  quantity: number;
  rate: number;
  gstRate: number;
  taxableAmount: number;
  taxAmount: number;
  lineTotal: number;
}

export interface BillingDocument {
  id: string;
  ownerId: string;
  docType: BillingDocType;
  docNumber: string;
  issueDate: string;
  dueDate?: string;
  projectId?: string;
  projectName?: string;
  towerId?: string;
  towerName?: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  clientAddress?: string;
  clientGstin?: string;
  placeOfSupply?: string;
  taxMode: BillingTaxMode;
  items: BillingLineItem[];
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  status: BillingDocStatus;
  notes?: string;
  terms?: string;
  whatsappShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CompanyDocumentSource =
  | 'smart_generator'
  | 'word_letterhead'
  | 'ppt_slides'
  | 'uploaded';

export type CompanyDocumentCategory =
  | 'employment_proof'
  | 'payslip'
  | 'joining_letter'
  | 'relieving_letter'
  | 'travel_security_letter'
  | 'letterhead_doc'
  | 'presentation_deck'
  | 'uploaded_office';

export type CompanyDocumentFormat =
  | 'doc'
  | 'docx'
  | 'ppt'
  | 'pptx'
  | 'pdf'
  | 'other';

export type CompanyDocumentApprovalStatus = 'draft' | 'approved';

export interface CompanyDocument {
  id: string;
  ownerId: string;
  source: CompanyDocumentSource;
  docCategory: CompanyDocumentCategory;
  fileFormat: CompanyDocumentFormat;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  approvalStatus: CompanyDocumentApprovalStatus;
  approvedByName?: string;
  approvedAt?: string;
  employeeId?: string;
  empCode?: string;
  employeeName?: string;
  refNumber?: string;
  issueDate: string;
  recipient?: string;
  subject?: string;
  bodyHtml?: string;
  plainTextSummary?: string;
  deckJson?: string;
  dataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsappMessagePayload {
  title: string;
  recipientName: string;
  recipientPhone: string;
  recipientEmail?: string;
  emailSubject?: string;
  message: string;
  advanceId?: string;
  followUpAdvanceId?: string;
}
