import React, { useId, useRef, useState } from 'react';
import { CheckCircle2, Eye, Loader2, ScanLine, Trash2, Upload } from 'lucide-react';
import type { OcrPaymentReceiptResult, PaymentMode } from '../types/avy';
import { compressBoundedScreenshotDataUrl } from '../utils/idCardPdf';
import { sanitizeIsoDateInput } from '../utils/ocrMatching';
import { ImageProofLightboxModal } from './ImageProofLightboxModal';

export interface PaymentProofState {
  paymentMode: PaymentMode;
  paymentApp: string;
  transactionId: string;
  upiId: string;
  proofImageDataUrl: string;
}

interface PaymentProofUploadBoxProps {
  value: PaymentProofState;
  onChange: (next: PaymentProofState) => void;
  onDetectedAmount?: (amount: number) => void;
  onDetectedDate?: (isoDate: string) => void;
  onDetectedNotes?: (notes: string) => void;
  title?: string;
}

const APP_PRESETS = ['GPay', 'PhonePe', 'Paytm', 'Bank Transfer'] as const;

export function PaymentProofUploadBox({
  value,
  onChange,
  onDetectedAmount,
  onDetectedDate,
  onDetectedNotes,
  title = 'UPI / Bank Payment Screenshot Reader & Proof Storage',
}: PaymentProofUploadBoxProps) {
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrSuccessMsg, setOcrSuccessMsg] = useState('');
  const [showLightbox, setShowLightbox] = useState(false);

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrError('');
    setOcrSuccessMsg('');
    setScanning(true);

    let storedDataUrl = '';
    try {
      // 1. Always compress DB-safe screenshot copy so proof is stored even if OCR isn't configured
      storedDataUrl = await compressBoundedScreenshotDataUrl(file, {
        maxWidth: 680,
        maxHeight: 1050,
        quality: 0.68,
        maxChars: 220000,
      });

      // Save preview immediately
      onChange({
        ...value,
        proofImageDataUrl: storedDataUrl,
      });

      // 2. High-res compressed image for sharp UTR & UPI ID extraction
      const ocrDataUrl = await compressBoundedScreenshotDataUrl(file, {
        maxWidth: 1100,
        maxHeight: 1600,
        quality: 0.82,
        maxChars: 900000,
      });

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 30000);
      let resp: Response;
      try {
        resp = await fetch('/api/ocr/payment-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl: ocrDataUrl }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const body = (await resp.json().catch(() => ({}))) as Partial<OcrPaymentReceiptResult> & {
        error?: string;
      };

      if (!resp.ok) {
        setOcrError(
          body.error ||
            'Screenshot saved to database, but auto-OCR could not read it. Please verify/enter Txn ID & UPI ID manually.'
        );
        return;
      }

      const nextMode: PaymentMode =
        body.paymentMode === 'bank_transfer' ? 'bank_transfer' : 'upi';

      const nextApp = (body.paymentApp || value.paymentApp || '').trim();
      const nextTxn = (body.transactionId || value.transactionId || '').trim();
      const nextUpi = (body.upiId || value.upiId || '').trim();

      onChange({
        paymentMode: nextMode,
        paymentApp: nextApp,
        transactionId: nextTxn,
        upiId: nextUpi,
        proofImageDataUrl: storedDataUrl,
      });

      if (typeof body.amount === 'number' && body.amount > 0 && onDetectedAmount) {
        onDetectedAmount(Math.round(body.amount));
      }
      if (body.date && onDetectedDate) {
        const cleanDate = sanitizeIsoDateInput(body.date, '');
        if (cleanDate) onDetectedDate(cleanDate);
      }
      if (body.notes && onDetectedNotes) {
        onDetectedNotes(body.notes);
      }

      const parts: string[] = [];
      if (nextApp) parts.push(nextApp);
      if (nextTxn) parts.push(`Txn: ${nextTxn}`);
      if (nextUpi) parts.push(`UPI/Ref: ${nextUpi}`);
      if (typeof body.amount === 'number' && body.amount > 0) parts.push(`₹${Math.round(body.amount)}`);
      setOcrSuccessMsg(
        parts.length > 0
          ? `Auto-read: ${parts.join(' · ')} (Screenshot attached)`
          : 'Screenshot attached. Verify transaction details below.'
      );
    } catch (err) {
      setOcrError(
        err instanceof Error
          ? err.message
          : 'Screenshot attached; enter Txn ID & UPI ID manually if needed.'
      );
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <ScanLine className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
          <span>{title}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <label
            htmlFor={fileInputId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            {scanning ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="w-3 h-3" aria-hidden="true" />
            )}
            <span>
              {scanning
                ? 'Reading Receipt...'
                : value.proofImageDataUrl
                  ? 'Replace Screenshot'
                  : 'Upload GPay / PhonePe / Bank Screenshot'}
            </span>
          </label>
          <input
            ref={fileRef}
            id={fileInputId}
            type="file"
            accept="image/*"
            onChange={handleFilePicked}
            className="sr-only"
          />
        </div>
      </div>

      <p className="text-[11px] text-slate-500 leading-snug">
        Upload GPay, PhonePe, Paytm, or Bank transfer screenshot to auto-read Transaction ID / UTR &amp; UPI ID and save the receipt in your database.
      </p>

      {ocrSuccessMsg && (
        <div className="p-2 text-[11px] font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>{ocrSuccessMsg}</span>
        </div>
      )}

      {ocrError && (
        <div
          role="alert"
          className="p-2 text-[11px] font-medium text-amber-900 bg-amber-50 border border-amber-300 rounded"
        >
          {ocrError}
        </div>
      )}

      {/* Payment App Preset Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500 mr-1">App / Channel:</span>
        {APP_PRESETS.map((app) => {
          const active = value.paymentApp.toLowerCase() === app.toLowerCase();
          return (
            <button
              key={app}
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  paymentApp: app,
                  paymentMode: app === 'Bank Transfer' ? 'bank_transfer' : 'upi',
                })
              }
              className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                active
                  ? 'bg-orange-700 text-white border-orange-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {app}
            </button>
          );
        })}
      </div>

      {/* Extracted / Manual Txn Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
            Payment App
          </label>
          <input
            type="text"
            value={value.paymentApp}
            onChange={(e) => onChange({ ...value, paymentApp: e.target.value })}
            placeholder="GPay / PhonePe / Paytm"
            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
            Transaction ID / UTR
          </label>
          <input
            type="text"
            value={value.transactionId}
            onChange={(e) => onChange({ ...value, transactionId: e.target.value })}
            placeholder="UTR / Ref Number"
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
            UPI ID / Bank A/C Ref
          </label>
          <input
            type="text"
            value={value.upiId}
            onChange={(e) => onChange({ ...value, upiId: e.target.value })}
            placeholder="name@okicici / A/C"
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
          />
        </div>
      </div>

      {/* Stored Screenshot Preview Thumbnail */}
      {value.proofImageDataUrl && (
        <div className="flex items-center justify-between gap-3 p-2 bg-white border border-slate-200 rounded">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={value.proofImageDataUrl}
              alt="Payment receipt thumbnail"
              className="w-11 h-14 object-cover rounded border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900">
                Screenshot Ready for Database Storage
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate">
                {Math.round(value.proofImageDataUrl.length / 1024)} KB compressed JPEG
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowLightbox(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
            >
              <Eye className="w-3 h-3" aria-hidden="true" />
              <span>View</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onChange({ ...value, proofImageDataUrl: '' });
                setOcrSuccessMsg('');
              }}
              aria-label="Remove attached payment screenshot"
              className="p-1 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {showLightbox && value.proofImageDataUrl && (
        <ImageProofLightboxModal
          payload={{
            title: 'Payment Screenshot Preview',
            imageDataUrl: value.proofImageDataUrl,
            paymentMode: value.paymentMode,
            paymentApp: value.paymentApp,
            transactionId: value.transactionId,
            upiId: value.upiId,
          }}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </div>
  );
}
