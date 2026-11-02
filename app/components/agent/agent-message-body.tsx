import {
  parseAgentMessage,
  parseInlines,
  type AgentInline,
} from "./agent-markdown";

const linkClass =
  "text-sky-700 underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none";

export function AgentMessageBody({ content }: { content: string }) {
  const blocks = parseAgentMessage(content);
  if (!blocks.length) return null;
  return (
    <div className="space-y-3 text-[15px] leading-7 text-foreground">
      {blocks.map((block, index) => {
        if (block.type === "details") {
          return (
            <details
              className="rounded-[15px] border border-border bg-panel-subtle px-3 py-2"
              key={`details-${index}`}
            >
              <summary className="cursor-pointer text-xs font-medium text-muted">
                Show details
              </summary>
              <div className="mt-2 space-y-1 text-xs leading-5 text-muted">
                {block.text
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, lineIndex) => (
                    <p key={lineIndex}>{renderInlines(parseInlines(line))}</p>
                  ))}
              </div>
            </details>
          );
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              className={
                block.ordered
                  ? "list-decimal space-y-1 pl-5"
                  : "list-disc space-y-1 pl-5"
              }
              key={`list-${index}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlines(item)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={`p-${index}`}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInlines(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInlines(inlines: AgentInline[]) {
  return inlines.map((inline, index) => {
    if (inline.type === "link") {
      return (
        <a
          className={linkClass}
          href={inline.href}
          key={index}
          rel="noopener noreferrer"
          target="_blank"
        >
          {inline.label}
        </a>
      );
    }
    if (inline.type === "strong")
      return <strong key={index}>{inline.text}</strong>;
    return <span key={index}>{inline.text}</span>;
  });
}
