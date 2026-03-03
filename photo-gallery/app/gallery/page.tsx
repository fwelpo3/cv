"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Img = { url: string; name: string; uploadedAt: string };

export default function Gallery() {
  const [images, setImages] = useState<Img[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Img | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (sessionStorage.getItem("unlocked") !== "true") router.replace("/");
    else loadImages();
  }, []);

  const loadImages = async () => {
    const res = await fetch("/api/images");
    const data = await res.json();
    setImages(data.images || []);
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      await fetch("/api/upload", { method: "POST", body: fd });
    }
    await loadImages();
    setUploading(false);
  };

  return (
    <main style={{ minHeight:"100vh", background:"#080808", color:"#e0e0e0", fontFamily:"'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Playfair+Display:wght@700&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{ padding:"2rem 2rem 1rem", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid #111" }}>
        <div>
          <h1 style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.8rem", color:"#fff", margin:0 }}>Fotogalerie</h1>
          <p style={{ color:"#444", fontSize:"0.8rem", margin:"0.2rem 0 0", letterSpacing:"0.1em" }}>{images.length} FOTOS</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            padding:"0.6rem 1.4rem", borderRadius:"8px", border:"1px solid #d4af72",
            background:"transparent", color:"#d4af72", fontSize:"0.85rem",
            fontFamily:"'DM Sans',sans-serif", cursor:"pointer", letterSpacing:"0.05em",
            opacity: uploading ? 0.5 : 1,
          }}>
          {uploading ? "Lädt hoch..." : "+ Foto hochladen"}
        </button>
      </header>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
        style={{
          margin:"1.5rem 2rem",
          padding:"2rem",
          border:`2px dashed ${dragOver?"#d4af72":"#1e1e1e"}`,
          borderRadius:"12px",
          textAlign:"center",
          color: dragOver?"#d4af72":"#333",
          fontSize:"0.85rem",
          transition:"all 0.2s",
          cursor:"pointer",
        }}
        onClick={() => fileRef.current?.click()}
      >
        Fotos hier reinziehen oder klicken zum Hochladen
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e => upload(e.target.files)} />

      {/* Grid */}
      {images.length === 0 ? (
        <div style={{ textAlign:"center", color:"#333", marginTop:"4rem", fontSize:"1rem" }}>
          <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>🌄</div>
          <p>Noch keine Fotos – lade das erste hoch!</p>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:"0.75rem", padding:"0 2rem 2rem" }}>
          {images.map((img, i) => (
            <div key={i} onClick={() => setSelected(img)} style={{
              aspectRatio:"1", overflow:"hidden", borderRadius:"8px",
              cursor:"pointer", position:"relative", background:"#111",
            }}>
              <Image src={img.url} alt={img.name} fill style={{ objectFit:"cover", transition:"transform 0.3s" }}
                onMouseEnter={e => (e.currentTarget.style.transform="scale(1.05)")}
                onMouseLeave={e => (e.currentTarget.style.transform="scale(1)")}
              />
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000, cursor:"pointer", padding:"2rem",
        }}>
          <img src={selected.url} alt={selected.name} style={{ maxWidth:"90vw", maxHeight:"90vh", borderRadius:"8px", objectFit:"contain" }} />
        </div>
      )}
    </main>
  );
}