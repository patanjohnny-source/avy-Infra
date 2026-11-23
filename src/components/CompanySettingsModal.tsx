import React, { useEffect, useState } from 'react';
import {
  Building,
  CheckCircle2,
  ImagePlus,
  Lock,
  Moon,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useTheme } from '../context/ThemeContext';
import { compressBoundedScreenshotDataUrl, compressImageToDataUrl } from '../utils/idCardPdf';
import { DEFAULT_WEEKLY_EXPENSE_BUDGET } from '../utils/operations';
import { formatINR } from '../utils/payroll';

interface CompanySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  canEditCompany?: boolean;
}

function getLetterheadPreviewOpacityClass(opacity: number): string {
  if (opacity <= 0.08) return 'opacity-5';
  if (opacity <= 0.13) return 'opacity-10';
  if (opacity <= 0.18) return 'opacity-15';
  if (opacity <= 0.24) return 'opacity-20';
  if (opacity <= 0.29) return 'opacity-25';
  if (opacity <= 0.35) return 'opacity-30';
  if (opacity <= 0.45) return 'opacity-40';
  if (opacity <= 0.55) return 'opacity-50';
  if (opacity <= 0.65) return 'opacity-60';
  if (opacity <= 0.75) return 'opacity-75';
  if (opacity <= 0.88) return 'opacity-85';
  return 'opacity-100';
}

export function CompanySettingsModal({
  isOpen,
  onClose,
  canEditCompany = true,
}: CompanySettingsModalProps) {
  const { companyProfile, updateCompanyProfile } = useStore();
  const { isDark, setTheme, toggleTheme } = useTheme();

  const [companyName, setCompanyName] = useState('');
  const [tagline, setTagline] = useState('');
  const [address, setAddress] = useState('');
  const [hrContact, setHrContact] = useState('');
  const [hrEmail, setHrEmail] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [pfEstCode, setPfEstCode] = useState('');
  const [esiCode, setEsiCode] = useState('');
  const [signatoryName, setSignatoryName] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [quotationLetterheadBgDataUrl, setQuotationLetterheadBgDataUrl] = useState('');
  const [quotationLetterheadOpacity, setQuotationLetterheadOpacity] = useState(0.14);
  const [requireFinishBeforeNewWork, setRequireFinishBeforeNewWork] = useState(true);
  const [customExpenseCategories, setCustomExpenseCategories] = useState<string[]>([]);
  const [newExpenseCategory, setNewExpenseCategory] = useState('');
  const [weeklyExpenseBudget, setWeeklyExpenseBudget] = useState<string>(String(DEFAULT_WEEKLY_EXPENSE_BUDGET));
  const [error, setError] = useState('');
  const [savedBanner, setSavedBanner] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCompanyName(companyProfile.companyName || 'AVY INFRA');
    setTagline(companyProfile.tagline || '');
    setAddress(companyProfile.address || '');
    setHrContact(companyProfile.hrContact || '');
    setHrEmail(companyProfile.hrEmail || '');
    setGstNumber(companyProfile.gstNumber || '');
    setPfEstCode(companyProfile.pfEstCode || '');
    setEsiCode(companyProfile.esiCode || '');
    setSignatoryName(companyProfile.signatoryName || '');
    setLogoDataUrl(companyProfile.logoDataUrl || '');
    setQuotationLetterheadBgDataUrl(companyProfile.quotationLetterheadBgDataUrl || '');
    setQuotationLetterheadOpacity(
      typeof companyProfile.quotationLetterheadOpacity === 'number' &&
        Number.isFinite(companyProfile.quotationLetterheadOpacity)
        ? Math.max(0.05, Math.min(1, companyProfile.quotationLetterheadOpacity))
        : 0.14
    );
    setRequireFinishBeforeNewWork(companyProfile.requireFinishBeforeNewWork !== false);
    setCustomExpenseCategories(companyProfile.customExpenseCategories || []);
    setNewExpenseCategory('');
    setWeeklyExpenseBudget(
      String(
        typeof companyProfile.weeklyExpenseBudget === 'number' &&
          Number.isFinite(companyProfile.weeklyExpenseBudget)
          ? companyProfile.weeklyExpenseBudget
          : DEFAULT_WEEKLY_EXPENSE_BUDGET
      )
    );
    setError('');
    setSavedBanner('');
  }, [isOpen, companyProfile]);

  if (!isOpen) return null;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const compressed = await compressImageToDataUrl(file, 260, 260, 0.85);
      setLogoDataUrl(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process company logo image.');
    }
  };

  const handleQuotationLetterheadUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const compressed = await compressBoundedScreenshotDataUrl(file, {
        maxWidth: 1000,
        maxHeight: 1400,
        quality: 0.78,
        maxChars: 220000,
      });
      setQuotationLetterheadBgDataUrl(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process letterhead background image.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditCompany) {
      onClose();
      return;
    }
    setError('');
    setSavedBanner('');
    if (!companyName.trim() || !address.trim() || !hrContact.trim()) {
      setError('Company Name, Registered Address, and HR Contact Number are required for ID cards.');
      return;
    }
    const parsedBudget = Number(weeklyExpenseBudget);
    if (weeklyExpenseBudget.trim() !== '' && (!Number.isFinite(parsedBudget) || parsedBudget < 0)) {
      setError('Weekly Expense Budget must be 0 or a positive INR amount.');
      return;
    }
    const cleanBudget = weeklyExpenseBudget.trim() === '' ? 0 : Math.min(100000000, Math.round(parsedBudget));

    setSaving(true);
    try {
      await updateCompanyProfile({
        companyName: companyName.trim(),
        tagline: tagline.trim(),
        address: address.trim(),
        hrContact: hrContact.trim(),
        hrEmail: hrEmail.trim(),
        gstNumber: gstNumber.trim(),
        pfEstCode: pfEstCode.trim(),
        esiCode: esiCode.trim(),
        signatoryName: signatoryName.trim() || 'Authorized Signatory — HR',
        logoDataUrl,
        quotationLetterheadBgDataUrl,
        quotationLetterheadOpacity,
        requireFinishBeforeNewWork,
        customExpenseCategories,
        weeklyExpenseBudget: cleanBudget,
      });
      setSavedBanner('Company details and operational rules saved.');
      setTimeout(() => {
        onClose();
      }, 350);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save company details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-settings-title"
      data-testid="settings-modal"
    >
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            {canEditCompany ? (
              <Building className="w-5 h-5 text-orange-700" aria-hidden="true" />
            ) : (
              <Settings className="w-5 h-5 text-orange-700" aria-hidden="true" />
            )}
            <h2 id="company-settings-title" className="text-base font-semibold text-slate-900">
              {canEditCompany
                ? 'Settings, Appearance & Company Details'
                : 'Settings & Display Preferences'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings modal"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {savedBanner && (
            <div className="p-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{savedBanner}</span>
            </div>
          )}

          {/* Global Display Theme (Dark Mode Toggle — persists across sessions) */}
          <div
            data-testid="appearance-settings-card"
            className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {isDark ? (
                    <Moon className="w-4 h-4 text-orange-700" aria-hidden="true" />
                  ) : (
                    <Sun className="w-4 h-4 text-orange-700" aria-hidden="true" />
                  )}
                  <span className="text-xs font-semibold text-slate-900">
                    Global Dark Mode (Site Lighting Comfort)
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                      isDark
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {isDark ? 'DARK ACTIVE' : 'LIGHT ACTIVE'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Reduces eye strain for site supervisors and admins across dim basements, night shifts, or bright outdoor glare. Saved automatically on this device across sessions.
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={isDark}
                aria-label="Toggle global dark mode"
                data-testid="dark-mode-toggle"
                onClick={toggleTheme}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-orange-600 ${
                  isDark
                    ? 'bg-orange-700 border-orange-600'
                    : 'bg-slate-200 border-slate-300'
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
                    isDark ? 'translate-x-6' : 'translate-x-1'
                  }`}
                >
                  {isDark ? (
                    <Moon className="w-3 h-3 text-orange-700" aria-hidden="true" />
                  ) : (
                    <Sun className="w-3 h-3 text-slate-700" aria-hidden="true" />
                  )}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="theme-option-light"
                onClick={() => setTheme('light')}
                aria-pressed={!isDark}
                className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md border transition-colors ${
                  !isDark
                    ? 'bg-white text-slate-900 border-orange-600 ring-1 ring-orange-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Light Mode</span>
              </button>
              <button
                type="button"
                data-testid="theme-option-dark"
                onClick={() => setTheme('dark')}
                aria-pressed={isDark}
                className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md border transition-colors ${
                  isDark
                    ? 'bg-orange-700 text-white border-orange-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Dark Mode</span>
              </button>
            </div>
          </div>

          {!canEditCompany ? (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Lock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span>Workspace Configuration (Admin Managed)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    Company: <strong className="text-slate-900">{companyName}</strong>
                  </div>
                  <div>
                    Weekly Burn Limit:{' '}
                    <strong className="font-mono text-slate-900">
                      {Number(weeklyExpenseBudget) > 0
                        ? formatINR(Number(weeklyExpenseBudget))
                        : 'Disabled'}
                    </strong>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Company branding, ID card details, expense categories, and weekly budget thresholds can only be modified by an Admin.
                </p>
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Logo + Name */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                {logoDataUrl ? (
                  <img
                    src={logoDataUrl}
                    alt="Company Logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="font-display font-bold text-sm text-slate-700">
                    {companyName.slice(0, 3).toUpperCase() || 'AVY'}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Upload Logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </label>
                {logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setLogoDataUrl('')}
                    className="block text-[11px] text-red-700 hover:underline inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                    <span>Remove logo</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 gap-2.5">
              <div>
                <label htmlFor="comp-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Company Name
                </label>
                <input
                  id="comp-name"
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="AVY INFRA"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="comp-tag" className="block text-xs font-medium text-slate-700 mb-1">
                  Trade / Tagline (on Front ID)
                </label>
                <input
                  id="comp-tag"
                  type="text"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="Tile Laying & Stone Finishing Contractors"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="comp-addr" className="block text-xs font-medium text-slate-700 mb-1">
              Registered Office Address (Printed on Back of Employee ID Card)
            </label>
            <textarea
              id="comp-addr"
              rows={2}
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Plot 42, Jubilee Enclave, Madhapur, Hyderabad - 500081"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="comp-hr-phone" className="block text-xs font-medium text-slate-700 mb-1">
                HR Contact Helpline Number
              </label>
              <input
                id="comp-hr-phone"
                type="text"
                required
                value={hrContact}
                onChange={(e) => setHrContact(e.target.value)}
                placeholder="+91 98480 00112"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="comp-hr-email" className="block text-xs font-medium text-slate-700 mb-1">
                HR / Accounts Email
              </label>
              <input
                id="comp-hr-email"
                type="email"
                value={hrEmail}
                onChange={(e) => setHrEmail(e.target.value)}
                placeholder="hr@avyinfra.com"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="comp-gst" className="block text-xs font-medium text-slate-700 mb-1">
                GSTIN (Optional)
              </label>
              <input
                id="comp-gst"
                type="text"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                placeholder="36AABCA9021K1Z4"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="comp-pf" className="block text-xs font-medium text-slate-700 mb-1">
                PF Est. Code
              </label>
              <input
                id="comp-pf"
                type="text"
                value={pfEstCode}
                onChange={(e) => setPfEstCode(e.target.value)}
                placeholder="AP/HYD/0048219"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="comp-esi" className="block text-xs font-medium text-slate-700 mb-1">
                ESI Employer Code
              </label>
              <input
                id="comp-esi"
                type="text"
                value={esiCode}
                onChange={(e) => setEsiCode(e.target.value)}
                placeholder="52000482190001001"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div>
            <label htmlFor="comp-signatory" className="block text-xs font-medium text-slate-700 mb-1">
              Authorized Signatory Label (ID Card Footer)
            </label>
            <input
              id="comp-signatory"
              type="text"
              value={signatoryName}
              onChange={(e) => setSignatoryName(e.target.value)}
              placeholder="Authorized Signatory — AVY INFRA HR"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <label className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-md cursor-pointer">
            <input
              type="checkbox"
              checked={requireFinishBeforeNewWork}
              onChange={(e) => setRequireFinishBeforeNewWork(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-700 focus:ring-orange-600"
            />
            <span className="text-xs text-slate-700">
              <strong className="text-slate-900 block">
                Require previous flat/room work to be finished before assigning new work
              </strong>
              Prevents double-booking active masons or helpers until their running tile work is marked Completed.
            </span>
          </label>

          {/* Weekly Expense Budget & Burn Rate Alert Threshold */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="comp-weekly-budget" className="text-xs font-semibold text-slate-900">
                Weekly Expense Budget &amp; Burn Alert Threshold (₹ / Week)
              </label>
              <span className="text-[11px] font-mono text-slate-600">
                {Number(weeklyExpenseBudget) > 0
                  ? `Daily Limit: ${formatINR(Math.round(Number(weeklyExpenseBudget) / 7))}/day`
                  : 'Alerts Disabled (0)'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <input
                id="comp-weekly-budget"
                type="number"
                min={0}
                max={100000000}
                step={500}
                value={weeklyExpenseBudget}
                onChange={(e) => setWeeklyExpenseBudget(e.target.value)}
                placeholder="50000"
                className="w-full sm:w-48 px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
              />
              <p className="text-[11px] text-slate-500">
                Triggers a Dashboard notification alert if the daily Expense Burn Rate exceeds Weekly Budget ÷ 7 or weekly spend crosses this limit.
              </p>
            </div>
          </div>

          {/* Custom Expense Categories Configuration */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Custom Site Expense Categories (Appear in Expense Modal)
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Configure organization-wide expense heads (e.g., Gas Cylinder Refill, Site Medical Kit, Travel Advance, Tea &amp; Snacks). Saved categories appear directly in the Expense Recording dropdown.
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {customExpenseCategories.length === 0 ? (
                <span className="text-[11px] text-slate-400 italic">
                  No custom expense categories configured yet.
                </span>
              ) : (
                customExpenseCategories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-white text-slate-800 border border-slate-300 rounded-md"
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomExpenseCategories((prev) =>
                          prev.filter((item) => item.toLowerCase() !== cat.toLowerCase())
                        )
                      }
                      aria-label={`Remove custom expense category ${cat}`}
                      className="text-slate-400 hover:text-red-700"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="comp-new-exp-cat"
                type="text"
                value={newExpenseCategory}
                onChange={(e) => setNewExpenseCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const clean = newExpenseCategory.trim();
                    if (
                      clean &&
                      !customExpenseCategories.some((c) => c.toLowerCase() === clean.toLowerCase())
                    ) {
                      setCustomExpenseCategories((prev) => [...prev, clean]);
                      setNewExpenseCategory('');
                    }
                  }
                }}
                placeholder="Add category (e.g. Diesel Generator, Scaffolding Rent)"
                aria-label="New custom expense category name"
                className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
              <button
                type="button"
                onClick={() => {
                  const clean = newExpenseCategory.trim();
                  if (!clean) return;
                  if (!customExpenseCategories.some((c) => c.toLowerCase() === clean.toLowerCase())) {
                    setCustomExpenseCategories((prev) => [...prev, clean]);
                  }
                  setNewExpenseCategory('');
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 rounded-md hover:bg-slate-900 whitespace-nowrap"
              >
                Add Category
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-slate-500">Quick suggestions:</span>
              {['Gas Payment', 'Site Medical Kit', 'Travel Advance', 'Tea & Snacks', 'Diesel & Generator'].map(
                (suggestion) => {
                  const exists = customExpenseCategories.some(
                    (c) => c.toLowerCase() === suggestion.toLowerCase()
                  );
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={exists}
                      onClick={() =>
                        setCustomExpenseCategories((prev) =>
                          prev.some((c) => c.toLowerCase() === suggestion.toLowerCase())
                            ? prev
                            : [...prev, suggestion]
                        )
                      }
                      className={`px-2 py-0.5 text-[11px] rounded border ${
                        exists
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {exists ? `✓ ${suggestion}` : `+ ${suggestion}`}
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* Company Default Quotation & Invoice Custom Background Letterhead */}
          <div
            data-testid="company-quotation-letterhead-section"
            className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-3"
          >
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Quotation &amp; Invoice Custom Background Letterhead
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Upload your full-page A4 letterhead or watermark image. Can be applied as default for new Quotations and customized per document.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-20 h-28 rounded border border-slate-300 bg-white flex items-center justify-center overflow-hidden relative shrink-0">
                {quotationLetterheadBgDataUrl ? (
                  <img
                    src={quotationLetterheadBgDataUrl}
                    alt="Quotation Letterhead Background Preview"
                    className={`w-full h-full object-cover ${getLetterheadPreviewOpacityClass(
                      quotationLetterheadOpacity
                    )}`}
                  />
                ) : (
                  <span className="text-[10px] text-slate-400 text-center px-1">
                    No A4 BG
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer">
                    <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {quotationLetterheadBgDataUrl
                        ? 'Change Letterhead BG'
                        : 'Upload Letterhead BG'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      data-testid="comp-letterhead-upload"
                      onChange={handleQuotationLetterheadUpload}
                      className="sr-only"
                    />
                  </label>
                  {quotationLetterheadBgDataUrl && (
                    <button
                      type="button"
                      onClick={() => setQuotationLetterheadBgDataUrl('')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-700 mb-1">
                    <label htmlFor="comp-letterhead-opacity" className="font-medium">
                      Background Opacity
                    </label>
                    <span className="font-mono font-semibold text-slate-900">
                      {Math.round(quotationLetterheadOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    id="comp-letterhead-opacity"
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={quotationLetterheadOpacity}
                    onChange={(e) => setQuotationLetterheadOpacity(Number(e.target.value) || 0.14)}
                    className="w-full accent-orange-700"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? 'Saving...' : 'Save Company Details'}
            </button>
          </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
