import { useEffect, useRef } from "react";
import { ChevronDown, Search, X } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

interface ChatSearchBarProps {
  query: string;
  current: number;
  total: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function ChatSearchBar({
  query,
  current,
  total,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: ChatSearchBarProps): React.JSX.Element {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="chat-searchbar">
      <Search size={14} className="chat-searchbar-icon" />
      <input
        ref={inputRef}
        className="chat-searchbar-input"
        type="text"
        value={query}
        placeholder={t("chat.searchPlaceholder")}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            onPrevious();
          } else if (e.key === "Enter") {
            e.preventDefault();
            onNext();
          }
        }}
      />
      <span className="chat-searchbar-count">
        {query.trim()
          ? total > 0
            ? t("chat.searchCount", { current, total })
            : t("chat.searchNoResults")
          : t("chat.searchHint")}
      </span>
      <button
        className="btn-ghost chat-searchbar-step"
        onClick={onPrevious}
        disabled={total === 0}
        title={t("chat.searchPrevious")}
      >
        <ChevronDown size={14} className="chat-searchbar-up" />
      </button>
      <button
        className="btn-ghost chat-searchbar-step"
        onClick={onNext}
        disabled={total === 0}
        title={t("chat.searchNext")}
      >
        <ChevronDown size={14} />
      </button>
      <button
        className="btn-ghost chat-searchbar-close"
        onClick={onClose}
        title={t("common.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
