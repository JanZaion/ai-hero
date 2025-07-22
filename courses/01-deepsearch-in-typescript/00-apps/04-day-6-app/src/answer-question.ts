import { streamText, smoothStream } from "ai";
import { model } from "~/model";
import { SystemContext } from "~/system-context";
import { markdownJoinerTransform } from "~/markdown-joiner-transform";

interface AnswerOptions {
  isFinal: boolean;
}

export async function answerQuestion(
  context: SystemContext,
  userQuestion: string,
  options: AnswerOptions,
): Promise<string> {
  const { isFinal } = options;

  const systemPrompt = `You are a helpful AI assistant with access to real-time web search capabilities. The current date and time is ${new Date().toLocaleString()}.

Your goal is to answer the user's question: "${userQuestion}"

${
  isFinal
    ? "IMPORTANT: We may not have all the information we need to answer the question completely, but we need to make our best effort based on the available information. Be honest about any limitations or uncertainties."
    : "You have comprehensive information from multiple sources. Provide a detailed and accurate answer."
}

Guidelines:
- Always format URLs as markdown links using the format [title](url)
- Be thorough but concise in your responses
- When providing information, always include the source where you found it using markdown links
- Never include raw URLs - always use markdown link format
- When users ask for up-to-date information, use the current date to provide context about how recent the information is
- If you're unsure about something, acknowledge the uncertainty

Current context from web searches and scraped content:

${context.getQueryHistory()}

${context.getScrapeHistory()}

Based on the above information, provide a comprehensive answer to the user's question.`;

  const result = await streamText({
    model,
    prompt: systemPrompt,
    experimental_transform: [
      markdownJoinerTransform(),
      smoothStream({
        delayInMs: 20,
        chunking: "line",
      }),
    ],
  });

  // Convert the stream to a complete text response
  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
  }

  return fullText;
}
