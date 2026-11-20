export interface SpeechRecognitionAlternativeLike {
  transcript?: string;
}

export interface SpeechRecognitionResultLike {
  isFinal?: boolean;
  0?: SpeechRecognitionAlternativeLike;
  length?: number;
}

export interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export const SITE_LOG_SPEECH_LANGUAGES = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi (हिन्दी)' },
  { code: 'te-IN', label: 'Telugu (తెలుగు)' },
  { code: 'ta-IN', label: 'Tamil (தமிழ்)' },
  { code: 'kn-IN', label: 'Kannada (ಕನ್ನಡ)' },
  { code: 'en-US', label: 'English (US)' },
] as const;

export function getSpeechRecognitionConstructor(
  win: unknown = typeof window !== 'undefined' ? window : undefined
): SpeechRecognitionCtor | null {
  if (!win || typeof win !== 'object') return null;
  const candidate = win as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  const ctor = candidate.SpeechRecognition || candidate.webkitSpeechRecognition;
  return typeof ctor === 'function' ? (ctor as SpeechRecognitionCtor) : null;
}

export function extractSpeechResultTranscript(
  results: ArrayLike<SpeechRecognitionResultLike> | undefined,
  startIndex = 0
): { finalTranscript: string; interimTranscript: string } {
  if (!results || typeof results.length !== 'number') {
    return { finalTranscript: '', interimTranscript: '' };
  }

  const finalParts: string[] = [];
  const interimParts: string[] = [];
  const safeStart = Math.max(0, startIndex);

  for (let i = safeStart; i < results.length; i += 1) {
    const result = results[i];
    const transcript = result?.[0]?.transcript?.trim() || '';
    if (!transcript) continue;
    if (result.isFinal) {
      finalParts.push(transcript);
    } else {
      interimParts.push(transcript);
    }
  }

  return {
    finalTranscript: finalParts.join(' ').trim(),
    interimTranscript: interimParts.join(' ').trim(),
  };
}

export function mergeTranscriptWithNotes(
  existingNotes: string,
  spokenTranscript: string,
  maxLength = 600
): string {
  const cleanSpoken = spokenTranscript.replace(/\s+/g, ' ').trim();
  if (!cleanSpoken) return existingNotes.slice(0, maxLength);

  if (!existingNotes.trim()) {
    return cleanSpoken.slice(0, maxLength);
  }

  const needsSpace = !/[\s\n]$/.test(existingNotes);
  const combined = `${existingNotes}${needsSpace ? ' ' : ''}${cleanSpoken}`;
  return combined.slice(0, maxLength);
}

export function formatSpeechErrorMessage(errorCode?: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Allow microphone access in your browser settings and try again.';
    case 'audio-capture':
      return 'No microphone was detected on this device.';
    case 'no-speech':
      return 'No speech detected. Tap the microphone again and speak clearly.';
    case 'network':
      return 'Voice recognition requires an active internet connection in this browser.';
    case 'aborted':
      return '';
    default:
      return 'Could not capture voice note. Please try again or type your site entry.';
  }
}
