import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, MessageSquare, X } from 'lucide-react';
import type { WhatsappMessagePayload } from '../types/avy';
import { buildMailtoUrl, buildWhatsappUrl, sanitizeWhatsappPhone } from '../utils/payroll';

interface WhatsappShareModalProps {
  payload: WhatsappMessagePayload | null;
  onClose: () => void;
  onShared?: (advanceId?: string, followUpAdvanceId?: string) => void;
}

export function WhatsappShareModal({ payload, onClose, onShared }: WhatsappShareModalProps) {
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (payload) {
      setMessage(payload.message);
      setPhone(payload.recipientPhone || '');
      setEmail(payload.recipientEmail || '');
      setEmailSubject(payload.emailSubject || payload.title || 'AVY INFRA Operations Report');
      setCopied(false);
    }
  }, [payload]);

  if (!payload) return null;

  const waUrl = buildWhatsappUrl(phone, message);
  const mailUrl = buildMailtoUrl(email, emailSubject, message);
  const formattedPhone = sanitizeWhatsappPhone(phone);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      onShared?.(payload.advanceId, payload.followUpAdvanceId);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-modal-title"
    >
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-5 h-5 text-emerald-700" aria-hidden="true" />
            <h2 id="whatsapp-modal-title" className="text-base font-semibold text-slate-900">
              {payload.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share modal"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pb-3 border-b border-slate-100">
            <span>
              Recipient: <strong className="text-slate-900">{payload.recipientName}</strong>
            </span>
            <span className="font-mono tabular-nums">
              {formattedPhone ? `+${formattedPhone}` : 'Broadcast / Group Share'}
              {email.trim() ? ` · ${email.trim()}` : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="wa-phone-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                WhatsApp Number (blank = pick in WhatsApp)
              </label>
              <input
                id="wa-phone-input"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9848011223"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
              />
            </div>

            <div>
              <label htmlFor="wa-email-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                Recipient Email (Optional for Mail)
              </label>
              <input
                id="wa-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. manager@avyinfra.in"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
              />
            </div>
          </div>

          <div>
            <label htmlFor="wa-email-subject" className="block text-xs font-medium text-slate-700 mb-1.5">
              Email Subject Line
            </label>
            <input
              id="wa-email-subject"
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="AVY INFRA Report"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
            />
          </div>

          <div>
            <label htmlFor="wa-message-textarea" className="block text-xs font-medium text-slate-700 mb-1.5">
              Message Preview (Editable for WhatsApp &amp; Email)
            </label>
            <textarea
              id="wa-message-textarea"
              rows={8}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2.5 text-sm font-mono leading-relaxed bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" aria-hidden="true" />
                <span>Copy Text</span>
              </>
            )}
          </button>

          <a
            href={mailUrl}
            onClick={() => onShared?.(payload.advanceId, payload.followUpAdvanceId)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <Mail className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <span>Send via Email</span>
          </a>

          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onShared?.(payload.advanceId, payload.followUpAdvanceId)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Send in WhatsApp</span>
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
