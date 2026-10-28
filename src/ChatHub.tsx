import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Users, Send, Loader2, Paperclip, Image as ImageIcon, FileText, X, User, ChevronUp, Settings, CheckCircle2 } from "lucide-react";
import Markdown from "react-markdown";

type Room = "ai" | "group";
type ChatAttachment = { data: string; mimeType: string; name?: string };
type ChatMessage = {
  id: number;
  room: Room;
  client_id: string;
  role: "user" | "assistant";
  sender: string;
  content: string;
  attachments: ChatAttachment[];
  created_at: string;
};

const API_MODELS = [
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" }
];
const sorted = (messages: ChatMessage[]) =>
  [...new Map(messages.map(msg => [msg.id, msg])).values()].sort((a, b) => a.id - b.id);

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.error || "Serverfehler (" + res.status + ")";
  } catch {
    return "Serverfehler (" + res.status + ")";
  }
}

export default function ChatHub() {
  const [room, setRoom] = useState<Room>("ai");
  const clientId = useMemo(() => {
    const existing = localStorage.getItem("kokjoke-chat-id");
    if (existing && /^[a-f0-9-]{36}$/i.test(existing)) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem("kokjoke-chat-id", id);
    return id;
  }, []);
  const [username, setUsername] = useState(() => localStorage.getItem("kokjoke-chat-name") || "");
  const [model, setModel] = useState(() => localStorage.getItem("kokjoke-ai-model") || "gemini-3-flash-preview");
  const [showSettings, setShowSettings] = useState(false);
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [groupMessages, setGroupMessages] = useState<ChatMessage[]>([]);
  const [canLoadMore, setCanLoadMore] = useState({ ai: false, group: false });
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [status, setStatus] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentMessages = room === "ai" ? aiMessages : groupMessages;

  useEffect(() => {
    localStorage.setItem("kokjoke-chat-name", username);
  }, [username]);
  useEffect(() => {
    localStorage.setItem("kokjoke-ai-model", model);
  }, [model]);

  useEffect(() => {
    const load = async (target: Room) => {
      const params = new URLSearchParams({ room: target, clientId });
      const res = await fetch("/api/chat/messages?" + params.toString());
      if (!res.ok) throw new Error(await readError(res));
      const items: ChatMessage[] = await res.json();
      if (target === "ai") setAiMessages(items);
      else setGroupMessages(items);
      setCanLoadMore(prev => ({ ...prev, [target]: items.length === 100 }));
    };
    Promise.all([load("ai"), load("group")])
      .catch(err => setStatus(err.message || "Chat konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/chat/messages?room=group");
        if (!res.ok) return;
        const items: ChatMessage[] = await res.json();
        setGroupMessages(prev => sorted([...prev, ...items]));
      } catch {
        // Background polling must not interrupt composing a message.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room, aiMessages.length, groupMessages.length, sending]);

  async function loadOlder() {
    const oldest = currentMessages.find(msg => msg.id > 0)?.id;
    if (!oldest || olderLoading) return;
    setOlderLoading(true);
    try {
      const params = new URLSearchParams({ room, clientId, before: String(oldest) });
      const res = await fetch("/api/chat/messages?" + params);
      if (!res.ok) throw new Error(await readError(res));
      const items: ChatMessage[] = await res.json();
      if (room === "ai") setAiMessages(prev => sorted([...items, ...prev]));
      else setGroupMessages(prev => sorted([...items, ...prev]));
      setCanLoadMore(prev => ({ ...prev, [room]: items.length === 100 }));
    } catch (err: any) {
      setStatus(err.message || "Ältere Nachrichten konnten nicht geladen werden.");
    } finally {
      setOlderLoading(false);
    }
  }

  async function addFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    for (const file of selected) {
      if (attachments.length >= 3) { setStatus("Maximal drei Anhänge."); break; }
      if (file.size > 2000000) { setStatus("Datei zu groß: maximal 2 MB pro Datei."); continue; }
      if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/plain)$/.test(file.type)) {
        setStatus("Nur Bilder, PDFs und Textdateien werden unterstützt."); continue;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setAttachments(prev => [...prev, { data, mimeType: file.type, name: file.name }].slice(0, 3));
    }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith("image/"));
      if (files.length) void addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [attachments.length]);

  async function send() {
    const content = input.trim();
    if ((!content && !attachments.length) || sending) return;
    if (room === "group" && !username.trim()) {
      setStatus("Bitte zuerst deinen Namen für den Gruppenchat eingeben.");
      setShowSettings(true);
      return;
    }
    const sentAttachments = [...attachments];
    const target = room;
    const localId = -Date.now();
    const optimistic: ChatMessage = {
      id: localId,
      room: target,
      client_id: target === "ai" ? clientId : "",
      role: "user",
      sender: target === "ai" ? "Du" : username.trim(),
      content,
      attachments: sentAttachments,
      created_at: new Date().toISOString()
    };
    setInput("");
    setAttachments([]);
    setStatus("");
    setSending(true);

    if (target === "ai") setAiMessages(prev => [...prev, optimistic]);
    else setGroupMessages(prev => [...prev, optimistic]);

    try {
      if (target === "group") {
        const res = await fetch("/api/chat/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender: username.trim(), content, attachments: sentAttachments })
        });
        if (!res.ok) throw new Error(await readError(res));
        const saved: ChatMessage = await res.json();
        setGroupMessages(prev => sorted(prev.map(msg => msg.id === localId ? saved : msg)));
      } else {
        const res = await fetch("/api/chat/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, content, attachments: sentAttachments, model })
        });
        if (!res.ok) throw new Error(await readError(res));
        if (!res.body) throw new Error("Der Browser unterstützt kein Chat-Streaming.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const botId = localId - 1;
        let hasBot = false;
        let hadError = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const event of events) {
            const line = event.split("\n").find(value => value.startsWith("data: "));
            if (!line) continue;
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "user") {
              setAiMessages(prev => sorted(prev.map(msg => msg.id === localId ? payload.message : msg)));
            } else if (payload.type === "delta") {
              if (!hasBot) {
                hasBot = true;
                const bot: ChatMessage = {
                  ...optimistic,
                  id: botId,
                  role: "assistant",
                  sender: "KI",
                  attachments: [],
                  content: ""
                };
                setAiMessages(prev => [...prev, bot]);
              }
              setAiMessages(prev => prev.map(msg =>
                msg.id === botId ? { ...msg, content: msg.content + payload.text } : msg
              ));
            } else if (payload.type === "done") {
              if (hasBot) setAiMessages(prev => sorted(prev.map(msg => msg.id === botId ? payload.message : msg)));
              else setAiMessages(prev => sorted([...prev, payload.message]));
            } else if (payload.type === "error") {
              hadError = true;
              setStatus(payload.error);
              if (hasBot) setAiMessages(prev => prev.filter(msg => msg.id !== botId));
            }
          }
        }
        if (hadError) return;
      }
    } catch (err: any) {
      setStatus(err.message || "Nachricht konnte nicht gesendet werden.");
      if (target === "group") {
        setGroupMessages(prev => prev.filter(msg => msg.id !== localId));
      } else {
        setAiMessages(prev => prev.filter(msg => msg.id !== localId));
        // The server may already have persisted this message; refresh the history.
        fetch("/api/chat/messages?room=ai&clientId=" + encodeURIComponent(clientId))
          .then(res => res.ok ? res.json() : null)
          .then(items => { if (items) setAiMessages(items); })
          .catch(() => {});
      }
      setInput(content);
      setAttachments(sentAttachments);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex-1 flex flex-col max-w-4xl mx-auto w-full min-h-[65vh] bg-zinc-900/50 rounded-3xl border border-zinc-800 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-3 bg-zinc-900/80 border-b border-zinc-800">
        <div className="flex rounded-xl bg-zinc-950 border border-zinc-800 p-1 gap-1">
          <button type="button" onClick={() => { setRoom("ai"); setStatus(""); setAttachments([]); }}
            className={"flex gap-2 items-center rounded-lg px-3 py-2 text-sm " + (room === "ai" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-white")}>
            <Bot size={16} /> KI-Chat
          </button>
          <button type="button" onClick={() => { setRoom("group"); setStatus(""); setAttachments([]); }}
            className={"flex gap-2 items-center rounded-lg px-3 py-2 text-sm " + (room === "group" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-white")}>
            <Users size={16} /> Gruppenchat
          </button>
        </div>
        <button type="button" title="Chat-Einstellungen" onClick={() => setShowSettings(value => !value)}
          className={"p-2 rounded-lg " + (showSettings ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800")}>
          <Settings size={19} />
        </button>
      </div>

      {showSettings && (
        <div className="p-4 border-b border-zinc-800 bg-zinc-900 grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-xs text-zinc-400">Dein Name im Gruppenchat</label>
            <input value={username} onChange={e => setUsername(e.target.value.slice(0, 40))}
              placeholder="Name eingeben" maxLength={40}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3 text-sm text-white outline-none focus:border-emerald-500" />
            <p className="text-xs text-zinc-500">Auf diesem Gerät gespeichert.</p>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-zinc-400">KI-Modell (API-Schlüssel ist zentral hinterlegt)</label>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3 text-sm text-white outline-none">
              {API_MODELS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <span className="flex gap-1 items-center text-xs text-emerald-500"><CheckCircle2 size={13} /> Kein API-Key im Browser nötig</span>
          </div>
        </div>
      )}

      <div className="px-5 py-2 border-b border-zinc-800 flex flex-wrap gap-2 items-center justify-between text-xs text-zinc-400">
        <span>{room === "ai" ? "Dein KI-Verlauf wird dauerhaft gespeichert (pro Browser)." : "Gemeinsamer Chat: Nachrichten bleiben gespeichert und erscheinen automatisch."}</span>
        {room === "group" && <span>{username ? "Du schreibst als " + username : "Name unter Einstellungen festlegen"}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-h-[68vh] min-h-[30vh]">
        {canLoadMore[room] && (
          <button disabled={olderLoading} onClick={loadOlder}
            className="mx-auto flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 py-2">
            {olderLoading ? <Loader2 className="animate-spin" size={14} /> : <ChevronUp size={14} />}
            Ältere Nachrichten laden
          </button>
        )}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 size={28} className="text-emerald-500 animate-spin" /></div>
        ) : currentMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-zinc-500 py-16 gap-3">
            {room === "ai" ? <Bot size={35} /> : <Users size={35} />}
            <p>{room === "ai" ? "Starte deine erste Unterhaltung mit der KI." : "Noch keine Nachrichten. Schreib die erste Gruppennachricht."}</p>
          </div>
        ) : currentMessages.map(msg => {
          const mine = room === "ai" ? msg.role === "user" : msg.sender === username.trim();
          return (
            <div key={msg.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
              <div className={"flex gap-2 max-w-[90%] md:max-w-[82%] " + (mine ? "flex-row-reverse" : "")}>
                <div className={"w-8 h-8 rounded-full flex shrink-0 items-center justify-center " +
                  (mine ? "bg-emerald-900/50 text-emerald-400" : "bg-zinc-800 text-zinc-400")}>
                  {room === "ai" && msg.role === "assistant" ? <Bot size={17} /> : <User size={17} />}
                </div>
                <div className={"p-3.5 rounded-2xl min-w-0 " +
                  (mine ? "bg-emerald-700 text-white rounded-tr-none" : "bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-tl-none")}>
                  {room === "group" && <div className={"text-xs font-semibold mb-2 " + (mine ? "text-emerald-100" : "text-emerald-400")}>{msg.sender || "Gast"}</div>}
                  {msg.attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.attachments.map((att, idx) => (
                        <div key={idx} className="rounded-lg border border-white/10 overflow-hidden">
                          {att.mimeType.startsWith("image/") ? (
                            <a href={"data:" + att.mimeType + ";base64," + att.data} download={att.name || "bild"}>
                              <img src={"data:" + att.mimeType + ";base64," + att.data} alt={att.name || "Bild"} className="max-h-44 max-w-48 object-contain" />
                            </a>
                          ) : (
                            <a className="flex items-center gap-2 p-2 text-xs hover:underline" href={"data:" + att.mimeType + ";base64," + att.data} download={att.name || "dokument"}>
                              <FileText size={16} /> {att.name || "Dokument"}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="prose prose-invert prose-sm max-w-none break-words"><Markdown>{msg.content}</Markdown></div>
                  <div className={"mt-2 text-[10px] opacity-55 " + (mine ? "text-right" : "")}>
                    {new Date(msg.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {sending && room === "ai" && (
          <div className="flex items-center gap-2 text-sm text-zinc-400 pl-10">
            <Loader2 size={15} className="animate-spin text-emerald-400" /> KI antwortet...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-zinc-900 border-t border-zinc-800 space-y-3">
        {status && <p role="alert" className="text-sm text-amber-300 bg-amber-950/30 rounded-xl p-3">{status}</p>}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-zinc-800 border border-zinc-700">
                {att.mimeType.startsWith("image/") ? <ImageIcon size={15} /> : <FileText size={15} />}
                <span className="max-w-32 truncate">{att.name}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}><X size={15} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center">
          <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden"
            onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={documentRef} type="file" accept=".pdf,.txt" multiple className="hidden"
            onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
          <button onClick={() => photoRef.current?.click()} className="p-2 text-zinc-400 hover:text-emerald-400" title="Bild anhängen"><ImageIcon size={20} /></button>
          <button onClick={() => documentRef.current?.click()} className="p-2 text-zinc-400 hover:text-emerald-400" title="Dokument anhängen"><Paperclip size={20} /></button>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void send(); }}
            placeholder={room === "ai" ? "Frage die KI..." : "Nachricht an die Gruppe..."}
            className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-3 text-sm outline-none focus:border-emerald-500 text-white" />
          <button disabled={sending || (!input.trim() && !attachments.length)}
            onClick={() => void send()} className="bg-emerald-600 rounded-xl p-3 disabled:opacity-40 hover:bg-emerald-500 text-white" title="Senden">
            {sending ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
          </button>
        </div>
      </div>
    </section>
  );
}
