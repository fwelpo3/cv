import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, Image as ImageIcon, Loader2, Plus, Download, MessageSquare, Send, Bot, User, Settings, Key, Paperclip, FileText, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';

interface ImageRecord {
  id: number;
  name: string;
  data: string;
  description?: string;
  created_at: string;
}

interface ChatAttachment {
  data: string; // base64
  mimeType: string;
  name?: string;
}

interface Message {
  role: 'user' | 'bot';
  content: string;
  timestamp: Date;
  attachments?: ChatAttachment[];
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<'gallery' | 'chat'>('gallery');
  
  // Gallery State
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Chat State
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'bot',
      content: 'Hallo! Ich bin dein KI-Assistent. Wie kann ich dir heute helfen?',
      timestamp: new Date(),
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [customApiKey, setCustomApiKey] = useState('AIzaSyC6HsCIbhS49UVIlLLXeUQS2dnHeMhavxI');
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [showSettings, setShowSettings] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  
  const galleryFileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatDocInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const generateWithRetry = async (ai: any, model: string, contents: any, config: any, maxRetries = 5) => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        setChatStatus(i > 0 ? `Google ist beschäftigt. Versuch ${i + 1}/${maxRetries}...` : "KI generiert Antwort...");
        return await ai.models.generateContentStream({ model, contents, config });
      } catch (error: any) {
        lastError = error;
        const errorMsg = error?.message?.toLowerCase() || '';
        if (errorMsg.includes('503') || errorMsg.includes('high demand') || errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('unavailable')) {
          const waitTime = Math.pow(2, i) * 1500 + Math.random() * 500;
          setChatStatus(`Warte ${Math.round(waitTime/1000)}s vor nächstem Versuch...`);
          await sleep(waitTime);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };

  const testApiKey = async () => {
    if (!customApiKey.trim()) return;
    setIsTestingKey(true);
    try {
      const ai = new GoogleGenAI({ apiKey: customApiKey.trim() });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "Hi",
      });
      if (response.text) {
        alert("✅ Erfolg! Die KI hat geantwortet.");
      } else {
        alert("⚠️ Verbindung steht, aber keine Textantwort erhalten.");
      }
    } catch (error: any) {
      console.error("API Test Error:", error);
      let msg = error.message || "Unbekannter Fehler";
      if (msg.includes("API_KEY_INVALID")) msg = "Der API Key ist ungültig. Bitte prüfe ihn erneut.";
      if (msg.includes("403")) msg = "Fehler 403: Zugriff verweigert. Ist die 'Generative Language API' in deinem Google Account aktiviert?";
      if (msg.includes("429")) msg = "Fehler 429: Zu viele Anfragen (Rate Limit).";
      alert(`❌ Test fehlgeschlagen:\n${msg}`);
    } finally {
      setIsTestingKey(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchImages();
    }

    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (!isLoggedIn) return;
      
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter(item => item.type.indexOf('image') !== -1);
      if (imageItems.length === 0) return;

      if (activeTab === 'gallery') setUploading(true);

      const uploadPromises = imageItems.map(item => {
        const blob = item.getAsFile();
        if (!blob) return Promise.resolve();

        return new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const data = event.target?.result as string;
            if (activeTab === 'gallery') {
              try {
                await uploadImage(`pasted-${Date.now()}.png`, data, true);
              } catch (err) {
                console.error("Paste upload failed", err);
              }
            } else {
              const mimeType = data.split(';')[0].split(':')[1];
              const base64 = data.split(',')[1];
              setChatAttachments(prev => [...prev, { data: base64, mimeType, name: `pasted-image-${Date.now()}.png` }]);
            }
            resolve();
          };
          reader.readAsDataURL(blob);
        });
      });

      Promise.all(uploadPromises).then(async () => {
        if (activeTab === 'gallery') {
          await fetchImages();
          setUploading(false);
        }
      });
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [isLoggedIn, activeTab]);

  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  const fetchImages = async () => {
    try {
      const res = await fetch('/api/images');
      const contentType = res.headers.get("content-type");
      
      if (!res.ok) {
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Failed to fetch images');
        } else {
          const text = await res.text();
          console.error("Server error text:", text);
          throw new Error(`Server Fehler (500): Bitte prüfe die Vercel Logs und Environment Variables.`);
        }
      }
      
      const data = await res.json();
      setImages(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load images. Check your DATABASE_URL.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === '1979') {
      setIsLoggedIn(true);
    } else {
      setPassword('');
    }
  };

  const uploadImage = async (name: string, data: string, silent = false) => {
    if (!silent) setUploading(true);
    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data }),
      });
      if (!res.ok) throw new Error('Upload failed');
      if (!silent) await fetchImages();
    } catch (err) {
      if (!silent) alert('Fehler beim Hochladen des Bildes.');
      throw err;
    } finally {
      if (!silent) setUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        
        await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const base64String = reader.result as string;
              await uploadImage(file.name, base64String, true);
              resolve(null);
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      await fetchImages();
    } catch (err) {
      alert('Fehler beim Hochladen eines oder mehrerer Bilder.');
    } finally {
      setUploading(false);
      if (galleryFileInputRef.current) galleryFileInputRef.current.value = '';
    }
  };

  const deleteImage = async (id: number) => {
    if (!confirm('Are you sure you want to delete this image?')) return;
    try {
      const res = await fetch(`/api/images/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setImages(images.filter(img => img.id !== id));
    } catch (err) {
      alert('Failed to delete image.');
    }
  };

  const downloadImage = (data: string, name: string) => {
    const link = document.createElement('a');
    link.href = data;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleChatFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'doc') => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result as string;
        const mimeType = file.type;
        const base64 = data.split(',')[1];
        setChatAttachments(prev => [...prev, { data: base64, mimeType, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setChatAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleChatSend = async (retryMessage?: { content: string, attachments?: ChatAttachment[] }) => {
    const content = retryMessage ? retryMessage.content : chatInput;
    const attachments = retryMessage ? retryMessage.attachments : chatAttachments;

    if ((!content.trim() && (!attachments || attachments.length === 0)) || isChatLoading) return;

    // Construct history from existing messages
    const history = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [
        { text: msg.content || " " }, // Ensure text is never empty
        ...(msg.attachments?.map(att => ({
          inlineData: {
            data: att.data,
            mimeType: att.mimeType
          }
        })) || [])
      ]
    }));

    // Add the current message to history for the API call
    const currentTurn = {
      role: 'user' as const,
      parts: [
        { text: content || (attachments && attachments.length > 0 ? "Analysiere diese Anhänge." : " ") },
        ...(attachments?.map(att => ({
          inlineData: {
            data: att.data,
            mimeType: att.mimeType
          }
        })) || [])
      ]
    };

    if (!retryMessage) {
      const userMessage: Message = {
        role: 'user',
        content: content,
        timestamp: new Date(),
        attachments: attachments && attachments.length > 0 ? [...attachments] : undefined,
      };
      setMessages((prev) => [...prev, userMessage]);
      setChatInput('');
      setChatAttachments([]);
    }
    
    setIsChatLoading(true);

    try {
      const apiKey = customApiKey.trim();
      if (!apiKey) {
        throw new Error('KEIN_API_KEY');
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const stream = await generateWithRetry(
        ai,
        selectedModel,
        [...history, currentTurn], // Send full history
        {
          systemInstruction: "Du bist ein hilfreicher, freundlicher und prägnanter KI-Assistent. Antworte auf Deutsch. Du hast Zugriff auf den bisherigen Chatverlauf und kannst dich auf frühere Aussagen beziehen. Du kannst Bilder und Dokumente analysieren.",
        }
      );

      let fullContent = '';
      const botMessageId = Date.now();
      
      // Add initial empty bot message for streaming
      setMessages(prev => [...prev, {
        role: 'bot',
        content: '',
        timestamp: new Date()
      }]);

      setChatStatus(null);

      for await (const chunk of stream) {
        const chunkText = chunk.text;
        if (chunkText) {
          fullContent += chunkText;
          setMessages(prev => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = {
              ...newMessages[newMessages.length - 1],
              content: fullContent
            };
            return newMessages;
          });
        }
      }
    } catch (error: any) {
      console.error('Error calling Gemini API:', error);
      let errorMessage = 'Ups, da ist etwas schiefgelaufen. Bitte versuche es später noch einmal.';
      
      const errorMsg = error?.message?.toLowerCase() || '';
      
      if (error?.message === 'KEIN_API_KEY') {
        errorMessage = 'Bitte gib zuerst deinen eigenen Gemini API-Key in den Einstellungen (Zahnrad-Icon oben rechts) ein, um den Chat zu nutzen.';
        setShowSettings(true);
      } else if (errorMsg.includes('503') || errorMsg.includes('high demand')) {
        errorMessage = 'Die KI ist gerade sehr beschäftigt (Hohe Nachfrage). Ich habe es bereits mehrfach versucht, aber Google antwortet nicht. Bitte warte kurz und klicke dann auf "Erneut versuchen" oder wechsle das Modell in den Einstellungen.';
      } else if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate limit')) {
        errorMessage = 'Das Nutzungslimit (Quota) wurde erreicht. Bitte warte etwa eine Minute, bevor du es erneut versuchst.';
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          content: errorMessage,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full max-w-md text-center"
        >
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                const val = e.target.value;
                setPassword(val);
                if (val === '1979') {
                  setIsLoggedIn(true);
                }
              }}
              placeholder="was geht"
              className="w-full bg-transparent border-none text-zinc-800 text-center text-2xl font-light tracking-widest outline-none placeholder:text-zinc-800 cursor-default focus:placeholder:opacity-0 transition-all"
              autoFocus
            />
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-900/20">
                <ImageIcon size={24} />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight uppercase text-white">kokjoke</h1>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Private Space</p>
              </div>
            </div>

            <nav className="hidden md:flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
              <button
                onClick={() => setActiveTab('gallery')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'gallery' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <ImageIcon size={16} />
                Galerie
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'chat' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <MessageSquare size={16} />
                AI Chat
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {activeTab === 'gallery' && (
              <button
                onClick={() => galleryFileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-emerald-900/20"
              >
                {uploading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                <span className="font-medium hidden sm:inline">Upload</span>
              </button>
            )}
            <input type="file" ref={galleryFileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" multiple />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 flex flex-col">
        {activeTab === 'gallery' ? (
          <>
            {error && (
              <div className="bg-red-950/30 border border-red-900/50 text-red-400 p-4 rounded-2xl mb-8 flex items-center gap-3">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <p className="font-medium">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <Loader2 className="animate-spin text-emerald-500" size={48} />
                <p className="text-zinc-500 font-medium">Lade Galerie...</p>
              </div>
            ) : images.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 border-2 border-dashed border-zinc-800 rounded-3xl bg-zinc-900/30">
                <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center text-zinc-600 mb-4">
                  <Upload size={32} />
                </div>
                <h2 className="text-xl font-semibold text-zinc-300">Noch keine Bilder</h2>
                <p className="text-zinc-500 mt-1">Lade dein erstes Bild hoch.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <AnimatePresence mode="popLayout">
                  {images.map((image) => (
                    <motion.div
                      key={image.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="group relative bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-xl hover:border-zinc-700 transition-all"
                    >
                      <div className="aspect-square bg-zinc-950 overflow-hidden">
                        <img src={image.data} alt={image.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100" referrerPolicy="no-referrer" />
                      </div>
                      <div className="p-4 bg-zinc-900">
                        <div className="flex items-center justify-between mb-2">
                          <div className="truncate pr-4">
                            <p className="text-sm font-medium truncate text-zinc-100">{image.name}</p>
                            <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{new Date(image.created_at).toLocaleDateString()}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => downloadImage(image.data, image.name)} 
                              className="p-2 text-zinc-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors"
                              title="Download"
                            >
                              <Download size={16} />
                            </button>
                            <button 
                              onClick={() => deleteImage(image.id)} 
                              className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full bg-zinc-900/50 rounded-3xl border border-zinc-800 overflow-hidden relative">
            {/* Chat Settings Header */}
            <div className="px-6 py-3 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  {selectedModel}
                </div>
                <button 
                  onClick={() => {
                    if (confirm("Chatverlauf wirklich löschen?")) {
                      setMessages([{
                        role: 'bot',
                        content: 'Chat gelöscht. Wie kann ich dir jetzt helfen?',
                        timestamp: new Date(),
                      }]);
                    }
                  }}
                  className="text-[10px] uppercase tracking-wider font-bold text-zinc-600 hover:text-red-400 transition-colors"
                >
                  Verlauf leeren
                </button>
              </div>
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:bg-zinc-800'}`}
              >
                <Settings size={18} />
              </button>
            </div>

            {/* Settings Panel Overlay */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="absolute top-[53px] left-0 right-0 z-10 bg-zinc-900 border-b border-zinc-800 p-6 shadow-2xl"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 flex items-center gap-2">
                        <Key size={12} />
                        Dein API Key (Erforderlich)
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="password"
                          value={customApiKey}
                          onChange={(e) => setCustomApiKey(e.target.value)}
                          placeholder="Dein Gemini API Key..."
                          className={`flex-1 bg-zinc-950 border rounded-xl px-4 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500 outline-none transition-colors ${!customApiKey.trim() ? 'border-red-900/50' : 'border-zinc-800'}`}
                        />
                        <button 
                          onClick={testApiKey}
                          disabled={isTestingKey || !customApiKey.trim()}
                          className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-medium disabled:opacity-50 transition-colors"
                        >
                          {isTestingKey ? <Loader2 size={14} className="animate-spin" /> : "Test"}
                        </button>
                      </div>
                      <p className="text-[9px] text-zinc-600 italic">
                        Hol dir deinen Key hier: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-emerald-500 underline">aistudio.google.com</a>
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 flex items-center gap-2">
                        <Bot size={12} />
                        Modell wählen
                      </label>
                      <select 
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500 outline-none appearance-none cursor-pointer"
                      >
                        <optgroup label="Gemini 3.1 Series">
                          <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                          <option value="gemini-3.1-flash-preview">Gemini 3.1 Flash (Preview)</option>
                        </optgroup>
                        <optgroup label="Gemini 3.0 Series">
                          <option value="gemini-3-flash-preview">Gemini 3 Flash (Standard)</option>
                          <option value="gemini-3-pro-preview">Gemini 3 Pro (Preview)</option>
                        </optgroup>
                      </select>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        msg.role === 'user' ? 'bg-emerald-900/30 text-emerald-500' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
                      </div>
                      <div className={`p-4 rounded-2xl shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-emerald-600 text-white rounded-tr-none' 
                          : 'bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-tl-none'
                      }`}>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mb-3 flex flex-wrap gap-2">
                            {msg.attachments.map((att, i) => (
                              <div key={i} className="rounded-lg overflow-hidden border border-white/10 bg-zinc-900/50">
                                {att.mimeType.startsWith('image/') ? (
                                  <img 
                                    src={`data:${att.mimeType};base64,${att.data}`} 
                                    alt={att.name || "Attachment"} 
                                    className="max-w-[200px] h-auto max-h-48 object-contain"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="p-3 flex items-center gap-2 text-xs">
                                    <FileText size={16} className="text-emerald-500" />
                                    <span className="truncate max-w-[150px]">{att.name || "Dokument"}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="prose prose-invert prose-sm max-w-none">
                          <Markdown>{msg.content}</Markdown>
                        </div>
                        {msg.role === 'bot' && msg.content.includes('Hohe Nachfrage') && (
                          <button 
                            onClick={() => {
                              const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                              if (lastUserMsg) {
                                handleChatSend({
                                  content: lastUserMsg.content,
                                  attachments: lastUserMsg.attachments
                                });
                              }
                            }}
                            className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold bg-zinc-950/50 hover:bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-700 transition-all"
                          >
                            <Loader2 size={12} className={isChatLoading ? 'animate-spin' : ''} />
                            Erneut versuchen
                          </button>
                        )}
                        <p className={`text-[10px] mt-2 opacity-60 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isChatLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="flex gap-3 items-center bg-zinc-800 border border-zinc-700 p-4 rounded-2xl rounded-tl-none shadow-sm">
                    <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                    <span className="text-sm text-zinc-400">{chatStatus || "Denkt nach..."}</span>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-zinc-900 border-t border-zinc-800">
              {chatAttachments.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-3">
                  {chatAttachments.map((att, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative group"
                    >
                      {att.mimeType.startsWith('image/') ? (
                        <img 
                          src={`data:${att.mimeType};base64,${att.data}`} 
                          alt="Preview" 
                          className="h-20 w-20 object-cover rounded-xl border-2 border-emerald-500 shadow-lg"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="h-20 w-20 flex flex-col items-center justify-center bg-zinc-800 rounded-xl border-2 border-emerald-500 shadow-lg p-2">
                          <FileText size={24} className="text-emerald-500 mb-1" />
                          <span className="text-[8px] text-zinc-400 truncate w-full text-center">{att.name}</span>
                        </div>
                      )}
                      <button 
                        onClick={() => removeAttachment(idx)}
                        className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 shadow-md hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
              <div className="relative flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => chatFileInputRef.current?.click()}
                    className="p-2 text-zinc-500 hover:text-emerald-500 hover:bg-zinc-800 rounded-lg transition-colors"
                    title="Bild hochladen"
                  >
                    <ImageIcon size={20} />
                  </button>
                  <button 
                    onClick={() => chatDocInputRef.current?.click()}
                    className="p-2 text-zinc-500 hover:text-emerald-500 hover:bg-zinc-800 rounded-lg transition-colors"
                    title="Dokument hochladen"
                  >
                    <Paperclip size={20} />
                  </button>
                </div>

                <input type="file" ref={chatFileInputRef} onChange={(e) => handleChatFileChange(e, 'image')} className="hidden" accept="image/*" multiple />
                <input type="file" ref={chatDocInputRef} onChange={(e) => handleChatFileChange(e, 'doc')} className="hidden" accept=".pdf,.txt,.doc,.docx,.csv" multiple />

                <div className="relative flex-1">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleChatSend()}
                    placeholder="Schreibe eine Nachricht oder füge Dateien ein..."
                    className="w-full pl-4 pr-12 py-3 bg-zinc-950 border border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-white"
                  />
                  <button
                    onClick={() => handleChatSend()}
                    disabled={(!chatInput.trim() && chatAttachments.length === 0) || isChatLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="py-6 border-t border-zinc-900 bg-zinc-950">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-zinc-600 text-[10px] uppercase tracking-widest font-bold">
          <p>© 2024 kokjoke</p>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              Secure
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
