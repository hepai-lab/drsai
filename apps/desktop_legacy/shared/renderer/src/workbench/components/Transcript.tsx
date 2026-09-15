/**
 * The conversation.  One component per OAEP item type, chosen by `item.type`.
 *
 * Every item type in the protocol has a case here, including the ones the eleven
 * features never mention -- `command_execution`, `file_change`, `subtask`.  They
 * are not new features: `DrSaiAssistant` emits them whenever it uses a tool, so
 * the choice is between rendering them and showing the user a gap where the agent
 * did something.  Each one is a few lines because none of them needs a route.
 */

import React, { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OaepItem } from "../../../../api/desktopGateway";
import type { TranscriptEntry } from "../transcript";

interface TranscriptProps {
  entries: TranscriptEntry[];
  streaming: boolean;
}

export function Transcript({ entries, streaming }: TranscriptProps): React.JSX.Element {
  const bottom = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the output only while the user is already at the bottom. Scrolling up
  // to re-read something must not be undone by the next token.
  const onScroll = (): void => {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinned.current = distance < 80;
  };

  useEffect(() => {
    if (pinned.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  if (!entries.length) {
    return (
      <div className="wb-transcript wb-transcript-empty" ref={scroller}>
        <p>Ask anything. The agent can read and write files in this workspace.</p>
      </div>
    );
  }

  return (
    <div className="wb-transcript" ref={scroller} onScroll={onScroll}>
      {entries.map((entry) => (
        <Entry key={entry.item.id} entry={entry} />
      ))}
      {streaming ? <div className="wb-typing" aria-label="The agent is working" /> : null}
      <div ref={bottom} />
    </div>
  );
}

function Entry({ entry }: { entry: TranscriptEntry }): React.JSX.Element | null {
  const { item, text, streaming } = entry;
  switch (item.type) {
    case "message":
      return <MessageBubble item={item} text={text} streaming={streaming} />;
    case "reasoning":
      return <Reasoning text={text} streaming={streaming} />;
    case "tool_call":
      return <ToolCall item={item} />;
    case "command_execution":
      return <CommandExecution item={item} text={text} />;
    case "file_change":
      return <FileChange item={item} />;
    case "artifact":
      return <Artifact item={item} />;
    case "plan":
      return <Plan item={item} text={text} />;
    case "subtask":
      return <Subtask item={item} />;
    case "notice":
      return <Notice item={item} />;
    case "interaction":
      // Approvals were cut from the eleven features, so there is no UI to answer
      // one. Showing that the agent asked is still better than silence: the run
      // will sit in `waiting` and the user would otherwise have no idea why.
      return <Notice item={item} forcedLevel="warning" />;
    default:
      return null;
  }
}

function MessageBubble({
  item,
  text,
  streaming,
}: {
  item: OaepItem;
  text: string;
  streaming: boolean;
}): React.JSX.Element {
  const role = String((item.content as { role?: unknown }).role ?? "assistant");
  return (
    <article className={`wb-message wb-message-${role}`} data-streaming={streaming || undefined}>
      <div className="wb-message-body">
        {role === "user" ? (
          // User text is shown verbatim. Rendering it as markdown would let a
          // pasted snippet reformat itself into something the user did not type.
          <pre className="wb-user-text">{text}</pre>
        ) : (
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        )}
      </div>
    </article>
  );
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }): React.JSX.Element | null {
  if (!text.trim()) return null;
  return (
    <details className="wb-reasoning" open={streaming}>
      <summary>Thinking</summary>
      <div className="wb-reasoning-body">{text}</div>
    </details>
  );
}

function ToolCall({ item }: { item: OaepItem }): React.JSX.Element {
  const content = item.content as { tool_name?: string; arguments?: unknown; result?: unknown };
  return (
    <details className="wb-tool" data-status={item.status}>
      <summary>
        <span className="wb-tool-name">{content.tool_name ?? "tool"}</span>
        <span className="wb-tool-status">{item.status}</span>
      </summary>
      <pre className="wb-code">{format(content.arguments)}</pre>
      {content.result === undefined ? null : <pre className="wb-code">{format(content.result)}</pre>}
    </details>
  );
}

function CommandExecution({ item, text }: { item: OaepItem; text: string }): React.JSX.Element {
  const content = item.content as { display_command?: string; exit_code?: number | null };
  return (
    <details className="wb-command" data-status={item.status} open={item.status === "running"}>
      <summary>
        <code>{content.display_command ?? "command"}</code>
        {typeof content.exit_code === "number" ? (
          <span className="wb-exit" data-failed={content.exit_code !== 0 || undefined}>
            exit {content.exit_code}
          </span>
        ) : null}
      </summary>
      <pre className="wb-code wb-output">{text}</pre>
    </details>
  );
}

function FileChange({ item }: { item: OaepItem }): React.JSX.Element {
  const content = item.content as { summary?: string; changes?: Array<Record<string, unknown>> };
  return (
    <div className="wb-file-change">
      <span className="wb-badge">files</span>
      <span>{content.summary ?? `${content.changes?.length ?? 0} file(s) changed`}</span>
    </div>
  );
}

function Artifact({ item }: { item: OaepItem }): React.JSX.Element {
  const content = item.content as { name?: string; summary?: string; path?: string | null };
  return (
    <div className="wb-artifact">
      <span className="wb-badge">artifact</span>
      <strong>{content.name ?? "artifact"}</strong>
      {content.summary ? <span className="wb-muted">{content.summary}</span> : null}
      {content.path ? <code className="wb-muted">{content.path}</code> : null}
    </div>
  );
}

function Plan({ item, text }: { item: OaepItem; text: string }): React.JSX.Element {
  const steps = (item.content as { steps?: Array<{ id: string; title: string; status: string }> }).steps ?? [];
  return (
    <div className="wb-plan">
      {text ? <p>{text}</p> : null}
      <ol>
        {steps.map((step) => (
          <li key={step.id} data-status={step.status}>
            {step.title}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Subtask({ item }: { item: OaepItem }): React.JSX.Element {
  const content = item.content as { title?: string; summary?: string; agent_name?: string | null };
  return (
    <div className="wb-subtask" data-status={item.status}>
      <span className="wb-badge">{content.agent_name ?? "subagent"}</span>
      <strong>{content.title ?? "subtask"}</strong>
      {content.summary ? <span className="wb-muted">{content.summary}</span> : null}
    </div>
  );
}

function Notice({
  item,
  forcedLevel,
}: {
  item: OaepItem;
  forcedLevel?: string;
}): React.JSX.Element {
  const content = item.content as { level?: string; message?: string; prompt?: string };
  return (
    <div className="wb-notice" data-level={forcedLevel ?? content.level ?? "info"}>
      {content.message ?? content.prompt ?? "The agent posted a notice."}
    </div>
  );
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
