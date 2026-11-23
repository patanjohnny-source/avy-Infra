import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  Briefcase,
  Building,
  CalendarCheck,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  History,
  IdCard,
  MapPin,
  MessageSquare,
  Plus,
  Printer,
  QrCode,
  ReceiptIndianRupee,
  Search,
  Trash2,
  Upload,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type { Employee, EmployeeRole, WhatsappMessagePayload } from '../types/avy';
import {
  canSupervisorUpdateEmployee,
  canViewEmployeeFixedSalary,
  getScopedAdvances,
  getScopedAssignments,
  getScopedAttendance,
  getScopedEmployees,
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isSupervisorSession,
} from '../utils/authAccess';
import {
  setBulkWorkersSelection,
  toggleBulkWorkerSelection,
} from '../utils/bulkWorkerCards';
import { compressImageToDataUrl, readDocumentAsDataUrl } from '../utils/idCardPdf';
import {
  EMPLOYEE_PRESET_SKILL_TAGS,
  filterEmployeesBySkillTags,
  getTowerDeploymentCounts,
  normalizeSkillTags,
} from '../utils/operations';
import {
  computeDefaultHourlyOtRate,
  computeEmployeePayroll,
  formatINR,
  formatPaymentSummaryWhatsappMessage,
  generateEmployeeCode,
  getAdvanceCategoryLabel,
} from '../utils/payroll';
import { BulkWorkerCardsPrintPreview } from './BulkWorkerCardsPrintPreview';
import {
  RemoveEmployeeConfirmModal,
  RemovedEmployeeBackupsModal,
  triggerJsonBackupDownload,
} from './EmployeeBackupModal';
import { EmployeeIdCardModal } from './EmployeeIdCardModal';
import { IndividualPaymentDetailsModal } from './IndividualPaymentDetailsModal';
import { WorkforceQrPrintModal } from './WorkforceQrPrintModal';
import { buildEmployeeBackupExportPayload } from '../utils/employeeBackup';

const ROLES: EmployeeRole[] = [
  'Mason',
  'Helper',
  'Material Shifting',
  'Supervisor',
  'Engineer',
];

const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

interface WorkforceViewProps {
  preselectedEmployee?: { employeeId: string; nonce: number };
  onOpenGiveAdvance: (employeeId?: string) => void;
  onOpenAssignWork: (employeeId?: string) => void;
  onOpenEmployeeAttendanceCard?: (employeeId: string) => void;
  onOpenCompanySettings: () => void;
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
  onPreviewQrProfile: (scanUrl: string) => void;
}

export function WorkforceView({
  preselectedEmployee,
  onOpenGiveAdvance,
  onOpenAssignWork,
  onOpenEmployeeAttendanceCard,
  onOpenCompanySettings,
  onTriggerWhatsapp,
  onPreviewQrProfile,
}: WorkforceViewProps) {
  const {
    session,
    companyProfile,
    projects: rawProjects,
    towers: rawTowers,
    employees: rawEmployees,
    employeeDocuments,
    removedEmployees,
    deployments: rawDeployments,
    assignments: rawAssignments,
    attendance: rawAttendance,
    advances: rawAdvances,
    settlements,
    addEmployee,
    updateEmployee,
    removeEmployeeWithBackup,
    restoreEmployeeBackup,
    deleteEmployeeBackupPermanently,
    addEmployeeDocument,
    deleteEmployeeDocument,
    deployEmployeeToSite,
    bulkAllocateEmployeesToTower,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);
  const hideSalary = !canViewEmployeeFixedSalary(session);

  const projects = useMemo(
    () => getScopedProjects(session, rawProjects, rawTowers),
    [session, rawProjects, rawTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, rawTowers), [session, rawTowers]);
  const employees = useMemo(
    () => getScopedEmployees(session, rawEmployees),
    [session, rawEmployees]
  );
  const assignments = useMemo(
    () => getScopedAssignments(session, rawAssignments),
    [session, rawAssignments]
  );
  const attendance = useMemo(
    () => getScopedAttendance(session, rawAttendance, rawEmployees),
    [session, rawAttendance, rawEmployees]
  );
  const advances = useMemo(
    () => getScopedAdvances(session, rawAdvances, rawEmployees),
    [session, rawAdvances, rawEmployees]
  );
  const deployments = useMemo(() => {
    const allowedEmpIds = new Set(employees.map((e) => e.id));
    return rawDeployments.filter((d) => allowedEmpIds.has(d.employeeId));
  }, [rawDeployments, employees]);

  const [roleFilter, setRoleFilter] = useState<'All' | EmployeeRole>('All');
  const [siteProjectFilter, setSiteProjectFilter] = useState<string>('all');
  const [siteTowerFilter, setSiteTowerFilter] = useState<string>('all');
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');

  useEffect(() => {
    if (!preselectedEmployee) return;
    if (employees.some((e) => e.id === preselectedEmployee.employeeId)) {
      setRoleFilter('All');
      setSiteProjectFilter('all');
      setSiteTowerFilter('all');
      setSkillFilter('all');
      setSearchQuery('');
      setSelectedEmpId(preselectedEmployee.employeeId);
    }
  }, [preselectedEmployee, employees]);

  // ID Card Preview, Batch QR Print & Bulk Worker Profile Cards
  const [idCardEmployee, setIdCardEmployee] = useState<Employee | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrModalEmployeeId, setQrModalEmployeeId] = useState<string | undefined>(undefined);
  const [paymentDetailsEmpId, setPaymentDetailsEmpId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [showBulkCardsModal, setShowBulkCardsModal] = useState(false);

  // Worker Removal + Backup & Restore Modal State
  const [removeTargetEmp, setRemoveTargetEmp] = useState<Employee | null>(null);
  const [showBackupsModal, setShowBackupsModal] = useState(false);
  const [actionNotice, setActionNotice] = useState('');

  // Add/Edit Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<EmployeeRole>('Mason');
  const [phone, setPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [email, setEmail] = useState('');
  const [joiningDate, setJoiningDate] = useState(getTodayIso());
  const [dailyRate, setDailyRate] = useState('950');
  const [overtimeRate, setOvertimeRate] = useState(String(computeDefaultHourlyOtRate(950)));
  const [isOtAutoSynced, setIsOtAutoSynced] = useState(true);
  const [foodAllowanceDaily, setFoodAllowanceDaily] = useState('0');
  const [aadharRef, setAadharRef] = useState('');
  const [pfNumber, setPfNumber] = useState('');
  const [esiNumber, setEsiNumber] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [empProjectId, setEmpProjectId] = useState('');
  const [empTowerId, setEmpTowerId] = useState('');
  const [skillTags, setSkillTags] = useState<string[]>([]);
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [savingEmployee, setSavingEmployee] = useState(false);

  // Transfer / Site Deployment Modal
  const [transferEmp, setTransferEmp] = useState<Employee | null>(null);
  const [transferProjectId, setTransferProjectId] = useState('');
  const [transferTowerId, setTransferTowerId] = useState('');
  const [transferDate, setTransferDate] = useState(getTodayIso());
  const [transferNotes, setTransferNotes] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Batch Project & Tower Crew Allocation Modal
  const [showBatchAllocModal, setShowBatchAllocModal] = useState(false);
  const [batchProjectId, setBatchProjectId] = useState('');
  const [batchTowerId, setBatchTowerId] = useState('');
  const [batchDate, setBatchDate] = useState(getTodayIso());
  const [batchNotes, setBatchNotes] = useState('');
  const [batchSearch, setBatchSearch] = useState('');
  const [batchHideTargetTower, setBatchHideTargetTower] = useState(false);
  const [batchEmpIds, setBatchEmpIds] = useState<string[]>([]);
  const [savingBatchAlloc, setSavingBatchAlloc] = useState(false);

  // Document Upload State
  const [otherDocTitle, setOtherDocTitle] = useState('');
  const [docError, setDocError] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const towerDeploymentCounts = useMemo(
    () => getTowerDeploymentCounts({ employees, towers, projects }),
    [employees, towers, projects]
  );

  const filterTowers = useMemo(() => {
    if (siteProjectFilter === 'all') return towers;
    return towers.filter((t) => t.projectId === siteProjectFilter);
  }, [towers, siteProjectFilter]);

  const availableSkillTags = useMemo(
    () =>
      normalizeSkillTags([
        ...EMPLOYEE_PRESET_SKILL_TAGS,
        ...employees.flatMap((e) => e.skillTags || []),
      ]),
    [employees]
  );

  const filteredEmployees = useMemo(() => {
    const skillScoped =
      skillFilter !== 'all'
        ? filterEmployeesBySkillTags(employees, [skillFilter], 'any')
        : employees;
    return skillScoped.filter((emp) => {
      if (roleFilter !== 'All' && emp.role !== roleFilter) return false;
      if (siteProjectFilter !== 'all' && emp.currentProjectId !== siteProjectFilter) return false;
      if (siteTowerFilter !== 'all' && emp.currentTowerId !== siteTowerFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          emp.fullName.toLowerCase().includes(q) ||
          emp.empCode.toLowerCase().includes(q) ||
          emp.phone.toLowerCase().includes(q) ||
          (emp.pfNumber || '').toLowerCase().includes(q) ||
          (emp.esiNumber || '').toLowerCase().includes(q) ||
          (emp.currentProjectName || '').toLowerCase().includes(q) ||
          (emp.currentTowerName || '').toLowerCase().includes(q) ||
          (emp.skillTags || []).some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [employees, roleFilter, siteProjectFilter, siteTowerFilter, skillFilter, searchQuery]);

  const bulkSelectedEmployees = useMemo(() => {
    const selectedSet = new Set(bulkSelectedIds);
    return employees.filter((e) => selectedSet.has(e.id));
  }, [employees, bulkSelectedIds]);

  const allVisibleBulkSelected = useMemo(
    () =>
      filteredEmployees.length > 0 &&
      filteredEmployees.every((e) => bulkSelectedIds.includes(e.id)),
    [filteredEmployees, bulkSelectedIds]
  );

  const openBulkCardsForSelectionOrVisible = () => {
    if (bulkSelectedEmployees.length === 0 && filteredEmployees.length > 0) {
      setBulkSelectedIds(filteredEmployees.map((e) => e.id));
    }
    setShowBulkCardsModal(true);
  };

  const selectedEmployee =
    employees.find((e) => e.id === selectedEmpId) || filteredEmployees[0] || null;

  const selectedEmpPayroll = useMemo(() => {
    if (!selectedEmployee) return null;
    return computeEmployeePayroll(selectedEmployee, attendance, advances, settlements);
  }, [selectedEmployee, attendance, advances, settlements]);

  const selectedEmpAssignments = useMemo(() => {
    if (!selectedEmployee) return [];
    return assignments
      .filter((a) => a.employeeId === selectedEmployee.id)
      .sort((a, b) => b.assignedDate.localeCompare(a.assignedDate));
  }, [assignments, selectedEmployee]);

  const selectedEmpDocs = useMemo(() => {
    if (!selectedEmployee) return [];
    return employeeDocuments
      .filter((d) => d.employeeId === selectedEmployee.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [employeeDocuments, selectedEmployee]);

  const selectedEmpDeployments = useMemo(() => {
    if (!selectedEmployee) return [];
    return deployments
      .filter((d) => d.employeeId === selectedEmployee.id)
      .sort((a, b) => b.assignedDate.localeCompare(a.assignedDate));
  }, [deployments, selectedEmployee]);

  const selectedEmpAdvances = useMemo(() => {
    if (!selectedEmployee) return [];
    return advances
      .filter((a) => a.employeeId === selectedEmployee.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [advances, selectedEmployee]);

  const removeTargetMetrics = useMemo(() => {
    if (!removeTargetEmp) {
      return { documentsCount: 0, attendanceCount: 0, totalAdvances: 0, netPayable: 0 };
    }
    const payroll = computeEmployeePayroll(
      removeTargetEmp,
      rawAttendance,
      rawAdvances,
      settlements
    );
    return {
      documentsCount: employeeDocuments.filter((d) => d.employeeId === removeTargetEmp.id).length,
      attendanceCount: rawAttendance.filter((a) => a.employeeId === removeTargetEmp.id).length,
      totalAdvances: payroll.totalAdvances,
      netPayable: payroll.netPayable,
    };
  }, [removeTargetEmp, rawAttendance, rawAdvances, settlements, employeeDocuments]);

  const modalProjectTowers = useMemo(
    () => towers.filter((t) => t.projectId === empProjectId),
    [towers, empProjectId]
  );

  const transferProjectTowers = useMemo(
    () => towers.filter((t) => t.projectId === transferProjectId),
    [towers, transferProjectId]
  );

  const openCreateModal = () => {
    const defProj = projects[0]?.id || '';
    const defTwr = towers.find((t) => t.projectId === defProj)?.id || '';
    const defaultDaily = 950;
    setEditingEmp(null);
    setFullName('');
    setRole('Mason');
    setPhone('');
    setAlternatePhone('');
    setEmail('');
    setJoiningDate(getTodayIso());
    setDailyRate(String(defaultDaily));
    setOvertimeRate(String(computeDefaultHourlyOtRate(defaultDaily)));
    setIsOtAutoSynced(true);
    setFoodAllowanceDaily('0');
    setAadharRef('');
    setPfNumber('');
    setEsiNumber('');
    setBloodGroup('');
    setEmergencyContact('');
    setPhotoDataUrl('');
    setEmpProjectId(defProj);
    setEmpTowerId(defTwr);
    setSkillTags([]);
    setCustomSkillInput('');
    setNotes('');
    setFormError('');
    setShowAddModal(true);
  };

  const openEditModal = (emp: Employee) => {
    const projId = emp.currentProjectId || projects[0]?.id || '';
    const twrId = emp.currentTowerId || towers.find((t) => t.projectId === projId)?.id || '';
    setEditingEmp(emp);
    setFullName(emp.fullName);
    setRole(emp.role);
    setPhone(emp.phone);
    setAlternatePhone(emp.alternatePhone || '');
    setEmail(emp.email || '');
    setJoiningDate(emp.joiningDate);
    setDailyRate(String(emp.dailyRate));
    setOvertimeRate(String(emp.overtimeRate));
    setIsOtAutoSynced(emp.overtimeRate === computeDefaultHourlyOtRate(emp.dailyRate));
    setFoodAllowanceDaily(String(emp.foodAllowanceDaily));
    setAadharRef(emp.aadharRef);
    setPfNumber(emp.pfNumber || '');
    setEsiNumber(emp.esiNumber || '');
    setBloodGroup(emp.bloodGroup || '');
    setEmergencyContact(emp.emergencyContact);
    setPhotoDataUrl(emp.photoDataUrl || '');
    setEmpProjectId(projId);
    setEmpTowerId(twrId);
    setSkillTags(normalizeSkillTags(emp.skillTags));
    setCustomSkillInput('');
    setNotes(emp.notes);
    setFormError('');
    setShowAddModal(true);
  };

  const openTransferModal = (emp: Employee) => {
    const pId = emp.currentProjectId || projects[0]?.id || '';
    const tId = emp.currentTowerId || towers.find((t) => t.projectId === pId)?.id || '';
    setTransferEmp(emp);
    setTransferProjectId(pId);
    setTransferTowerId(tId);
    setTransferDate(getTodayIso());
    setTransferNotes('');
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError('');
    try {
      const compressed = await compressImageToDataUrl(file, 320, 380, 0.8);
      setPhotoDataUrl(compressed);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not process employee photo.');
    }
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!fullName.trim() || !phone.trim()) {
      setFormError('Full Name and Mobile Number are required.');
      return;
    }

    const projObj = projects.find((p) => p.id === empProjectId);
    const twrObj = towers.find((t) => t.id === empTowerId);

    setSavingEmployee(true);
    try {
      const normalizedSkills = normalizeSkillTags(skillTags);
      if (editingEmp) {
        await updateEmployee(editingEmp.id, {
          fullName: fullName.trim(),
          role,
          phone: phone.trim(),
          alternatePhone: alternatePhone.trim(),
          email: email.trim(),
          joiningDate,
          dailyRate: hideSalary ? editingEmp.dailyRate : Number(dailyRate) || 0,
          overtimeRate: hideSalary ? editingEmp.overtimeRate : Number(overtimeRate) || 0,
          foodAllowanceDaily: hideSalary
            ? editingEmp.foodAllowanceDaily
            : Number(foodAllowanceDaily) || 0,
          aadharRef: aadharRef.trim(),
          pfNumber: pfNumber.trim(),
          esiNumber: esiNumber.trim(),
          bloodGroup: bloodGroup.trim(),
          emergencyContact: emergencyContact.trim(),
          photoDataUrl,
          currentProjectId: projObj?.id || '',
          currentProjectName: projObj?.name || '',
          currentTowerId: twrObj?.id || '',
          currentTowerName: twrObj?.name || '',
          skillTags: normalizedSkills,
          notes: notes.trim(),
        });
      } else {
        const created = await addEmployee({
          fullName: fullName.trim(),
          role,
          phone: phone.trim(),
          alternatePhone: alternatePhone.trim(),
          email: email.trim(),
          joiningDate,
          dailyRate: Number(dailyRate) || 0,
          overtimeRate: Number(overtimeRate) || 0,
          foodAllowanceDaily: Number(foodAllowanceDaily) || 0,
          aadharRef: aadharRef.trim(),
          pfNumber: pfNumber.trim(),
          esiNumber: esiNumber.trim(),
          bloodGroup: bloodGroup.trim(),
          emergencyContact: emergencyContact.trim(),
          photoDataUrl,
          currentProjectId: projObj?.id || '',
          currentTowerId: twrObj?.id || '',
          skillTags: normalizedSkills,
          notes: notes.trim(),
        });
        setSelectedEmpId(created.id);
      }
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save employee record.');
    } finally {
      setSavingEmployee(false);
    }
  };

  const handleUploadDoc = async (
    category: 'aadhar_pdf' | 'other',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedEmployee) return;
    setDocError('');
    setUploadingDoc(true);
    try {
      const parsed = await readDocumentAsDataUrl(file);
      const docTitle =
        category === 'aadhar_pdf'
          ? 'Aadhaar Card PDF'
          : otherDocTitle.trim() || file.name.replace(/\.[^.]+$/, '');
      await addEmployeeDocument({
        employeeId: selectedEmployee.id,
        docCategory: category,
        title: docTitle,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.sizeBytes,
        dataUrl: parsed.dataUrl,
      });
      if (category === 'other') setOtherDocTitle('');
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Could not upload document.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleConfirmTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferEmp || !transferProjectId || !transferTowerId) return;
    setTransferring(true);
    try {
      await deployEmployeeToSite({
        employeeId: transferEmp.id,
        projectId: transferProjectId,
        towerId: transferTowerId,
        assignedDate: transferDate,
        notes: transferNotes,
      });
      setTransferEmp(null);
    } finally {
      setTransferring(false);
    }
  };

  const handleSharePaymentWhatsapp = (emp: Employee) => {
    const summary = computeEmployeePayroll(emp, attendance, advances, settlements);
    onTriggerWhatsapp({
      title: 'Share Payment Statement (WhatsApp / Email)',
      recipientName: `${emp.fullName} (${emp.empCode})`,
      recipientPhone: emp.phone,
      recipientEmail: emp.email || '',
      emailSubject: `${companyProfile.companyName} Payment Statement — ${emp.fullName} (${emp.empCode})`,
      message: formatPaymentSummaryWhatsappMessage(
        summary,
        'All Recorded Days',
        companyProfile.companyName
      ),
    });
  };

  const previewNextCode = generateEmployeeCode(role, employees);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Workforce, Statutory IDs &amp; Site Deployment
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Register staff with photo, Aadhaar PDF, PF/ESI &amp; blood group, generate Front &amp; Back ID cards, and transfer crews across projects &amp; towers.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 transition-colors whitespace-nowrap self-start lg:self-auto shrink-0"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Add Employee</span>
            </button>
          )}
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="header-bulk-profile-cards-btn"
              disabled={filteredEmployees.length === 0 && bulkSelectedEmployees.length === 0}
              onClick={openBulkCardsForSelectionOrVisible}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Printer className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <span>
                {bulkSelectedEmployees.length > 0
                  ? `Bulk Profile Cards (${bulkSelectedEmployees.length})`
                  : 'Bulk Profile Cards'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setQrModalEmployeeId(undefined);
                setQrModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <span>Print QR Codes</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const pId =
                  siteProjectFilter !== 'all' ? siteProjectFilter : projects[0]?.id || '';
                const tId =
                  siteTowerFilter !== 'all'
                    ? siteTowerFilter
                    : towers.find((t) => t.projectId === pId)?.id || '';
                setBatchProjectId(pId);
                setBatchTowerId(tId);
                setBatchDate(getTodayIso());
                setBatchNotes('');
                setBatchSearch('');
                setBatchHideTargetTower(false);
                setBatchEmpIds([]);
                setShowBatchAllocModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 whitespace-nowrap"
            >
              <Users className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <span>Deploy Manpower to Tower</span>
            </button>
            <button
              type="button"
              onClick={onOpenCompanySettings}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <Building className="w-4 h-4" aria-hidden="true" />
              <span>Company &amp; ID Details</span>
            </button>
            <button
              type="button"
              data-testid="open-removed-backups-btn"
              onClick={() => setShowBackupsModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <Archive className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <span>Removed Backups ({removedEmployees.length})</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="header-bulk-profile-cards-btn"
              disabled={filteredEmployees.length === 0 && bulkSelectedEmployees.length === 0}
              onClick={openBulkCardsForSelectionOrVisible}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {bulkSelectedEmployees.length > 0
                  ? `Bulk Profile Cards (${bulkSelectedEmployees.length})`
                  : 'Bulk Profile Cards'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setQrModalEmployeeId(undefined);
                setQrModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <QrCode className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Print QR Codes</span>
            </button>
            <div className="px-3 py-1.5 text-xs font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded-md whitespace-nowrap">
              Assigned Tower Crew ({employees.length} Workers)
            </div>
          </div>
        )}
      </div>

      {actionNotice && (
        <div
          data-testid="workforce-backup-notice"
          className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-md flex items-center justify-between gap-3 text-xs font-medium text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{actionNotice}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowBackupsModal(true)}
                className="text-emerald-800 underline hover:text-emerald-950"
              >
                Open Backups ({removedEmployees.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setActionNotice('')}
              aria-label="Dismiss backup notice"
              className="p-1 text-emerald-700 hover:text-emerald-950"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Role Tabs + Project/Tower Site Filter + Search */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-md">
            {(['All', ...ROLES] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  roleFilter === r
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search employees by name, ID, phone, PF, ESI, or site"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, name, phone, site..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
            />
          </div>
        </div>

        {/* Filter by Current Project, Tower & Skill Tag */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label htmlFor="wf-site-proj" className="block text-[11px] font-medium text-slate-500 mb-1">
              Working Project Site Filter
            </label>
            <select
              id="wf-site-proj"
              value={siteProjectFilter}
              onChange={(e) => {
                setSiteProjectFilter(e.target.value);
                setSiteTowerFilter('all');
              }}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Projects ({employees.length} Staff)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wf-site-twr" className="block text-[11px] font-medium text-slate-500 mb-1">
              Working Tower Filter
            </label>
            <select
              id="wf-site-twr"
              value={siteTowerFilter}
              onChange={(e) => setSiteTowerFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Towers</option>
              {filterTowers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wf-skill-filter" className="block text-[11px] font-medium text-slate-500 mb-1">
              Skill Tag Filter
            </label>
            <select
              id="wf-skill-filter"
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Skill Proficiencies</option>
              {availableSkillTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end text-xs text-slate-500 pb-1">
            Showing <strong className="mx-1 text-slate-900 font-mono">{filteredEmployees.length}</strong> deployed workers matching filters
          </div>
        </div>

        {/* Tower Manpower Deployment Quick-Switch Strip */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-500 mr-1">Tower Manpower:</span>
          <button
            type="button"
            onClick={() => {
              setSiteProjectFilter('all');
              setSiteTowerFilter('all');
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
              siteProjectFilter === 'all' && siteTowerFilter === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            All Towers ({employees.filter((e) => e.status === 'active').length})
          </button>
          {towerDeploymentCounts.byTower.map((item) => {
            const active = siteTowerFilter === item.tower.id;
            return (
              <button
                key={item.tower.id}
                type="button"
                onClick={() => {
                  setSiteProjectFilter(item.tower.projectId);
                  setSiteTowerFilter(item.tower.id);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-orange-700 text-white border-orange-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {item.projectName} · {item.tower.name}{' '}
                <span className="font-mono">({item.activeCrewCount})</span>
              </button>
            );
          })}
          {siteTowerFilter !== 'all' && isAdmin && (
            <button
              type="button"
              onClick={() => {
                const targetTwr = towers.find((t) => t.id === siteTowerFilter);
                setBatchProjectId(targetTwr?.projectId || projects[0]?.id || '');
                setBatchTowerId(siteTowerFilter);
                setBatchDate(getTodayIso());
                setBatchNotes('');
                setBatchSearch('');
                setBatchHideTargetTower(true);
                setBatchEmpIds([]);
                setShowBatchAllocModal(true);
              }}
              className="ml-auto px-2.5 py-1 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
            >
              + Deploy Workers to This Tower
            </button>
          )}
        </div>
      </div>

      {/* Split Layout: Roster Table + Selected Employee Record & History */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Roster Table */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Employee Roster ({filteredEmployees.length})
              </h2>
              <span className="text-xs text-slate-500">
                Tick checkboxes to print bulk worker profile cards, or click row for details
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() =>
                  setBulkSelectedIds((prev) =>
                    setBulkWorkersSelection(
                      prev,
                      filteredEmployees,
                      allVisibleBulkSelected ? 'remove' : 'add'
                    )
                  )
                }
                disabled={filteredEmployees.length === 0}
                className="px-2.5 py-1 font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 disabled:opacity-50 whitespace-nowrap"
              >
                {allVisibleBulkSelected
                  ? `Unselect Visible (${filteredEmployees.length})`
                  : `Select Visible (${filteredEmployees.length})`}
              </button>
              <button
                type="button"
                onClick={() =>
                  setBulkSelectedIds((prev) =>
                    setBulkWorkersSelection(
                      prev,
                      filteredEmployees.filter((e) => e.status === 'active'),
                      'add'
                    )
                  )
                }
                disabled={filteredEmployees.filter((e) => e.status === 'active').length === 0}
                className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                Active Crew
              </button>
              {bulkSelectedEmployees.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBulkSelectedIds([])}
                  className="px-2.5 py-1 font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                >
                  Clear ({bulkSelectedEmployees.length})
                </button>
              )}
            </div>
          </div>

          {/* Bulk Selection Print Bar */}
          {bulkSelectedEmployees.length > 0 && (
            <div
              data-testid="bulk-worker-selection-bar"
              className="px-5 py-2.5 bg-orange-50 border-b border-orange-200 flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="text-xs font-medium text-orange-900 font-mono tabular-nums">
                <strong>{bulkSelectedEmployees.length}</strong> worker
                {bulkSelectedEmployees.length === 1 ? '' : 's'} selected for Bulk Profile &amp;
                Attendance Card printing
              </div>
              <button
                type="button"
                data-testid="print-selected-bulk-cards-btn"
                onClick={() => setShowBulkCardsModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800 whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Print Bulk Profile Cards ({bulkSelectedEmployees.length})</span>
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pl-3 pr-1.5 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all visible workers for bulk profile card printing"
                      checked={allVisibleBulkSelected}
                      onChange={() =>
                        setBulkSelectedIds((prev) =>
                          setBulkWorkersSelection(
                            prev,
                            filteredEmployees,
                            allVisibleBulkSelected ? 'remove' : 'add'
                          )
                        )
                      }
                      className="rounded border-slate-300 text-orange-700 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-2">Staff ID</th>
                  <th className="py-2.5 px-2">Name &amp; Site</th>
                  {!hideSalary && (
                    <>
                      <th className="py-2.5 px-2 text-right">Daily</th>
                      <th className="py-2.5 px-2 text-right">Net Pay</th>
                    </>
                  )}
                  <th className="py-2.5 pl-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={hideSalary ? 4 : 6} className="py-10 text-center text-slate-500">
                      No employees match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => {
                    const summary = computeEmployeePayroll(emp, attendance, advances, settlements);
                    const isSelected = emp.id === selectedEmployee?.id;
                    const isBulkChecked = bulkSelectedIds.includes(emp.id);
                    const initials = emp.fullName
                      .split(' ')
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <tr
                        key={emp.id}
                        className={`transition-colors ${
                          isBulkChecked
                            ? 'bg-orange-50/70'
                            : isSelected
                              ? 'bg-orange-50/40'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 pl-3 pr-1.5 align-middle">
                          <input
                            type="checkbox"
                            aria-label={`Select ${emp.fullName} for bulk profile card print`}
                            checked={isBulkChecked}
                            onChange={() =>
                              setBulkSelectedIds((prev) => toggleBulkWorkerSelection(prev, emp.id))
                            }
                            className="rounded border-slate-300 text-orange-700 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-2 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedEmpId(emp.id)}
                            aria-label={`View profile for ${emp.fullName}`}
                            className="inline-flex items-center gap-1.5 text-left hover:text-orange-700"
                          >
                            <span className="w-6 h-6 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
                              {emp.photoDataUrl ? (
                                <img
                                  src={emp.photoDataUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                initials
                              )}
                            </span>
                            <span className="underline decoration-slate-300 underline-offset-2">
                              {emp.empCode}
                            </span>
                          </button>
                        </td>
                        <td className="py-3 px-2 min-w-[130px]">
                          <button
                            type="button"
                            onClick={() => setSelectedEmpId(emp.id)}
                            className="text-left block w-full"
                          >
                            <div className="font-medium text-slate-900">{emp.fullName}</div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-1.5">
                              <span>{emp.role}</span>
                              {emp.currentProjectName && (
                                <span className="text-slate-700">
                                  · {emp.currentProjectName}
                                  {emp.currentTowerName ? ` (${emp.currentTowerName})` : ''}
                                </span>
                              )}
                            </div>
                            {emp.skillTags && emp.skillTags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {emp.skillTags.slice(0, 3).map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {emp.skillTags.length > 3 && (
                                  <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-100 rounded">
                                    +{emp.skillTags.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                          </button>
                        </td>
                        {!hideSalary && (
                          <>
                            <td className="py-3 px-2 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                              {formatINR(emp.dailyRate)}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {formatINR(summary.netPayable)}
                            </td>
                          </>
                        )}
                        <td className="py-3 pl-2 pr-3 text-right">
                          <div className="inline-flex flex-wrap justify-end items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setIdCardEmployee(emp)}
                              aria-label={`Open ID card for ${emp.fullName}`}
                              title="Front & Back ID Card"
                              className="p-1.5 text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200"
                            >
                              <IdCard className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQrModalEmployeeId(emp.id);
                                setQrModalOpen(true);
                              }}
                              aria-label={`Print QR pass for ${emp.fullName}`}
                              title="QR Verification Pass"
                              className="p-1.5 text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                            >
                              <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => openTransferModal(emp)}
                                aria-label={`Transfer site for ${emp.fullName}`}
                                title="Transfer Project / Tower"
                                className="p-1.5 text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenGiveAdvance(emp.id)}
                              aria-label={`Give advance to ${emp.fullName}`}
                              className="px-2 py-1 text-xs font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                            >
                              Advance
                            </button>
                            {!hideSalary && (
                              <button
                                type="button"
                                onClick={() => handleSharePaymentWhatsapp(emp)}
                                aria-label={`Share payment info on WhatsApp or Email for ${emp.fullName}`}
                                className="p-1.5 text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => setRemoveTargetEmp(emp)}
                                aria-label={`Remove ${emp.fullName} with backup`}
                                title="Remove user & save automatic backup"
                                className="p-1.5 text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Selected Employee Joining Record, Docs, ID Card & History */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-6">
          {!selectedEmployee || !selectedEmpPayroll ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Select an employee to view their profile, statutory IDs, documents, and work history.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Profile Header */}
              <div className="flex items-start gap-3.5 pb-4 border-b border-slate-200">
                <div className="w-16 h-20 rounded-md border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                  {selectedEmployee.photoDataUrl ? (
                    <img
                      src={selectedEmployee.photoDataUrl}
                      alt={selectedEmployee.fullName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="font-display font-bold text-lg text-slate-400">
                      {selectedEmployee.fullName
                        .split(' ')
                        .map((s) => s[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-xs font-semibold text-orange-700">
                      {selectedEmployee.empCode} · {selectedEmployee.role}
                      {selectedEmployee.bloodGroup ? ` · ${selectedEmployee.bloodGroup}` : ''}
                    </div>
                    <button
                      type="button"
                      disabled={!isAdmin && !canSupervisorUpdateEmployee(session, selectedEmployee)}
                      onClick={() =>
                        updateEmployee(selectedEmployee.id, {
                          status: selectedEmployee.status === 'active' ? 'inactive' : 'active',
                        })
                      }
                      className={`px-2 py-0.5 text-[11px] font-medium rounded border disabled:opacity-60 ${
                        selectedEmployee.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {selectedEmployee.status === 'active' ? 'Active' : 'Inactive'}
                    </button>
                  </div>

                  <h2 className="text-xl font-semibold text-slate-900 mt-0.5 truncate">
                    {selectedEmployee.fullName}
                  </h2>

                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-700">
                    <MapPin className="w-3.5 h-3.5 text-orange-700 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {selectedEmployee.currentProjectName
                        ? `${selectedEmployee.currentProjectName}${selectedEmployee.currentTowerName ? ` · ${selectedEmployee.currentTowerName}` : ''}`
                        : 'No site assigned'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums flex flex-wrap items-center gap-x-2">
                    <span>Mob: {selectedEmployee.phone}</span>
                    {selectedEmployee.alternatePhone && (
                      <span>· Alt: {selectedEmployee.alternatePhone}</span>
                    )}
                    <span>· Joined: {selectedEmployee.joiningDate}</span>
                  </p>
                </div>
              </div>

              {/* Primary Employee Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {onOpenEmployeeAttendanceCard && (
                  <button
                    type="button"
                    onClick={() => onOpenEmployeeAttendanceCard(selectedEmployee.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800 whitespace-nowrap"
                  >
                    <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Attendance Card</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIdCardEmployee(selectedEmployee)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 whitespace-nowrap"
                >
                  <IdCard className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Front &amp; Back ID Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQrModalEmployeeId(selectedEmployee.id);
                    setQrModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
                >
                  <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>QR Pass</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentDetailsEmpId(selectedEmployee.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 whitespace-nowrap"
                >
                  <ReceiptIndianRupee className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Payment Details</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => openTransferModal(selectedEmployee)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Assign Specific Tower</span>
                  </button>
                )}
                {(isAdmin || canSupervisorUpdateEmployee(session, selectedEmployee)) && (
                  <button
                    type="button"
                    onClick={() => openEditModal(selectedEmployee)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                  >
                    Edit Record
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    data-testid="detail-remove-worker-backup-btn"
                    onClick={() => setRemoveTargetEmp(selectedEmployee)}
                    title="Remove user from Workforce & save automatic backup"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Remove User</span>
                  </button>
                )}
              </div>

              {/* Payment / Advances KPIs */}
              {hideSalary ? (
                <div className="grid grid-cols-2 gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <div className="text-[11px] text-slate-500">Total Advances</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-red-700">
                      {formatINR(selectedEmpPayroll.totalAdvances)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Days Attended</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-900">
                      {selectedEmpPayroll.effectiveDaysWorked}d ({selectedEmpPayroll.presentDays}P · {selectedEmpPayroll.halfDays}HD)
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <div className="text-[11px] text-slate-500">Daily Wage</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(selectedEmployee.dailyRate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">OT Rate / Hr</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(selectedEmployee.overtimeRate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Total Advances</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-red-700">
                      {formatINR(selectedEmpPayroll.totalAdvances)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Net Payable</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-emerald-800">
                      {formatINR(selectedEmpPayroll.netPayable)}
                    </div>
                  </div>
                </div>
              )}

              {/* Statutory & Contact Information */}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs pb-4 border-b border-slate-100">
                <div>
                  <dt className="text-slate-500 inline">Aadhaar No: </dt>
                  <dd className="font-mono text-slate-900 inline">
                    {selectedEmployee.aadharRef || 'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 inline">Blood Group: </dt>
                  <dd className="font-semibold text-red-700 inline">
                    {selectedEmployee.bloodGroup || 'Not set'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 inline">PF / UAN No: </dt>
                  <dd className="font-mono text-slate-900 inline">
                    {selectedEmployee.pfNumber || 'Pending'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 inline">ESI No: </dt>
                  <dd className="font-mono text-slate-900 inline">
                    {selectedEmployee.esiNumber || 'Pending'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500 inline">Family Contact: </dt>
                  <dd className="text-slate-900 inline">
                    {selectedEmployee.emergencyContact || 'Not recorded'}
                  </dd>
                </div>
                {selectedEmployee.email && (
                  <div className="sm:col-span-2">
                    <dt className="text-slate-500 inline">Email: </dt>
                    <dd className="text-slate-900 inline">{selectedEmployee.email}</dd>
                  </div>
                )}
                {selectedEmployee.skillTags && selectedEmployee.skillTags.length > 0 && (
                  <div className="sm:col-span-2 pt-1">
                    <dt className="text-slate-500 block mb-1">Skill Tags:</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {selectedEmployee.skillTags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {selectedEmployee.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-slate-500 inline">Notes: </dt>
                    <dd className="text-slate-700 inline">{selectedEmployee.notes}</dd>
                  </div>
                )}
              </dl>

              {/* Quick Operational Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenAssignWork(selectedEmployee.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800 whitespace-nowrap"
                >
                  <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Assign Flat Work</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenGiveAdvance(selectedEmployee.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                >
                  <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Give Advance</span>
                </button>
                {!hideSalary && (
                  <button
                    type="button"
                    onClick={() => handleSharePaymentWhatsapp(selectedEmployee)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 whitespace-nowrap"
                  >
                    <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Share Payment</span>
                  </button>
                )}
              </div>

              {/* Aadhaar PDF & Other Documents Section */}
              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Aadhaar PDF &amp; Documents ({selectedEmpDocs.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500">Max 450 KB / file</span>
                </div>

                {docError && (
                  <div className="p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                    {docError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50 border border-dashed border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                    <span>{uploadingDoc ? 'Uploading...' : 'Upload Aadhaar PDF'}</span>
                    <input
                      type="file"
                      accept=".pdf,application/pdf,image/*"
                      disabled={uploadingDoc}
                      onChange={(e) => handleUploadDoc('aadhar_pdf', e)}
                      className="sr-only"
                    />
                  </label>

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      aria-label="Other document title"
                      value={otherDocTitle}
                      onChange={(e) => setOtherDocTitle(e.target.value)}
                      placeholder="Doc title (e.g. PAN)"
                      className="min-w-0 flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                    />
                    <label className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Upload</span>
                      <input
                        type="file"
                        accept=".pdf,application/pdf,image/*"
                        disabled={uploadingDoc}
                        onChange={(e) => handleUploadDoc('other', e)}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>

                {selectedEmpDocs.length > 0 && (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden text-xs">
                    {selectedEmpDocs.map((docItem) => (
                      <div
                        key={docItem.id}
                        className="px-3 py-2 bg-white flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {docItem.title}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 truncate">
                            {docItem.fileName} · {Math.max(1, Math.round(docItem.sizeBytes / 1024))} KB
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a
                            href={docItem.dataUrl}
                            download={docItem.fileName}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
                          >
                            <Download className="w-3 h-3" aria-hidden="true" />
                            <span>View/Save</span>
                          </a>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => deleteEmployeeDocument(docItem.id)}
                              aria-label={`Delete document ${docItem.title}`}
                              className="p-1 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Site Deployment & Transfer History */}
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowRightLeft className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Site Deployment &amp; Transfer History ({selectedEmpDeployments.length})
                  </h3>
                </div>
                {selectedEmpDeployments.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No transfers logged yet. Use Transfer Site to deploy to another tower or project.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-36 overflow-y-auto text-xs">
                    {selectedEmpDeployments.map((dep) => (
                      <div key={dep.id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-slate-900">
                            {dep.projectName} ({dep.towerName})
                          </div>
                          {dep.fromProjectName && (
                            <div className="text-[11px] text-slate-500">
                              From: {dep.fromProjectName}
                              {dep.fromTowerName ? ` (${dep.fromTowerName})` : ''}
                            </div>
                          )}
                        </div>
                        <span className="font-mono tabular-nums text-slate-600 shrink-0">
                          {dep.assignedDate}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Employee Flat & Room Assignment History */}
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <History className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Flat &amp; Room Work History ({selectedEmpAssignments.length})
                  </h3>
                </div>
                {selectedEmpAssignments.length === 0 ? (
                  <p className="text-xs text-slate-500 py-1">
                    No flat assignments logged yet for {selectedEmployee.fullName}.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-xs">
                    {selectedEmpAssignments.map((asgn) => (
                      <div key={asgn.id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-slate-900">
                            Flat {asgn.unitNumber} · {asgn.zoneLabel}
                          </div>
                          <div className="text-slate-500">
                            {asgn.projectName} ({asgn.towerName}) · {asgn.targetSqft} sq.ft
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          <div className="text-slate-700">{asgn.assignedDate}</div>
                          <div className="text-[11px] text-slate-500">{asgn.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Employee Recent Advances */}
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  Advance Ledger ({selectedEmpAdvances.length})
                </h3>
                {selectedEmpAdvances.length === 0 ? (
                  <p className="text-xs text-slate-500">No advances taken yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-36 overflow-y-auto text-xs">
                    {selectedEmpAdvances.map((adv) => (
                      <div key={adv.id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <span className="font-medium text-slate-900">
                            {getAdvanceCategoryLabel(adv)}
                          </span>
                          <span className="text-slate-500"> · {adv.date}</span>
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-red-700">
                          -{formatINR(adv.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Add / Edit Employee Modal (Extended with Photo, PF, ESI, Blood Group, Alternate Phone, Site) */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="emp-modal-title"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-orange-700" aria-hidden="true" />
                <h2 id="emp-modal-title" className="text-base font-semibold text-slate-900">
                  {editingEmp
                    ? `Edit Employee (${editingEmp.empCode})`
                    : `Register New Employee (${previewNextCode})`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close employee modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="flex-1 flex flex-col min-h-0">
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {formError && (
                <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded">
                  {formError}
                </div>
              )}

              {isSupervisor && (
                <div className="p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded">
                  <strong>Supervisor Mode:</strong> You can update contact phones, emergency contact, email, blood group, Aadhaar, photo, and notes for your assigned tower crew. Only Admin can change role, wages, or tower allocation.
                </div>
              )}

              {/* Photo + Primary Identity */}
              <div className="flex flex-col sm:flex-row gap-4 items-start pb-3 border-b border-slate-100">
                <div className="flex sm:flex-col items-center gap-2.5 shrink-0">
                  <div className="w-20 h-24 rounded-md border border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center">
                    {photoDataUrl ? (
                      <img
                        src={photoDataUrl}
                        alt="Employee Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Camera className="w-6 h-6 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer">
                      <Upload className="w-3 h-3" aria-hidden="true" />
                      <span>Upload Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="sr-only"
                      />
                    </label>
                    {photoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setPhotoDataUrl('')}
                        className="text-[11px] text-red-700 hover:underline text-left"
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                  <div>
                    <label htmlFor="emp-name" className="block text-xs font-medium text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input
                      id="emp-name"
                      type="text"
                      required
                      disabled={isSupervisor}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="emp-role" className="block text-xs font-medium text-slate-700 mb-1">
                      Role / Trade
                    </label>
                    <select
                      id="emp-role"
                      disabled={isSupervisor}
                      value={role}
                      onChange={(e) => setRole(e.target.value as EmployeeRole)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="emp-phone" className="block text-xs font-medium text-slate-700 mb-1">
                      Registered Mobile (WhatsApp)
                    </label>
                    <input
                      id="emp-phone"
                      type="text"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="emp-alt-phone" className="block text-xs font-medium text-slate-700 mb-1">
                      Alternate Contact Number
                    </label>
                    <input
                      id="emp-alt-phone"
                      type="text"
                      value={alternatePhone}
                      onChange={(e) => setAlternatePhone(e.target.value)}
                      placeholder="Optional second mobile"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="emp-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address (Optional)
                  </label>
                  <input
                    id="emp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="worker@example.com"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="emp-blood" className="block text-xs font-medium text-slate-700 mb-1">
                    Blood Group
                  </label>
                  <select
                    id="emp-blood"
                    value={bloodGroup}
                    onChange={(e) => setBloodGroup(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="">Select Group</option>
                    {BLOOD_GROUPS.filter(Boolean).map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="emp-join" className="block text-xs font-medium text-slate-700 mb-1">
                    Joining Date
                  </label>
                  <input
                    id="emp-join"
                    type="date"
                    required
                    disabled={isSupervisor}
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                  />
                </div>
              </div>

              {/* Wage Structure (Admin Only — hidden from Supervisors) */}
              {!hideSalary && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="emp-rate" className="block text-xs font-medium text-slate-700 mb-1">
                      Daily Rate (₹)
                    </label>
                    <input
                      id="emp-rate"
                      type="number"
                      min="0"
                      step="any"
                      disabled={isSupervisor}
                      value={dailyRate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDailyRate(val);
                        if (!editingEmp || isOtAutoSynced) {
                          setOvertimeRate(String(computeDefaultHourlyOtRate(Number(val))));
                        }
                      }}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="emp-ot" className="block text-xs font-medium text-slate-700">
                        OT / Hr (₹)
                      </label>
                      {!isSupervisor && (
                        <button
                          type="button"
                          onClick={() => {
                            setOvertimeRate(
                              String(computeDefaultHourlyOtRate(Number(dailyRate)))
                            );
                            setIsOtAutoSynced(true);
                          }}
                          className="text-[10px] font-medium text-orange-700 hover:underline"
                        >
                          Auto (Daily ÷ 8)
                        </button>
                      )}
                    </div>
                    <input
                      id="emp-ot"
                      type="number"
                      min="0"
                      step="any"
                      disabled={isSupervisor}
                      value={overtimeRate}
                      onChange={(e) => {
                        setIsOtAutoSynced(false);
                        setOvertimeRate(e.target.value);
                      }}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="emp-food" className="block text-xs font-medium text-slate-700 mb-1">
                      Daily Food (₹)
                    </label>
                    <input
                      id="emp-food"
                      type="number"
                      min="0"
                      disabled={isSupervisor}
                      value={foodAllowanceDaily}
                      onChange={(e) => setFoodAllowanceDaily(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md disabled:bg-slate-100"
                    />
                  </div>
                </div>
              )}

              {/* Statutory PF, ESI, Aadhaar, Family Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="emp-aadhar" className="block text-xs font-medium text-slate-700 mb-1">
                    Aadhaar Number
                  </label>
                  <input
                    id="emp-aadhar"
                    type="text"
                    value={aadharRef}
                    onChange={(e) => setAadharRef(e.target.value)}
                    placeholder="e.g. 4821 9034 1122"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="emp-emerg" className="block text-xs font-medium text-slate-700 mb-1">
                    Family Contact Name &amp; Number
                  </label>
                  <input
                    id="emp-emerg"
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    placeholder="e.g. Lakshmi (Wife) 9848022331"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="emp-pf" className="block text-xs font-medium text-slate-700 mb-1">
                    PF / UAN Number
                  </label>
                  <input
                    id="emp-pf"
                    type="text"
                    value={pfNumber}
                    onChange={(e) => setPfNumber(e.target.value)}
                    placeholder="e.g. 101458291032"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="emp-esi" className="block text-xs font-medium text-slate-700 mb-1">
                    ESI Insurance Number
                  </label>
                  <input
                    id="emp-esi"
                    type="text"
                    value={esiNumber}
                    onChange={(e) => setEsiNumber(e.target.value)}
                    placeholder="e.g. 5210482910"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Site Project & Tower Assignment */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-md">
                <div>
                  <label htmlFor="emp-proj" className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Working Project
                  </label>
                  <select
                    id="emp-proj"
                    disabled={isSupervisor}
                    value={empProjectId}
                    onChange={(e) => {
                      const nextP = e.target.value;
                      setEmpProjectId(nextP);
                      const firstT = towers.find((t) => t.projectId === nextP);
                      setEmpTowerId(firstT?.id || '');
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                  >
                    <option value="">Unassigned / Bench</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="emp-twr" className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Working Tower
                  </label>
                  <select
                    id="emp-twr"
                    disabled={isSupervisor}
                    value={empTowerId}
                    onChange={(e) => setEmpTowerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                  >
                    <option value="">Select Tower</option>
                    {modalProjectTowers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Skill Tags */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-700">
                    Skill Tags / Work Proficiencies
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {skillTags.length} selected
                  </span>
                </div>

                {skillTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {skillTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-900 border border-orange-300 rounded"
                      >
                        <span>{tag}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSkillTags((prev) => prev.filter((t) => t !== tag))
                          }
                          aria-label={`Remove skill tag ${tag}`}
                          className="text-orange-800 hover:text-red-700"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {EMPLOYEE_PRESET_SKILL_TAGS.map((preset) => {
                    const active = skillTags.some(
                      (t) => t.toLowerCase() === preset.toLowerCase()
                    );
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setSkillTags((prev) =>
                            active
                              ? prev.filter((t) => t.toLowerCase() !== preset.toLowerCase())
                              : normalizeSkillTags([...prev, preset])
                          )
                        }
                        className={`px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                          active
                            ? 'bg-orange-700 text-white border-orange-700'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {active ? `✓ ${preset}` : `+ ${preset}`}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    id="emp-custom-skill"
                    type="text"
                    aria-label="Add custom skill tag"
                    value={customSkillInput}
                    onChange={(e) => setCustomSkillInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const cleaned = customSkillInput.trim();
                        if (cleaned) {
                          setSkillTags((prev) => normalizeSkillTags([...prev, cleaned]));
                          setCustomSkillInput('');
                        }
                      }
                    }}
                    placeholder="Add custom skill tag (e.g. Mosaic Inlay)..."
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cleaned = customSkillInput.trim();
                      if (cleaned) {
                        setSkillTags((prev) => normalizeSkillTags([...prev, cleaned]));
                        setCustomSkillInput('');
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
                  >
                    Add Skill
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="emp-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Skills / Joining Notes
                </label>
                <input
                  id="emp-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Specialist in Italian marble & skirting"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              </div>

              <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50/70 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEmployee}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {savingEmployee
                    ? 'Saving...'
                    : editingEmp
                      ? 'Update Employee'
                      : 'Register & Generate ID'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer / Deploy Employee Across Projects & Towers Modal */}
      {transferEmp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-site-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-orange-700" aria-hidden="true" />
                <h2 id="transfer-site-title" className="text-base font-semibold text-slate-900">
                  Deploy / Transfer Employee Site
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setTransferEmp(null)}
                aria-label="Close transfer modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmTransfer} className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs">
                <div className="font-semibold text-slate-900">
                  {transferEmp.fullName} ({transferEmp.empCode}) · {transferEmp.role}
                </div>
                <div className="text-slate-500 mt-0.5">
                  Current Site:{' '}
                  {transferEmp.currentProjectName
                    ? `${transferEmp.currentProjectName} · ${transferEmp.currentTowerName || ''}`
                    : 'Not assigned'}
                </div>
              </div>

              <div>
                <label htmlFor="tr-proj" className="block text-xs font-medium text-slate-700 mb-1">
                  Target Project
                </label>
                <select
                  id="tr-proj"
                  required
                  value={transferProjectId}
                  onChange={(e) => {
                    const pId = e.target.value;
                    setTransferProjectId(pId);
                    const firstT = towers.find((t) => t.projectId === pId);
                    setTransferTowerId(firstT?.id || '');
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="tr-twr" className="block text-xs font-medium text-slate-700 mb-1">
                  Target Tower
                </label>
                <select
                  id="tr-twr"
                  required
                  value={transferTowerId}
                  onChange={(e) => setTransferTowerId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                >
                  {transferProjectTowers.length === 0 ? (
                    <option value="">No towers in selected project</option>
                  ) : (
                    transferProjectTowers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label htmlFor="tr-date" className="block text-xs font-medium text-slate-700 mb-1">
                  Deployment Date
                </label>
                <input
                  id="tr-date"
                  type="date"
                  required
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="tr-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Transfer / Handover Reason
                </label>
                <input
                  id="tr-notes"
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="e.g. Shifted to Tower B for Podium marble work"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTransferEmp(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferring || !transferTowerId}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {transferring ? 'Updating...' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project & Tower-Wise Batch Crew Allocation Modal */}
      {showBatchAllocModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-alloc-title"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-700" aria-hidden="true" />
                <h2 id="batch-alloc-title" className="text-base font-semibold text-slate-900">
                  Allocate Employees Project &amp; Tower Wise
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowBatchAllocModal(false)}
                aria-label="Close batch allocation modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!batchProjectId || !batchTowerId || batchEmpIds.length === 0) return;
                setSavingBatchAlloc(true);
                try {
                  await bulkAllocateEmployeesToTower({
                    employeeIds: batchEmpIds,
                    projectId: batchProjectId,
                    towerId: batchTowerId,
                    assignedDate: batchDate,
                    notes: batchNotes,
                  });
                  setShowBatchAllocModal(false);
                } finally {
                  setSavingBatchAlloc(false);
                }
              }}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ba-proj" className="block text-xs font-medium text-slate-700 mb-1">
                    Target Project
                  </label>
                  <select
                    id="ba-proj"
                    required
                    value={batchProjectId}
                    onChange={(e) => {
                      const nextP = e.target.value;
                      setBatchProjectId(nextP);
                      const firstT = towers.find((t) => t.projectId === nextP);
                      setBatchTowerId(firstT?.id || '');
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ba-twr" className="block text-xs font-medium text-slate-700 mb-1">
                    Target Tower
                  </label>
                  <select
                    id="ba-twr"
                    required
                    value={batchTowerId}
                    onChange={(e) => setBatchTowerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {towers
                      .filter((t) => t.projectId === batchProjectId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ba-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Deployment Date
                  </label>
                  <input
                    id="ba-date"
                    type="date"
                    required
                    value={batchDate}
                    onChange={(e) => setBatchDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ba-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Allocation Note / Shift Instructions
                </label>
                <input
                  id="ba-notes"
                  type="text"
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  placeholder="e.g. Shifted mason & helper team for 12th floor dado work"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <input
                    type="text"
                    aria-label="Filter employees to allocate"
                    value={batchSearch}
                    onChange={(e) => setBatchSearch(e.target.value)}
                    placeholder="Search crew by name, ID, role, or current site..."
                    className="w-full sm:w-72 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={batchHideTargetTower}
                        onChange={(e) => setBatchHideTargetTower(e.target.checked)}
                        className="rounded border-slate-300 text-orange-700"
                      />
                      <span>Other towers only</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const q = batchSearch.trim().toLowerCase();
                        const visibleIds = employees
                          .filter((e) => e.status === 'active')
                          .filter((e) => !batchHideTargetTower || e.currentTowerId !== batchTowerId)
                          .filter(
                            (e) =>
                              !q ||
                              e.fullName.toLowerCase().includes(q) ||
                              e.empCode.toLowerCase().includes(q) ||
                              e.role.toLowerCase().includes(q)
                          )
                          .map((e) => e.id);
                        setBatchEmpIds(visibleIds);
                      }}
                      className="text-orange-700 font-medium hover:underline"
                    >
                      Select Visible
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setBatchEmpIds([])}
                      className="text-slate-600 hover:underline"
                    >
                      Clear ({batchEmpIds.length})
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {employees
                    .filter((e) => e.status === 'active')
                    .filter((e) => !batchHideTargetTower || e.currentTowerId !== batchTowerId)
                    .filter((e) => {
                      const q = batchSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        e.fullName.toLowerCase().includes(q) ||
                        e.empCode.toLowerCase().includes(q) ||
                        e.role.toLowerCase().includes(q) ||
                        (e.currentTowerName || '').toLowerCase().includes(q)
                      );
                    })
                    .map((emp) => {
                      const checked = batchEmpIds.includes(emp.id);
                      return (
                        <label
                          key={emp.id}
                          className={`px-3 py-2 flex items-center justify-between gap-3 text-xs cursor-pointer ${
                            checked ? 'bg-orange-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setBatchEmpIds((prev) =>
                                  e.target.checked
                                    ? [...prev, emp.id]
                                    : prev.filter((id) => id !== emp.id)
                                );
                              }}
                              className="rounded border-slate-300 text-orange-700"
                            />
                            <span className="font-mono text-slate-600">{emp.empCode}</span>
                            <span className="font-medium text-slate-900 truncate">{emp.fullName}</span>
                            <span className="text-slate-500">({emp.role})</span>
                          </span>
                          <span className="text-[11px] text-slate-500 shrink-0">
                            {emp.currentProjectName
                              ? `${emp.currentProjectName}${emp.currentTowerName ? ` · ${emp.currentTowerName}` : ''}`
                              : 'Unassigned'}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBatchAllocModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBatchAlloc || !batchTowerId || batchEmpIds.length === 0}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {savingBatchAlloc
                    ? 'Allocating...'
                    : `Allocate ${batchEmpIds.length} Employee${batchEmpIds.length === 1 ? '' : 's'} to Tower`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Front & Back ID Card Modal */}
      <EmployeeIdCardModal
        employee={idCardEmployee}
        onClose={() => setIdCardEmployee(null)}
        onOpenCompanySettings={() => {
          setIdCardEmployee(null);
          onOpenCompanySettings();
        }}
        onTriggerWhatsapp={onTriggerWhatsapp}
        onPreviewQrProfile={onPreviewQrProfile}
      />

      {/* Batch & Single Workforce QR Code Generator & Print Sheet Modal */}
      <WorkforceQrPrintModal
        isOpen={qrModalOpen}
        onClose={() => {
          setQrModalOpen(false);
          setQrModalEmployeeId(undefined);
        }}
        employees={employees}
        projects={projects}
        towers={towers}
        initialEmployeeId={qrModalEmployeeId}
        onPreviewQrProfile={onPreviewQrProfile}
      />

      {/* Individual Employee Payment Details Modal */}
      <IndividualPaymentDetailsModal
        employeeId={paymentDetailsEmpId}
        onClose={() => setPaymentDetailsEmpId(null)}
        onTriggerWhatsapp={onTriggerWhatsapp}
      />

      {/* Bulk Paginated Worker Profile & Attendance Card Print Preview */}
      <BulkWorkerCardsPrintPreview
        isOpen={showBulkCardsModal}
        onClose={() => setShowBulkCardsModal(false)}
        selectedEmployees={bulkSelectedEmployees}
      />

      {/* Confirm Remove Worker + Automatic Backup Modal */}
      <RemoveEmployeeConfirmModal
        employee={removeTargetEmp}
        documentsCount={removeTargetMetrics.documentsCount}
        attendanceCount={removeTargetMetrics.attendanceCount}
        totalAdvances={removeTargetMetrics.totalAdvances}
        netPayable={removeTargetMetrics.netPayable}
        onCancel={() => setRemoveTargetEmp(null)}
        onConfirm={async ({ removalReason, downloadJson }) => {
          if (!removeTargetEmp) return;
          const targetId = removeTargetEmp.id;
          const savedBackup = await removeEmployeeWithBackup({
            employeeId: targetId,
            removalReason,
          });
          if (downloadJson) {
            const { filename, json } = buildEmployeeBackupExportPayload({
              backups: [savedBackup],
              companyName: companyProfile.companyName,
            });
            triggerJsonBackupDownload(filename, json);
          }
          setBulkSelectedIds((prev) => prev.filter((id) => id !== targetId));
          if (selectedEmpId === targetId) {
            const nextEmp = employees.find((e) => e.id !== targetId);
            setSelectedEmpId(nextEmp?.id || '');
          }
          setRemoveTargetEmp(null);
          setActionNotice(
            `Removed ${savedBackup.fullName} (${savedBackup.empCode}) from active roster. Automatic backup saved to Removed Backups.${downloadJson ? ' JSON backup downloaded.' : ''}`
          );
        }}
      />

      {/* Removed Worker Backups Vault / Restore / Export / Import Modal */}
      <RemovedEmployeeBackupsModal
        isOpen={showBackupsModal}
        backups={removedEmployees}
        companyName={companyProfile.companyName}
        ownerId={companyProfile.ownerId}
        onClose={() => setShowBackupsModal(false)}
        onRestore={async (backupOrId) => {
          const res = await restoreEmployeeBackup(backupOrId);
          setSelectedEmpId(res.employee.id);
          setActionNotice(
            `Restored ${res.employee.fullName} (${res.employee.empCode}) back into Workforce & IDs.`
          );
          return res;
        }}
        onDeleteForever={async (backupId) => {
          await deleteEmployeeBackupPermanently(backupId);
        }}
      />
    </div>
  );
}
