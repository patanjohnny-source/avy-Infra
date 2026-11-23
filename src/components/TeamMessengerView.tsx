import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Download,
  FileText,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  User,
  Users,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { TeamMessage } from '../types/avy';
import { compressBoundedScreenshotDataUrl } from '../utils/idCardPdf';
import {
  buildMessengerThreadsForSession,
  canActorSeeMessage,
  resolveSessionMessengerActor,
  type MessengerThreadDescriptor,
} from '../utils/messenger';

const MAX_MESSENGER_DOC_BYTES = 250 * 1024;
const MAX_MESSENGER_DATA_URL_CHARS = 340000;

export function TeamMessengerView() {
  const {
    session,
    companyProfile,
    employees,
    towers,
    teamMessages,
    sendTeamMessage,
    markTeamThreadRead,
  } = useStore();

  const actor = useMemo(
    () => resolveSessionMessengerActor(session, companyProfile),
    [session, companyProfile]
  );

  const threads = useMemo(
    () =>
      buildMessengerThreadsForSession({
        session,
        companyProfile,
        employees,
        towers,
        messages: teamMessages,
      }),
    [session, companyProfile, employees, towers, teamMessages]
  );

  const [threadSearch, setThreadSearch] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [draftText, setDraftText] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentMimeType, setAttachmentMimeType] = useState('');
  const [attachmentDataUrl, setAttachmentDataUrl] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const employeeCodeById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.empCode])),
    [employees]
  );

  useEffect(() => {
    if (threads.length === 0) return;
    if (!selectedThreadId || !threads.some((t) => t.threadId === selectedThreadId)) {
      setSelectedThreadId(threads[0].threadId);
    }
  }, [threads, selectedThreadId]);

  const filteredThreads = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.subtitle.toLowerCase().includes(q)
    );
  }, [threads, threadSearch]);

  const activeThread: MessengerThreadDescriptor | null = useMemo(
    () => threads.find((t) => t.threadId === selectedThreadId) || threads[0] || null,
    [threads, selectedThreadId]
  );

  const activeMessages: TeamMessage[] = useMemo(() => {
    if (!activeThread || !actor || !session) return [];
    return teamMessages
      .filter(
        (m) =>
          m.threadId === activeThread.threadId &&
          canActorSeeMessage({ message: m, actor, session, employees })
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [activeThread, actor, session, employees, teamMessages]);

  useEffect(() => {
    if (!activeThread || activeThread.unreadCount === 0) return;
    void markTeamThreadRead(activeThread.threadId);
  }, [activeThread?.threadId, activeThread?.unreadCount, markTeamThreadRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeMessages.length, activeThread?.threadId]);

  if (!session || !actor) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-600">
        Sign in to access Team Messenger.
      </div>
    );
  }

  const clearAttachment = () => {
    setAttachmentName('');
    setAttachmentMimeType('');
    setAttachmentDataUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSendError('');
    setAttaching(true);
    try {
      const isImage = file.type.startsWith('image/');
      if (isImage) {
        const dataUrl = await compressBoundedScreenshotDataUrl(file, {
          maxWidth: 960,
          maxHeight: 1280,
          quality: 0.72,
          maxChars: 240000,
        });
        setAttachmentName(file.name);
        setAttachmentMimeType('image/jpeg');
        setAttachmentDataUrl(dataUrl);
      } else {
        if (file.size > MAX_MESSENGER_DOC_BYTES) {
          throw new Error(
            `File "${file.name}" is ${Math.round(file.size / 1024)} KB. Max allowed size for chat attachments is 250 KB.`
          );
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Could not read attachment file.'));
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
        if (dataUrl.length > MAX_MESSENGER_DATA_URL_CHARS) {
          throw new Error('Attachment encoded size exceeds cloud message limit (250 KB).');
        }
        setAttachmentName(file.name);
        setAttachmentMimeType(file.type || 'application/octet-stream');
        setAttachmentDataUrl(dataUrl);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unable to attach selected file.');
      clearAttachment();
    } finally {
      setAttaching(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThread || (!draftText.trim() && !attachmentDataUrl) || sending) return;
    const text = draftText.trim();
    setSending(true);
    setSendError('');
    try {
      await sendTeamMessage({
        channelType: activeThread.channelType,
        threadId: activeThread.threadId,
        body: text,
        projectId: activeThread.projectId,
        towerId: activeThread.towerId,
        towerName: activeThread.towerName,
        recipientId: activeThread.recipientId,
        recipientName: activeThread.recipientName,
        recipientRole: activeThread.recipientRole,
        ...(attachmentDataUrl
          ? {
              attachmentName,
              attachmentMimeType,
              attachmentDataUrl,
            }
          : {}),
      });
      setDraftText('');
      clearAttachment();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const broadcastThreads = filteredThreads.filter((t) => t.channelType === 'broadcast');
  const towerThreads = filteredThreads.filter((t) => t.channelType === 'tower');
  const directThreads = filteredThreads.filter((t) => t.channelType === 'direct');

  const formatMsgTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso.slice(0, 16);
    }
  };

  const renderThreadButton = (thread: MessengerThreadDescriptor) => {
    const active = activeThread?.threadId === thread.threadId;
    const Icon =
      thread.channelType === 'broadcast'
        ? Users
        : thread.channelType === 'tower'
          ? Building2
          : thread.recipientRole === 'admin'
            ? ShieldCheck
            : User;

    return (
      <button
        key={thread.threadId}
        type="button"
        onClick={() => setSelectedThreadId(thread.threadId)}
        data-testid={`messenger-thread-${thread.threadId}`}
        className={`w-full text-left px-3.5 py-2.5 flex items-start justify-between gap-2.5 transition-colors border-b border-slate-100 ${
          active ? 'bg-orange-50' : 'hover:bg-slate-50'
        }`}
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className={`p-1.5 rounded-md border shrink-0 mt-0.5 ${
              active
                ? 'bg-orange-700 text-white border-orange-700'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {thread.title}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {thread.lastMessage ? thread.lastMessage.body : thread.subtitle}
            </div>
          </div>
        </div>

        {thread.unreadCount > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold text-white bg-orange-700 rounded shrink-0">
            {thread.unreadCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4" data-testid="team-messenger-view">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Team &amp; Site Communication Messenger
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Real-time communication between Admin HQ, Site Supervisors, and Workforce across active towers.
          </p>
        </div>
        <div className="text-xs text-slate-600 font-mono">
          Signed in as <strong className="text-slate-900">{actor.name}</strong> ({actor.role.toUpperCase()})
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[560px]">
        {/* Left Thread Directory */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col max-h-[340px] lg:max-h-[620px]">
          <div className="p-3 border-b border-slate-200 bg-slate-50">
            <label htmlFor="messenger-search" className="sr-only">
              Search channels or people
            </label>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5"
                aria-hidden="true"
              />
              <input
                id="messenger-search"
                type="text"
                value={threadSearch}
                onChange={(e) => setThreadSearch(e.target.value)}
                placeholder="Search towers, supervisors, crew..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {broadcastThreads.length > 0 && (
              <div>
                <div className="px-3.5 py-1.5 text-[11px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  Company Broadcast
                </div>
                {broadcastThreads.map(renderThreadButton)}
              </div>
            )}

            {towerThreads.length > 0 && (
              <div>
                <div className="px-3.5 py-1.5 text-[11px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  Tower Crew Channels ({towerThreads.length})
                </div>
                {towerThreads.map(renderThreadButton)}
              </div>
            )}

            {directThreads.length > 0 && (
              <div>
                <div className="px-3.5 py-1.5 text-[11px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  Direct Messages ({directThreads.length})
                </div>
                {directThreads.map(renderThreadButton)}
              </div>
            )}

            {filteredThreads.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500">
                No matching channels or contacts found.
              </div>
            )}
          </div>
        </div>

        {/* Right Active Conversation Stream */}
        <div className="lg:col-span-8 flex flex-col min-h-[420px] max-h-[620px]">
          {activeThread ? (
            <>
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MessageCircle
                      className="w-4 h-4 text-orange-700 shrink-0"
                      aria-hidden="true"
                    />
                    <h2 className="text-sm font-semibold text-slate-900 truncate">
                      {activeThread.title}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {activeThread.subtitle}
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-500 shrink-0">
                  {activeMessages.length} msg{activeMessages.length === 1 ? '' : 's'}
                </span>
              </div>

              <div
                className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-slate-50/40"
                data-testid="messenger-message-stream"
              >
                {activeMessages.length === 0 ? (
                  <div className="py-16 text-center text-xs text-slate-500">
                    No messages in this conversation yet. Send the first site update below.
                  </div>
                ) : (
                  activeMessages.map((msg) => {
                    const isMine = msg.senderId === actor.actorId;
                    const senderEmpCode = employeeCodeById.get(msg.senderId);
                    const roleLabel =
                      msg.senderRole === 'admin'
                        ? 'Admin'
                        : msg.senderRole === 'supervisor'
                          ? 'Supervisor'
                          : 'Worker';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1">
                          <span className="font-semibold text-slate-700">
                            {isMine ? 'You' : msg.senderName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{roleLabel}</span>
                          {senderEmpCode && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{senderEmpCode}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{formatMsgTime(msg.createdAt)}</span>
                        </div>
                        <div
                          className={`max-w-[82%] px-3.5 py-2.5 rounded-lg text-sm leading-relaxed border space-y-2 ${
                            isMine
                              ? 'bg-orange-700 text-white border-orange-700'
                              : 'bg-white text-slate-900 border-slate-200'
                          }`}
                        >
                          <div>{msg.body}</div>
                          {msg.attachmentDataUrl && (
                            <div
                              data-testid={`messenger-attachment-${msg.id}`}
                              className={`rounded-md border p-2 ${
                                isMine
                                  ? 'bg-orange-800/60 border-orange-500/50 text-white'
                                  : 'bg-slate-50 border-slate-200 text-slate-800'
                              }`}
                            >
                              {msg.attachmentMimeType?.startsWith('image/') ||
                              msg.attachmentDataUrl.startsWith('data:image/') ? (
                                <div className="space-y-1.5">
                                  <img
                                    src={msg.attachmentDataUrl}
                                    alt={msg.attachmentName || 'Chat attachment'}
                                    className="max-h-52 w-auto rounded object-contain bg-white"
                                  />
                                  <a
                                    href={msg.attachmentDataUrl}
                                    download={msg.attachmentName || 'image.jpg'}
                                    className={`inline-flex items-center gap-1 text-[11px] font-medium underline ${
                                      isMine ? 'text-orange-100' : 'text-orange-700'
                                    }`}
                                  >
                                    <Download className="w-3 h-3" aria-hidden="true" />
                                    <span>{msg.attachmentName || 'Download photo'}</span>
                                  </a>
                                </div>
                              ) : (
                                <a
                                  href={msg.attachmentDataUrl}
                                  download={msg.attachmentName || 'attachment'}
                                  className="inline-flex items-center gap-2 text-xs font-medium underline"
                                >
                                  <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
                                  <span className="truncate max-w-[220px]">
                                    {msg.attachmentName || 'Download attachment'}
                                  </span>
                                  <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {sendError && (
                <div
                  role="alert"
                  className="px-4 py-2 text-xs font-medium text-red-800 bg-red-50 border-t border-red-200"
                >
                  {sendError}
                </div>
              )}

              {attachmentDataUrl && (
                <div
                  data-testid="messenger-attachment-chip"
                  className="px-3.5 py-2 bg-orange-50 border-t border-orange-200 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {attachmentMimeType.startsWith('image/') ? (
                      <img
                        src={attachmentDataUrl}
                        alt={attachmentName || 'Selected preview'}
                        className="w-9 h-9 rounded object-cover border border-orange-300 shrink-0 bg-white"
                      />
                    ) : (
                      <FileText className="w-4 h-4 text-orange-700 shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {attachmentName || 'Attachment ready'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Attached — click Send to deliver
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearAttachment}
                    aria-label="Remove message attachment"
                    className="p-1 text-slate-500 hover:text-red-700 rounded hover:bg-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <form
                onSubmit={handleSend}
                className="p-3.5 border-t border-slate-200 bg-white flex items-center gap-2 shrink-0"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                  onChange={handleAttachmentChange}
                  aria-label="Choose photo or document attachment"
                  data-testid="messenger-file-input"
                  className="sr-only"
                />
                <button
                  type="button"
                  disabled={attaching || sending}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach photo or document"
                  data-testid="messenger-attach-btn"
                  title="Attach photo, PDF, or site document (max 250 KB)"
                  className="inline-flex items-center justify-center p-2 text-slate-600 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50 shrink-0"
                >
                  <Paperclip className="w-4 h-4" aria-hidden="true" />
                </button>
                <label htmlFor="messenger-compose-input" className="sr-only">
                  Type a message
                </label>
                <input
                  id="messenger-compose-input"
                  data-testid="messenger-compose-input"
                  type="text"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder={`Message ${activeThread.title}...`}
                  className="flex-1 px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                />
                <button
                  type="submit"
                  disabled={(!draftText.trim() && !attachmentDataUrl) || sending || attaching}
                  data-testid="messenger-send-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 whitespace-nowrap"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                  <span>{sending ? 'Sending...' : 'Send'}</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
              Select a channel or colleague on the left to start messaging.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
