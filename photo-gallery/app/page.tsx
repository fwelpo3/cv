"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PinPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (sessionStorage.getItem("unlocked") === "true") router.replace("/gallery");
  }, []);

  const handleKey = (val: string) => {
    if (val === "del") { setPin(p => p.slice(0, -1)); setError(false); return; }
    if (pin.length >= 4) return;
    const next = pin + val;
    setPin(next);
    if (next.length === 4) {
      if (next === "1111") {
        sessionStorage.setItem("unlocked", "true");
        router.push("/gallery");
      } else {
        setError(true); setShake(true);
        setTimeout(() => { setPin(""); setError(false); setShake(false); }, 700);
      }
    }
  };

  const keys = ["1","2","3","4","5","6","7","8","9","","0","del"];

  return (
    <main style={{ minHeight:"100vh", background:"#080808", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=Playfair+Display:wght@700&display=swap" rel="stylesheet" />
      <div style={{ textAlign:"center", marginBottom:"2.5rem" }}>
        <div style={{ fontSize:"2.5rem", marginBottom:"0.5rem" }}>📷</div>
        <h1 style={{ fontFamily:"'Playfair Display',serif", fontSize:"2rem", color:"#fff", margin:"0 0 0.3rem" }}>Fotogalerie</h1>
        <p style={{ color:"#555", fontSize:"0.8rem", letterSpacing:"0.12em", margin:0 }}>PIN EINGEBEN</p>
      </div>

      <div style={{ display:"flex", gap:"1rem", marginBottom:"2.5rem", animation:shake?"shake 0.5s":"none" }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            width:13, height:13, borderRadius:"50%",
            border:`2px solid ${error?"#e74c3c":"#333"}`,
            background: pin.length > i ? (error?"#e74c3c":"#d4af72") : "transparent",
            transition:"all 0.15s",
          }} />
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"0.65rem", width:"228px" }}>
        {keys.map((k,i) => k==="" ? <div key={i}/> : (
          <button key={i} onClick={() => handleKey(k)} style={{
            height:"62px", borderRadius:"12px",
            border:"1px solid #1e1e1e",
            background: k==="del" ? "transparent" : "#111",
            color: k==="del" ? "#444" : "#e0e0e0",
            fontSize: k==="del" ? "1rem" : "1.4rem",
            fontFamily:"'DM Sans',sans-serif",
            cursor:"pointer", transition:"background 0.1s",
          }}>
            {k==="del" ? "⌫" : k}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)}
        }
      `}</style>
    </main>
  );
}