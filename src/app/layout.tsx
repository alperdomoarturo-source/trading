import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Terminal de Señales — Análisis y simulación",
  description:
    "Plataforma de análisis de velas japonesas, señales explicables y backtesting con datos reales de Binance. Solo simulación: sin operaciones con dinero real.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Suspense fallback={<div className="h-14 border-b border-border-subtle bg-surface" />}>
          <Nav />
        </Suspense>
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">{children}</main>
        <footer className="border-t border-border-subtle py-4 text-center text-xs text-muted">
          Datos de Binance API pública · Solo análisis y simulación · Esto no es asesoría
          financiera · No se ejecutan operaciones con dinero real
        </footer>
      </body>
    </html>
  );
}
