import React, { useState, useEffect, useRef } from "react";
import MarkdownRenderer from "../../components/common/markdownrender";

interface TypewriterMessageProps {
  content: string;
  /** chars per second — default 4000 */
  speed?: number;
  /** fires the first time the typewriter catches up to the full content */
  onComplete?: () => void;
  /** start rendering from this character position instead of 0 */
  initialPos?: number;
}

const TICK_MS = 16; // ~60fps

const TypewriterMessage: React.FC<TypewriterMessageProps> = ({ content, speed = 4000, onComplete, initialPos = 0 }) => {
  const [displayed, setDisplayed] = useState(() => content.slice(0, initialPos));
  const [done, setDone] = useState(false);
  const posRef = useRef(initialPos);
  const contentRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  contentRef.current = content;

  useEffect(() => {
    const charsPerTick = Math.max(1, Math.round((speed * TICK_MS) / 1000));

    timerRef.current = setInterval(() => {
      const latest = contentRef.current;
      if (posRef.current >= latest.length) {
        if (!completedRef.current && latest.length > 0) {
          completedRef.current = true;
          setDone(true);
          onCompleteRef.current?.();
        }
        return;
      }
      posRef.current = Math.min(posRef.current + charsPerTick, latest.length);
      setDisplayed(latest.slice(0, posRef.current));
    }, TICK_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Use MarkdownRenderer throughout so images and think-tags render correctly.
  // The cursor span is injected after the last text node via a wrapper.
  return (
    <div className="py-2 px-1 text-sm leading-relaxed relative">
      <MarkdownRenderer content={done ? content : displayed} />
      {!done && (
        <span className="inline-block w-0.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
      )}
    </div>
  );
};

export default TypewriterMessage;
