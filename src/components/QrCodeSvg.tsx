import React, { useEffect, useState } from 'react';
import { generateQrSvgString } from '../utils/qrProfile';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  label?: string;
  ariaLabel?: string;
  className?: string;
}

export function QrCodeSvg({
  value,
  size = 96,
  label = 'Employee verification QR code',
  ariaLabel,
  className = '',
}: QrCodeSvgProps) {
  const effectiveLabel = ariaLabel || label;
  const [svgMarkup, setSvgMarkup] = useState<string>('');

  useEffect(() => {
    let active = true;
    generateQrSvgString(value)
      .then((svg) => {
        if (active) setSvgMarkup(svg);
      })
      .catch(() => {
        if (active) setSvgMarkup('');
      });
    return () => {
      active = false;
    };
  }, [value]);

  if (!svgMarkup) {
    return (
      <div
        role="img"
        aria-label={effectiveLabel}
        style={{ width: size, height: size }}
        className={`bg-slate-100 border border-slate-200 rounded flex items-center justify-center text-[10px] font-mono text-slate-400 ${className}`}
      >
        QR
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={effectiveLabel}
      data-qr-url={value}
      style={{ width: size, height: size }}
      className={`bg-white p-1 rounded border border-slate-200 [&>svg]:w-full [&>svg]:h-full [&>svg]:block ${className}`}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
