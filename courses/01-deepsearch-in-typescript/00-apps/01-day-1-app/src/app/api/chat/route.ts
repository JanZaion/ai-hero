import type { Message } from "ai";
import { streamText, createDataStreamResponse } from "ai";
import { z } from "zod";
import { model } from "~/models";
import { auth } from "~/server/auth";
import { searchSerper } from "~/serper";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages } = body;

      const result = streamText({
        model,
        messages,
        maxSteps: 10,
        system: `You are a helpful AI assistant with access to web search capabilities. 

When users ask questions that require current information, recent events, or specific facts that you might not have in your training data, you should use the searchWeb tool to find relevant information.

Always attempt to search the web when:
- Users ask about current events, news, or recent developments
- Questions require up-to-date information
- Users ask about specific facts, statistics, or data you're unsure about
- Users ask about recent products, services, or technologies
- Questions involve time-sensitive information

When providing information from web search results, always cite your sources with inline links using markdown format: [source name](link). This helps users verify the information and provides transparency about where the information comes from.

Be thorough in your searches and provide comprehensive, well-sourced answers.`,
        tools: {
          searchWeb: {
            parameters: z.object({
              query: z.string().describe("The query to search the web for"),
            }),
            execute: async ({ query }, { abortSignal }) => {
              const results = await searchSerper(
                { q: query, num: 10 },
                abortSignal,
              );

              return results.organic.map((result) => ({
                title: result.title,
                link: result.link,
                snippet: result.snippet,
              }));
            },
          },
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
}
