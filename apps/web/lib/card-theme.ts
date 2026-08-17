import type { StudyCard } from "./api";

export type CardVisualTheme = {
  background: string;
  panel: string;
  panelStrong: string;
  ink: string;
  accent: string;
  shadow: string;
};

const KNOWLEDGE_THEME_VARIANTS = 15 * 15 * 13;

const PROBLEM_THEME: CardVisualTheme = {
  background: "#f2d15f",
  panel: "#fbe9a5",
  panelStrong: "#fff9df",
  ink: "#4b3905",
  accent: "#9a7000",
  shadow: "rgba(112, 83, 0, 0.2)"
};

const KNOWLEDGE_THEMES: readonly CardVisualTheme[] = [
  {
    background: "#8fce77",
    panel: "#d9f1cb",
    panelStrong: "#f7fcf3",
    ink: "#173820",
    accent: "#3d8138",
    shadow: "rgba(32, 83, 31, 0.18)"
  },
  {
    background: "#82cbb8",
    panel: "#d5f0e8",
    panelStrong: "#f4fbf8",
    ink: "#123d33",
    accent: "#357f6c",
    shadow: "rgba(21, 77, 64, 0.17)"
  },
  {
    background: "#a9cf7f",
    panel: "#e3f1cf",
    panelStrong: "#f8fbf2",
    ink: "#2d3d1c",
    accent: "#597d38",
    shadow: "rgba(59, 83, 31, 0.17)"
  },
  {
    background: "#cfc3e6",
    panel: "#ece6f6",
    panelStrong: "#fbf9fd",
    ink: "#332a45",
    accent: "#8b78ad",
    shadow: "rgba(65, 52, 92, 0.17)"
  }
];

export function stableCardThemeIndex(cardId: string) {
  let hash = 0;
  for (let index = 0; index < cardId.length; index += 1) {
    hash = ((hash * 31) + cardId.charCodeAt(index)) >>> 0;
  }
  return hash % KNOWLEDGE_THEME_VARIANTS;
}

function knowledgeTheme(cardId: string, themeVariant?: number): CardVisualTheme {
  const variant = themeVariant === undefined
    ? stableCardThemeIndex(cardId) % KNOWLEDGE_THEMES.length
    : Math.abs(themeVariant) % KNOWLEDGE_THEMES.length;
  return KNOWLEDGE_THEMES[variant];
}

export function cardVisualTheme(card: StudyCard, themeVariant?: number) {
  return card.card_type === "problem_card"
    ? PROBLEM_THEME
    : knowledgeTheme(card.id, themeVariant);
}

export function cardThemeProperties(card: StudyCard, themeVariant?: number) {
  const theme = cardVisualTheme(card, themeVariant);
  return {
    "--flashcard-bg": theme.background,
    "--flashcard-panel": theme.panel,
    "--flashcard-panel-strong": theme.panelStrong,
    "--flashcard-ink": theme.ink,
    "--flashcard-accent": theme.accent,
    "--flashcard-shadow": theme.shadow
  };
}
