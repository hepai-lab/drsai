import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Search, X } from "../../assets/icons";
import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";

interface ModelItem {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit: number;
  max_tokens: number;
  reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
}

interface CatalogResponse {
  default_alias: string;
  models: ModelItem[];
}

function Models(): React.JSX.Element {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null);
  const [formAlias, setFormAlias] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formClientType, setFormClientType] = useState("openai");
  const [formTokenLimit, setFormTokenLimit] = useState(128000);
  const [formMaxTokens, setFormMaxTokens] = useState(0);
  const [formReasoningSupported, setFormReasoningSupported] = useState(false);
  const [formError, setFormError] = useState("");

  const loadModels = useCallback(async () => {
    const data = await window.drsaiAPI.listModels();
    setCatalog(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  function openAddModal(): void {
    setEditingModel(null);
    setFormAlias("");
    setFormModel("");
    setFormClientType("openai");
    setFormTokenLimit(128000);
    setFormMaxTokens(0);
    setFormReasoningSupported(false);
    setFormError("");
    setShowModal(true);
  }

  function openEditModal(m: ModelItem): void {
    setEditingModel(m);
    setFormAlias(m.alias);
    setFormModel(m.model);
    setFormClientType(m.client_type);
    setFormTokenLimit(m.token_limit);
    setFormMaxTokens(m.max_tokens);
    setFormReasoningSupported(m.reasoning?.supported || false);
    setFormError("");
    setShowModal(true);
  }

  function closeModal(): void {
    setShowModal(false);
    setEditingModel(null);
    setFormError("");
  }

  async function handleSave(): Promise<void> {
    const alias = formAlias.trim();
    const model = formModel.trim();
    if (!alias || !model) {
      setFormError(t("models.nameRequired"));
      return;
    }
    setFormError("");

    if (editingModel) {
      await window.drsaiAPI.updateModel(editingModel.alias, {
        model,
        client_type: formClientType,
        token_limit: formTokenLimit,
        max_tokens: formMaxTokens,
        reasoning: {
          supported: formReasoningSupported,
          effort_levels: [],
          param_type: formClientType === "anthropic" ? "adaptive" : "reasoning_effort",
        },
        new_alias: alias !== editingModel.alias ? alias : undefined,
      });
    } else {
      await window.drsaiAPI.addModel({
        alias,
        model,
        client_type: formClientType,
        token_limit: formTokenLimit,
        max_tokens: formMaxTokens,
        reasoning: formReasoningSupported
          ? { supported: true, effort_levels: [], param_type: formClientType === "anthropic" ? "adaptive" : "reasoning_effort" }
          : undefined,
      });
    }

    closeModal();
    await loadModels();
  }

  async function handleDelete(alias: string): Promise<void> {
    await window.drsaiAPI.removeModel(alias);
    setConfirmDelete(null);
    await loadModels();
  }

  const models = catalog?.models || [];
  const defaultAlias = catalog?.default_alias;

  const filtered = models.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.alias.toLowerCase().includes(q) ||
      m.display_name.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("models.title")}</h1>
        <div className="models-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="models-header">
        <div>
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            {t("models.title")}
          </h1>
          <p className="models-subtitle">{t("models.subtitle")}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAddModal}>
          <Plus size={14} />
          {t("models.addModel")}
        </button>
      </div>

      <div className="models-search">
        <Search size={14} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("models.searchPlaceholder")}
        />
        {search && (
          <button className="models-search-clear" onClick={() => setSearch("")}>
            <X size={14} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="models-empty">
          {search ? t("models.noResults") : t("models.noModels")}
        </div>
      ) : (
        <div className="models-list">
          {filtered.map((m) => (
            <div key={m.alias} className="models-card" onClick={() => openEditModal(m)}>
              <div className="models-card-main">
                <span className="models-card-name">{m.display_name}</span>
                {m.alias === defaultAlias && (
                  <span className="models-card-badge">{t("models.default")}</span>
                )}
                <span className="models-card-alias">{m.alias}</span>
              </div>
              <div className="models-card-meta">
                <span className="models-card-client">{m.client_type}</span>
                <span className="models-card-tokens">
                  {m.token_limit >= 1000000 ? `${(m.token_limit / 1000000).toFixed(1)}M` : `${(m.token_limit / 1000).toFixed(0)}K`} ctx
                </span>
                {m.reasoning?.supported && (
                  <span className="models-card-reasoning">{t("models.reasoning")}</span>
                )}
              </div>
              <div className="models-card-model">{m.model}</div>
              <button
                className="models-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(m.alias);
                }}
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay">
          <div className="modal">
            <p>{t("models.confirmDelete")}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal modal-lg">
            <h2>{editingModel ? t("models.editModel") : t("models.addModel")}</h2>
            {formError && <p className="form-error">{formError}</p>}

            <div className="form-group">
              <label>{t("models.alias")}</label>
              <input
                type="text"
                value={formAlias}
                onChange={(e) => setFormAlias(e.target.value)}
                placeholder="claude-sonnet-4-6"
              />
            </div>

            <div className="form-group">
              <label>{t("models.modelId")}</label>
              <input
                type="text"
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
                placeholder="anthropic/claude-sonnet-4-6"
              />
            </div>

            <div className="form-group">
              <label>{t("models.clientType")}</label>
              <select value={formClientType} onChange={(e) => setFormClientType(e.target.value)}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>{t("models.tokenLimit")}</label>
                <input
                  type="number"
                  value={formTokenLimit}
                  onChange={(e) => setFormTokenLimit(Number(e.target.value))}
                />
              </div>
              <div className="form-group">
                <label>{t("models.maxTokens")}</label>
                <input
                  type="number"
                  value={formMaxTokens}
                  onChange={(e) => setFormMaxTokens(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={formReasoningSupported}
                  onChange={(e) => setFormReasoningSupported(e.target.checked)}
                />
                {" "}{t("models.reasoningSupported")}
              </label>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={closeModal}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Models;