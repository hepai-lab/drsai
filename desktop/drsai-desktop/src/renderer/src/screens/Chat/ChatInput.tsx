import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Send, Square as Stop, Slash } from "lucide-react";
import { isImeComposing } from "./keyboard";
import { useI18n } from "../../components/useI18n";
import { SLASH_COMMANDS, type SlashCommand } from "./slashCommands";
import { useInputHistory } from "./hooks/useInputHistory";

export interface ChatInputHandle {
  setText(text: string): void;
  clear(): void;
  focus(): void;
}

interface ChatInputProps {
  isLoading: boolean;
  hasSession: boolean;
  onSubmit: (text: string) => void;
  onQuickAsk: (text: string) => void;
  onAbort: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    { isLoading, hasSession, onSubmit, onQuickAsk, onAbort },
    ref,
  ): React.JSX.Element {
    const { t } = useI18n();
    const [input, setInput] = useState("");
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashFilter, setSlashFilter] = useState("");
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const slashMenuRef = useRef<HTMLDivElement>(null);

    const autoResize = useCallback((): void => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, []);

    const applyHistoryText = useCallback(
      (text: string): void => {
        setInput(text);
        requestAnimationFrame(() => {
          autoResize();
          inputRef.current?.setSelectionRange(text.length, text.length);
        });
      },
      [autoResize],
    );

    const history = useInputHistory({
      currentInput: input,
      applyText: applyHistoryText,
    });

    useImperativeHandle(
      ref,
      () => ({
        setText(text: string): void {
          setInput(text);
          requestAnimationFrame(() => {
            autoResize();
            if (inputRef.current) {
              inputRef.current.setSelectionRange(text.length, text.length);
              inputRef.current.focus();
            }
          });
        },
        clear(): void {
          setInput("");
          if (inputRef.current) inputRef.current.style.height = "auto";
        },
        focus(): void {
          inputRef.current?.focus();
        },
      }),
      [autoResize],
    );

    // Refocus the textarea when a streaming response ends
    useEffect(() => {
      if (!isLoading) inputRef.current?.focus();
    }, [isLoading]);

    // Close slash menu on click outside
    useEffect(() => {
      if (!slashMenuOpen) return;
      function handleClickOutside(e: MouseEvent): void {
        if (
          slashMenuRef.current &&
          !slashMenuRef.current.contains(e.target as Node)
        ) {
          setSlashMenuOpen(false);
        }
      }
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [slashMenuOpen]);

    // Scroll active slash menu item into view
    useEffect(() => {
      if (!slashMenuOpen) return;
      const active = slashMenuRef.current?.querySelector(
        ".slash-menu-item-active",
      );
      active?.scrollIntoView({ block: "nearest" });
    }, [slashSelectedIndex, slashMenuOpen]);

    const filteredSlashCommands = useMemo(
      () =>
        slashMenuOpen
          ? SLASH_COMMANDS.filter((cmd) =>
              cmd.name.toLowerCase().startsWith(slashFilter.toLowerCase()),
            )
          : [],
      [slashMenuOpen, slashFilter],
    );

    function clearAfterSend(text: string): void {
      history.push(text);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    }

    function handleSend(): void {
      const text = input.trim();
      if (!text || isLoading) return;
      setSlashMenuOpen(false);
      clearAfterSend(text);
      onSubmit(text);
    }

    function handleQuickAsk(): void {
      const text = input.trim();
      if (!text || isLoading) return;
      clearAfterSend(text);
      onQuickAsk(text);
    }

    function handleSlashSelect(cmd: SlashCommand): void {
      setSlashMenuOpen(false);
      // Local / info commands dispatch immediately — let parent route through onSubmit
      if (cmd.local || cmd.category === "info") {
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
        onSubmit(cmd.name);
        return;
      }
      // Backend commands that take arguments: insert prefix and wait for the user
      setInput(cmd.name + " ");
      inputRef.current?.focus();
    }

    function handleInputChange(
      e: React.ChangeEvent<HTMLTextAreaElement>,
    ): void {
      const value = e.target.value;
      setInput(value);

      const target = e.target;
      requestAnimationFrame(() => {
        target.style.height = "auto";
        target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
      });

      if (value.startsWith("/") && !value.includes(" ")) {
        const query = value.split(" ")[0];
        setSlashMenuOpen(true);
        setSlashFilter(query);
        setSlashSelectedIndex(0);
      } else if (slashMenuOpen) {
        setSlashMenuOpen(false);
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
      if (isImeComposing(e)) return;

      // Slash menu keyboard navigation
      if (slashMenuOpen && filteredSlashCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashSelectedIndex((i) =>
            i < filteredSlashCommands.length - 1 ? i + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredSlashCommands.length - 1,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
      }

      // History navigation: ArrowUp/Down when not in a multiline draft (or already navigating)
      if (!slashMenuOpen && (history.isNavigating() || !input.includes("\n"))) {
        if (e.key === "ArrowUp" && history.size() > 0) {
          if (history.recallPrev()) {
            e.preventDefault();
            return;
          }
        }
        if (e.key === "ArrowDown" && history.isNavigating()) {
          if (history.recallNext()) {
            e.preventDefault();
            return;
          }
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }

    return (
      <>
        {slashMenuOpen && filteredSlashCommands.length > 0 && (
          <div className="slash-menu" ref={slashMenuRef}>
            <div className="slash-menu-header">
              <Slash size={12} />
              {t("chat.commandsTitle")}
            </div>
            <div className="slash-menu-list">
              {filteredSlashCommands.map((cmd, i) => (
                <button
                  key={cmd.name}
                  className={`slash-menu-item ${i === slashSelectedIndex ? "slash-menu-item-active" : ""}`}
                  onMouseEnter={() => setSlashSelectedIndex(i)}
                  onClick={() => handleSlashSelect(cmd)}
                >
                  <span className="slash-menu-item-name">{cmd.name}</span>
                  <span className="slash-menu-item-desc">
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={t("chat.typeMessage")}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            autoFocus
          />
          {isLoading ? (
            <button
              className="chat-send-btn chat-stop-btn"
              onClick={onAbort}
              title={t("common.stop")}
            >
              <Stop size={14} />
            </button>
          ) : (
            <>
              {input.trim() && hasSession && (
                <button
                  className="chat-btw-btn"
                  onClick={handleQuickAsk}
                  title={t("chat.quickAskTitle")}
                >
                  💭
                </button>
              )}
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
                title={t("chat.send")}
              >
                <Send size={16} />
              </button>
            </>
          )}
        </div>
      </>
    );
  },
);
