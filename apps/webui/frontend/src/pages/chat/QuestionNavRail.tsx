import React, { useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n/useLang";

export interface QuestionNavItem {
  messageIndex: number;
  preview: string;
  questionNumber: number;
}

interface QuestionNavRailProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  userMessageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  questions: QuestionNavItem[];
  onNavigate: (messageIndex: number) => void;
}

const QuestionNavRail: React.FC<QuestionNavRailProps> = ({
  scrollContainerRef,
  userMessageRefs,
  questions,
  onNavigate,
}) => {
  const { t } = useLang();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || questions.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.userMessageIndex))
          .filter((idx) => Number.isFinite(idx));

        if (visible.length === 0) return;
        setActiveIndex(Math.min(...visible));
      },
      {
        root: container,
        rootMargin: "-12% 0px -55% 0px",
        threshold: [0, 0.25, 0.5],
      }
    );

    for (const question of questions) {
      const el = userMessageRefs.current.get(question.messageIndex);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [questions, scrollContainerRef, userMessageRefs]);

  const activeQuestion = useMemo(
    () => questions.find((q) => q.messageIndex === activeIndex) ?? null,
    [activeIndex, questions]
  );

  if (questions.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label={t("questionNavRail.aria")}
      className="question-nav-rail hidden lg:block absolute top-1/2 -translate-y-1/2 z-20 pointer-events-none"
    >
      <div className="question-nav-rail__stack relative flex flex-col items-center">
        <div aria-hidden className="question-nav-rail__line" />

        {questions.map((question) => {
          const isActive = question.messageIndex === activeIndex;
          const isHovered = question.messageIndex === hoveredIndex;

          return (
            <button
              key={question.messageIndex}
              type="button"
              aria-label={t("questionNavRail.jumpTo", question.questionNumber, question.preview)}
              aria-current={isActive ? "true" : undefined}
              className={`question-nav-rail__marker pointer-events-auto ${
                isActive ? "question-nav-rail__marker--active" : ""
              }`}
              onClick={() => onNavigate(question.messageIndex)}
              onMouseEnter={() => setHoveredIndex(question.messageIndex)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(question.messageIndex)}
              onBlur={() => setHoveredIndex(null)}
            >
              <span
                className={`question-nav-rail__dot ${
                  isActive ? "question-nav-rail__dot--active" : ""
                } ${isHovered && !isActive ? "question-nav-rail__dot--hover" : ""}`}
              />

              {isHovered && (
                <span className="question-nav-rail__tooltip">{question.preview}</span>
              )}
            </button>
          );
        })}
      </div>

      {activeQuestion && (
        <div className="sr-only" aria-live="polite">
          {t("questionNavRail.currentQuestion", activeQuestion.preview)}
        </div>
      )}
    </nav>
  );
};

export default QuestionNavRail;
