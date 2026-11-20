import React from 'react';
import { Receipt, X } from 'lucide-react';
import { formatINR } from '../utils/payroll';

export interface ProofLightboxPayload {
  title: string;
  subtitle?: string;
  imageDataUrl: string;
  paymentMode?: string;
  paymentApp?: string;
  transactionId?: string;
  upiId?: string;
  amount?: number;
  date?: string;
}

interface ImageProofLightboxModalProps {
  payload: ProofLightboxPayload | null;
  onClose: () => void;
}

export function ImageProofLightboxModal({ payload, onClose }: ImageProofLightboxModalProps) {
  if (!payload) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-lightbox-title"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Receipt className="w-4 h-4 text-orange-700 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="proof-lightbox-title" className="text-sm font-semibold text-slate-900 truncate">
                {payload.title}
              </h2>
              {payload.subtitle && (
                <p className="text-xs text-slate-500 truncate">{payload.subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment screenshot preview"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md p-3">
            {payload.date && (
              <div>
                <div className="text-[11px] text-slate-500">Date</div>
                <div className="font-mono font-semibold text-slate-900">{payload.date}</div>
              </div>
            )}
            {typeof payload.amount === 'number' && (
              <div>
                <div className="text-[11px] text-slate-500">Amount</div>
                <div className="font-mono font-semibold text-slate-900">
                  {formatINR(payload.amount)}
                </div>
              </div>
            )}
            <div>
              <div className="text-[11px] text-slate-500">App / Mode</div>
              <div className="font-medium text-slate-900">
                {payload.paymentApp || payload.paymentMode?.toUpperCase() || 'Digital'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Transaction ID / UTR</div>
              <div className="font-mono font-semibold text-slate-900 break-all">
                {payload.transactionId || 'Not captured'}
              </div>
            </div>
            {payload.upiId && (
              <div className="col-span-2 sm:col-span-4 pt-1 border-t border-slate-200">
                <span className="text-[11px] text-slate-500">UPI / Account Ref: </span>
                <span className="font-mono font-medium text-slate-900">{payload.upiId}</span>
              </div>
            )}
          </div>

          <div className="bg-slate-100 border border-slate-200 rounded-md p-2 flex items-center justify-center">
            <img
              src={payload.imageDataUrl}
              alt={payload.title}
              className="max-h-[60vh] w-auto object-contain rounded"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
