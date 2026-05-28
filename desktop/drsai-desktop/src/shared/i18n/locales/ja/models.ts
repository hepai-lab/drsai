export default {
  title: "モデル",
  searchPlaceholder: "モデルを検索...",
  empty: "モデルがありません",
  noMatch: "検索条件に一致するモデルがありません",
  deleteConfirm: "削除しますか？",
  displayName: "表示名",
  modelId: "モデル ID",
  namePlaceholder: "例：Claude Sonnet 4",
  modelIdPlaceholder: "例：anthropic/claude-sonnet-4-20250514",
  baseUrlPlaceholder: "http://localhost:1234/v1",
  subtitle:
    "モデルライブラリを管理します。ここに追加したモデルはチャット画面のモデルセレクターに表示されます。",
  addModel: "モデルを追加",
  emptyHint:
    "ここにモデルを追加すると、チャット画面のモデルセレクターで使えるようになります。設定で構成したモデルもここに自動で追加されます。",
  editModel: "モデルを編集",
  update: "更新",
  deleteModelTitle: "モデルを削除",
  yes: "はい",
  no: "いいえ",
  nameRequired: "名前とモデル ID は必須です",
  customProviderHint: "カスタムまたはローカルプロバイダの場合のみ必要です",
  apiKeyLabel: "API キー",
  apiKeyHint:
    "環境変数として保存されます。URL に基づいて該当する環境変数キーが選ばれ、なければ CUSTOM_API_KEY が使われます。",
} as const;
