import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";

export type MessagePart = NonNullable<Message["parts"]>[number];

interface ChatMessageProps {
  parts: MessagePart[];
  role: string;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const ToolInvocationDisplay = ({
  part,
}: {
  part: MessagePart & { type: "tool-invocation" };
}) => {
  const { toolInvocation } = part;

  return (
    <div className="mb-4 rounded-lg bg-gray-600 p-3">
      <div className="mb-2">
        <span className="text-sm font-semibold text-gray-300">
          🔧 Tool: {toolInvocation.toolName}
        </span>
        <span className="ml-2 text-xs text-gray-400">
          ({toolInvocation.state})
        </span>
      </div>

      {toolInvocation.state !== "partial-call" && (
        <div className="mb-2">
          <div className="mb-1 text-xs text-gray-400">Arguments:</div>
          <pre className="overflow-x-auto rounded bg-gray-700 p-2 text-xs">
            {JSON.stringify(toolInvocation.args, null, 2)}
          </pre>
        </div>
      )}

      {toolInvocation.state === "result" && "result" in toolInvocation && (
        <div>
          <div className="mb-1 text-xs text-gray-400">Result:</div>
          <pre className="overflow-x-auto rounded bg-gray-700 p-2 text-xs">
            {JSON.stringify(toolInvocation.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export const ChatMessage = ({ parts, role, userName }: ChatMessageProps) => {
  const isAI = role === "assistant";

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        <div className="prose prose-invert max-w-none">
          {parts.map((part, index) => {
            switch (part.type) {
              case "text":
                return <Markdown key={index}>{part.text}</Markdown>;
              case "tool-invocation":
                return <ToolInvocationDisplay key={index} part={part} />;
              default:
                // For any other part types we're not handling yet
                return (
                  <div key={index} className="text-xs italic text-gray-500">
                    Unsupported part type: {(part as any).type}
                  </div>
                );
            }
          })}
        </div>
      </div>
    </div>
  );
};
