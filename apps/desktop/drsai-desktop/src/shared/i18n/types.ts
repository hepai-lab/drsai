export type AppLocale = "en" | "es" | "id" | "ja" | "pt-BR" | "zh-CN";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};
