import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  Mic,
  MicOff,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import {
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isSupervisorSession,
} from '../utils/authAccess';
import { compressBoundedScreenshotDataUrl } from '../utils/idCardPdf';
import {
  extractSpeechResultTranscript,
  formatSpeechErrorMessage,
  getSpeechRecognitionConstructor,
  mergeTranscriptWithNotes,
  SITE_LOG_SPEECH_LANGUAGES,
  type SpeechRecognitionLike,
} from '../utils/speechNotes';
import {
  ImageProofLightboxModal,
  type ProofLightboxPayload,
} from './ImageProofLightboxModal';

interface DailySiteLogViewProps {
  onOpenProjectLogsReport?: (projectId?: string) => void;
}

export function DailySiteLogView({ onOpenProjectLogsReport }: DailySiteLogViewProps) {
  const {
    session,
    projects: allProjects,
    towers: allTowers,
    dailySiteLogs = [],
    addDailySiteLog,
    deleteDailySiteLog,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);

  const projects = useMemo(
    () => getScopedProjects(session, allProjects, allTowers),
    [session, allProjects, allTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, allTowers), [session, allTowers]);

  const today = getTodayIso();

  // New log form state
  const [logDate, setLogDate] = useState(today);
  const [logProjectId, setLogProjectId] = useState(projects[0]?.id || '');
  const [logTowerId, setLogTowerId] = useState(towers[0]?.id || '');
  const [logNotes, setLogNotes] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Web Speech API voice-to-text dictation state
  const [speechLang, setSpeechLang] = useState<string>('en-IN');
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechStatusMsg, setSpeechStatusMsg] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const speechSupported = useMemo(() => Boolean(getSpeechRecognitionConstructor()), []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort ? recognitionRef.current.abort() : recognitionRef.current.stop();
        } catch {
          // Ignore teardown errors when stopping inactive recognition
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  // Feed filters
  const [filterTowerId, setFilterTowerId] = useState('all');
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [photoLightbox, setPhotoLightbox] = useState<ProofLightboxPayload | null>(null);

  const resolvedProjectId = useMemo(() => {
    if (logProjectId && projects.some((p) => p.id === logProjectId)) return logProjectId;
    return projects[0]?.id || '';
  }, [logProjectId, projects]);

  const formTowers = useMemo(
    () => towers.filter((t) => !resolvedProjectId || t.projectId === resolvedProjectId),
    [towers, resolvedProjectId]
  );

  const resolvedTowerId = useMemo(() => {
    if (logTowerId && formTowers.some((t) => t.id === logTowerId)) return logTowerId;
    return formTowers[0]?.id || '';
  }, [logTowerId, formTowers]);

  const scopedLogs = useMemo(() => {
    const allowedTowerIds = new Set(towers.map((t) => t.id));
    const q = searchQuery.trim().toLowerCase();
    return dailySiteLogs
      .filter((log) => {
        if (isSupervisor && !allowedTowerIds.has(log.towerId)) return false;
        if (filterTowerId !== 'all' && log.towerId !== filterTowerId) return false;
        if (filterDate && log.date !== filterDate) return false;
        if (
          q &&
          !log.notes.toLowerCase().includes(q) &&
          !log.towerName.toLowerCase().includes(q) &&
          !log.projectName.toLowerCase().includes(q) &&
          !log.loggedByName.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [dailySiteLogs, towers, isSupervisor, filterTowerId, filterDate, searchQuery]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    try {
      const compressed = await compressBoundedScreenshotDataUrl(file);
      setPhotoDataUrl(compressed);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to compress site photo.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const stopVoiceDictation = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors if already ended
      }
    }
    setIsListening(false);
    setInterimTranscript('');
  };

  const handleToggleVoiceNote = () => {
    setSpeechStatusMsg('');
    if (isListening) {
      stopVoiceDictation();
      return;
    }

    const SpeechCtor = getSpeechRecognitionConstructor();
    if (!SpeechCtor) {
      setSpeechStatusMsg(
        'Voice dictation via Web Speech API is not supported in this browser. Please type your entry or use Chrome/Edge/Safari.'
      );
      return;
    }

    try {
      const recognition = new SpeechCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLang;

      recognition.onstart = () => {
        setIsListening(true);
        setInterimTranscript('');
        setSpeechStatusMsg('');
      };

      recognition.onresult = (event) => {
        const { finalTranscript, interimTranscript: nextInterim } = extractSpeechResultTranscript(
          event.results,
          event.resultIndex ?? 0
        );
        if (finalTranscript) {
          setLogNotes((prev) => mergeTranscriptWithNotes(prev, finalTranscript, 600));
        }
        setInterimTranscript(nextInterim);
      };

      recognition.onerror = (event) => {
        const msg = formatSpeechErrorMessage(event?.error);
        if (msg) setSpeechStatusMsg(msg);
        setIsListening(false);
        setInterimTranscript('');
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimTranscript('');
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setSpeechStatusMsg(
        err instanceof Error ? err.message : 'Unable to start microphone voice recognition.'
      );
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

  const handleCreateLog = async (e: React.FormEvent) => {
    e.preventDefault();
    stopVoiceDictation();
    setSubmitError('');
    setSavedMsg('');
    if (!resolvedProjectId || !resolvedTowerId) {
      setSubmitError('Please select a project and tower before posting a log.');
      return;
    }
    if (!logNotes.trim()) {
      setSubmitError('Please write or dictate a short site progress note for this tower.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await addDailySiteLog({
        date: logDate,
        projectId: resolvedProjectId,
        towerId: resolvedTowerId,
        notes: logNotes.trim(),
        photoDataUrl: photoDataUrl || undefined,
      });
      setLogNotes('');
      setPhotoDataUrl('');
      setSpeechStatusMsg('');
      setSavedMsg(`Posted daily log for ${created.towerName} (${created.date}).`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save daily site log.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-orange-700" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-slate-900">
              Daily Site Log {isSupervisor ? '· Assigned Tower Journal' : '· Tower Progress & Photo Feed'}
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Capture daily tower-level observations, material deliveries, safety briefings, and site photos beyond flat-level status updates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="text-xs font-mono text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-md">
            {scopedLogs.length} {scopedLogs.length === 1 ? 'Entry' : 'Entries'} Visible
          </div>
          {onOpenProjectLogsReport && (
            <button
              type="button"
              data-testid="sitelogs-open-report-modal-btn"
              onClick={() => onOpenProjectLogsReport(resolvedProjectId || undefined)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Project Logs Report (CSV / PDF)</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Log Entry Composer */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <span>Add Daily Tower Site Log</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSupervisor
                ? 'Scoped to your assigned tower. Attach an optional site progress photo.'
                : 'Select any project & tower to post an official daily site log.'}
            </p>
          </div>

          <form onSubmit={handleCreateLog} className="space-y-3.5">
            {submitError && (
              <div
                role="alert"
                className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md"
              >
                {submitError}
              </div>
            )}
            {savedMsg && (
              <div className="p-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{savedMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="slog-date" className="block text-xs font-medium text-slate-700 mb-1">
                  Log Date
                </label>
                <input
                  id="slog-date"
                  type="date"
                  required
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="slog-proj" className="block text-xs font-medium text-slate-700 mb-1">
                  Project
                </label>
                <select
                  id="slog-proj"
                  required
                  value={resolvedProjectId}
                  onChange={(e) => {
                    const nextProj = e.target.value;
                    setLogProjectId(nextProj);
                    const nextTwr = towers.find((t) => t.projectId === nextProj)?.id || '';
                    setLogTowerId(nextTwr);
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
            </div>

            <div>
              <label htmlFor="slog-tower" className="block text-xs font-medium text-slate-700 mb-1">
                Tower
              </label>
              <select
                id="slog-tower"
                required
                value={resolvedTowerId}
                onChange={(e) => setLogTowerId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
              >
                {formTowers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <label htmlFor="slog-notes" className="block text-xs font-medium text-slate-700">
                  Daily Progress Entry
                </label>

                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={speechLang}
                    onChange={(e) => setSpeechLang(e.target.value)}
                    disabled={isListening}
                    aria-label="Voice dictation language"
                    className="px-2 py-1 text-[11px] bg-white border border-slate-300 rounded text-slate-700 disabled:opacity-60"
                  >
                    {SITE_LOG_SPEECH_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleToggleVoiceNote}
                    aria-pressed={isListening}
                    aria-label={isListening ? 'Stop voice dictation' : 'Record voice note'}
                    title={
                      speechSupported
                        ? isListening
                          ? 'Stop listening'
                          : 'Dictate site note with microphone'
                        : 'Web Speech API unavailable in this browser'
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors ${
                      isListening
                        ? 'bg-red-600 text-white border-red-700 animate-pulse hover:bg-red-700'
                        : 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100'
                    }`}
                  >
                    {isListening ? (
                      <>
                        <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Stop Voice</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Voice Note</span>
                      </>
                    )}
                  </button>

                  <span className="text-[11px] font-mono text-slate-400">
                    {logNotes.length}/600
                  </span>
                </div>
              </div>

              {(isListening || interimTranscript) && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-2 px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-900 rounded-md flex items-start gap-2"
                >
                  <Mic className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="font-semibold">Listening ({speechLang})… </span>
                    <span className="text-red-800 italic">
                      {interimTranscript || 'Speak your site progress note clearly.'}
                    </span>
                  </div>
                </div>
              )}

              {speechStatusMsg && (
                <div
                  role="alert"
                  className="mb-2 px-3 py-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md"
                >
                  {speechStatusMsg}
                </div>
              )}

              <textarea
                id="slog-notes"
                rows={4}
                maxLength={600}
                required
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                placeholder="Type or tap 'Voice Note' to speak: e.g. Adhesive pallet shifted to 14th floor lobby; corridor screed leveling checked with engineer..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              />
            </div>

            {/* Optional Site Photo Upload */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Camera className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                  <span>Tower Progress Photo (Optional)</span>
                </div>
                <label
                  htmlFor="slog-photo-input"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 cursor-pointer"
                >
                  <Upload className="w-3 h-3" aria-hidden="true" />
                  <span>{photoDataUrl ? 'Change Photo' : 'Attach Photo'}</span>
                </label>
                <input
                  ref={fileRef}
                  id="slog-photo-input"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="sr-only"
                />
              </div>

              {photoError && (
                <div className="text-[11px] text-red-700 font-medium">{photoError}</div>
              )}

              {photoDataUrl && (
                <div className="relative inline-block">
                  <img
                    src={photoDataUrl}
                    alt="Daily site log preview"
                    className="h-28 w-44 object-cover rounded border border-slate-300 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotoDataUrl('')}
                    aria-label="Remove attached photo"
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-red-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Posting Site Log...' : 'Post Daily Site Log'}
            </button>
          </form>
        </section>

        {/* Right: Filterable Daily Tower Log Feed */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Tower Daily Log History ({scopedLogs.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search notes or staff..."
                  aria-label="Search site logs"
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
                />
              </div>

              <select
                value={filterTowerId}
                onChange={(e) => setFilterTowerId(e.target.value)}
                aria-label="Filter site logs by tower"
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                <option value="all">All Visible Towers</option>
                {towers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  aria-label="Filter site logs by date"
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                />
                {filterDate && (
                  <button
                    type="button"
                    onClick={() => setFilterDate('')}
                    className="px-2 py-1.5 text-[11px] font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {scopedLogs.length === 0 ? (
              <div className="py-12 px-6 text-center text-sm text-slate-500">
                No daily site logs match this filter yet. Post a tower update on the left.
              </div>
            ) : (
              scopedLogs.map((log) => (
                <article key={log.id} className="p-5 hover:bg-slate-50/50 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 text-xs font-mono font-semibold text-slate-900 bg-slate-100 border border-slate-200 rounded">
                        {log.date}
                      </span>
                      <span className="px-2 py-0.5 text-xs font-semibold text-orange-900 bg-orange-50 border border-orange-200 rounded">
                        {log.towerName}
                      </span>
                      <span className="text-xs text-slate-500">{log.projectName}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 text-[11px] font-medium rounded border ${
                          log.loggedByRole === 'supervisor'
                            ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                            : 'bg-slate-900 text-white border-slate-900'
                        }`}
                      >
                        {log.loggedByRole === 'supervisor' ? 'Supervisor' : 'Admin'} · {log.loggedByName}
                      </span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => deleteDailySiteLog(log.id)}
                          aria-label={`Delete daily log from ${log.date}`}
                          className="p-1 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {log.notes}
                  </p>

                  {log.photoDataUrl && (
                    <div className="pt-1 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setPhotoLightbox({
                            title: `Daily Site Log — ${log.towerName}`,
                            subtitle: `${log.projectName} · ${log.date} · ${log.loggedByName}`,
                            imageDataUrl: log.photoDataUrl!,
                            date: log.date,
                          })
                        }
                        className="group relative inline-flex items-center gap-2 border border-slate-200 rounded-md p-1 bg-white hover:border-orange-400"
                      >
                        <img
                          src={log.photoDataUrl}
                          alt={`Site photo for ${log.towerName} on ${log.date}`}
                          className="h-20 w-32 object-cover rounded"
                        />
                        <span className="pr-2 inline-flex items-center gap-1 text-xs font-medium text-slate-700 group-hover:text-orange-700">
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>View Photo</span>
                        </span>
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      {photoLightbox && (
        <ImageProofLightboxModal
          payload={photoLightbox}
          onClose={() => setPhotoLightbox(null)}
        />
      )}
    </div>
  );
}
