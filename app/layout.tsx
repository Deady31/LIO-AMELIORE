import type { Metadata, Viewport } from "next";
import BottomNav from "@/components/BottomNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Assistant horaires – concept",
  description: "Concept d'assistant IA d'horaires et d'itinéraires pour un réseau de cars régional (non officiel).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#c8102e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh antialiased">
        <div className="mx-auto min-h-dvh max-w-md bg-surface pb-nav shadow-sm">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
