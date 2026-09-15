import React from "react";
import { conversationResourcePreviewFrameProps, type ConversationResourcePreviewFrameProps } from "./conversationResourcePreviewPolicy";

/** Preview bytes execute only in the configured isolated origin and an empty sandbox. */
export function ConversationResourcePreviewFrame(props: ConversationResourcePreviewFrameProps): React.JSX.Element {
  return <iframe
    {...conversationResourcePreviewFrameProps(props)}
    className="h-full min-h-[500px] w-full rounded-md border border-border-primary/30"
    data-testid="conversation-resource-preview-frame"
  />;
}

export { conversationResourcePreviewFrameProps } from "./conversationResourcePreviewPolicy";
