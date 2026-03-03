import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

export async function GET() {
  const { blobs } = await list();
  const images = blobs
    .filter(b => /\.(jpg|jpeg|png|gif|webp)$/i.test(b.pathname))
    .map(b => ({ url: b.url, name: b.pathname, uploadedAt: b.uploadedAt }))
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return NextResponse.json({ images });
}