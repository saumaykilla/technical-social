import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeProvider from "./theme-provider";
import { defaultTheme, themeStorageKey } from "@/lib/themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Technically Social | Event Attendees",
  description: "Check in and connect with people attending the event.",
};

// Event themes (Himal Shrestha): this runs before the page is drawn and
// re-applies the theme this browser saw last, so there's no flash of the
// wrong colors while ThemeProvider asks the server for today's theme.
const rememberTheme = `try{var t=sessionStorage.getItem("${themeStorageKey}");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme={defaultTheme}
      // The theme can change after load, so React shouldn't warn that data-theme differs.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: rememberTheme }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider />
        {children}
      </body>
    </html>
  );
}
