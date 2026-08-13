import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `an agent that creates tasks in linear when I ask it to`,
  description: "an eve agent, built and deployed with tryeve",
  icons: {
    icon: "https://tryeve.abhivarde.in/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full bg-background text-foreground"
        style={{ fontFamily: "var(--font-geist-sans)" }}
      >
        {children}
      </body>
    </html>
  );
}
