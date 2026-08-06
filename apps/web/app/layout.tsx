import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "熊猫析题",
  description: "面向初高中数学题的诊断式 AI 答疑"
};

const directionContract = `THESIS: A luminous learning atrium keeps the question and dialogue in one calm stage, refusing a tiled dashboard.
OWN-WORLD: stagecraft-theater-lighting-cyclorama-dawn uses sage light, warm paper, pale lavender horizon, fine grain, restrained radii, and right-edge vertical study cards.
STORY: The learner sees their question history, focuses on one diagnosis, then saves or revisits knowledge without losing context.
FIRST VIEWPORT: A 64px topbar spans a 260px history wing, bright central conversation stage, and 312px card wing; the composer anchors the work.
FORM: Luminous atrium, first-ranked approved composition focus-light-a-luminous-atrium, seed 31d2d748.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md`;

void directionContract;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {/* The production build injects directionContract here as the first body node. */}
        {children}
      </body>
    </html>
  );
}
