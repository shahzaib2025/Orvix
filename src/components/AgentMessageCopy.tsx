import AgentCopyButton from "./AgentCopyButton";

export function ReplyActions({ text, timestamp }: { text: string; timestamp: number }) {
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
  const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
  return <div className="agent-reply-actions">
    <time className="agent-reply-time" dateTime={new Date(timestamp).toISOString()} title={fullTime}>{time}</time>
    <AgentCopyButton text={text} label="Copy response" />
  </div>;
}

export function UserMessageCopy({ text, createdAt }: { text: string; createdAt: number }) {
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(createdAt));
  const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(createdAt));
  return <div className="agent-user-copy-wrap">
    <time className="agent-user-time" dateTime={new Date(createdAt).toISOString()} title={fullTime}>{time}</time>
    <AgentCopyButton text={text} label="Copy" accessibleLabel="Copy message" buttonClassName="agent-user-copy" />
  </div>;
}
