import React, { useState, useEffect, useRef } from 'react';
import ChatHub from './ChatHub';
import { Upload, Trash2, Image as ImageIcon, Loader2, Plus, Download, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ImageRecord {
  id: number;
  name: string;
  data: string;
  description?: string;
  created_at: string;
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
  
  // AI and group chat are provided by ChatHub; their messages are stored server-side.
  const galleryFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/session').then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.authenticated) setIsLoggedIn(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      fetchImages();
    }

    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (!isLoggedIn || activeTab !== 'gallery') return;
      
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter(item => item.type.indexOf('image') !== -1);
      if (imageItems.length === 0) return;

      setUploading(true);

      const uploadPromises = imageItems.map(item => {
        const blob = item.getAsFile();
        if (!blob) return Promise.resolve();

        return new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const data = event.target?.result as string;
            try {
              await uploadImage(`pasted-${Date.now()}.png`, data, true);
            } catch (err) {
              console.error("Paste upload failed", err);
            }
            resolve();
          };
          reader.readAsDataURL(blob);
        });
      });

      Promise.all(uploadPromises).then(async () => {
        await fetchImages();
        setUploading(false);
      });
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [isLoggedIn, activeTab]);

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!res.ok) throw new Error('Anmeldung fehlgeschlagen');
      setIsLoggedIn(true);
      setPassword('');
    } catch {
      setPassword('');
      alert('Falsches Passwort oder Server nicht erreichbar.');
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
              onChange={(e) => setPassword(e.target.value)}
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
                Chats
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
          <ChatHub />
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
