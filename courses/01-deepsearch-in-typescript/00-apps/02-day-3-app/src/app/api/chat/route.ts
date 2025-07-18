import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  appendResponseMessages,
} from "ai";
import { model } from "~/model";
import { auth } from "~/server/auth";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/scraper";
import { z } from "zod";
import { upsertChat } from "~/server/db/queries";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { chats } from "~/server/db/schema";
import { Langfuse } from "langfuse";
import { env } from "~/env";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId?: string;
  };

  const { messages, chatId } = body;

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }

  // If no chatId is provided, create a new chat with the user's message
  let currentChatId = chatId;
  if (!currentChatId) {
    const newChatId = crypto.randomUUID();
    await upsertChat({
      userId: session.user.id,
      chatId: newChatId,
      title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
      messages: messages, // Only save the user's message initially
    });
    currentChatId = newChatId;
  } else {
    // Verify the chat belongs to the user
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, currentChatId),
    });
    if (!chat || chat.userId !== session.user.id) {
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
  }

  const trace = langfuse.trace({
    sessionId: currentChatId,
    name: "chat",
    userId: session.user.id,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // If this is a new chat, send the chat ID to the frontend
      if (!chatId) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: currentChatId,
        });
      }

      const result = streamText({
        model,
        messages,
        maxSteps: 10,
        experimental_telemetry: {
          isEnabled: true,
          functionId: `agent`,
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
        system: `You are a helpful AI assistant with access to real-time web search and web scraping capabilities. When answering questions:

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format

Available tools:
- searchWeb: Use this to search for current information on the web. Returns search results with titles, links, and snippets.
- scrapePages: Use this to extract the full content of web pages. This is useful when you need detailed information from specific pages that search results don't provide enough detail about. The tool will crawl the pages, respect robots.txt, and return the full text content in markdown format.

Workflow:
1. Use searchWeb to find relevant pages for the user's question
2. If the search results don't provide enough detail, use scrapePages to get the full content of the most relevant pages
3. Provide comprehensive answers based on the scraped content, always citing sources with markdown links

Remember to use the searchWeb tool first, then scrapePages when you need more detailed information from specific pages.`,
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
          scrapePages: {
            parameters: z.object({
              urls: z
                .array(z.string())
                .describe(
                  "Array of URLs to scrape and extract full content from",
                ),
            }),
            execute: async ({ urls }, { abortSignal }) => {
              const result = await bulkCrawlWebsites({ urls });

              if (result.success) {
                return result.results.map(({ url, result: crawlResult }) => ({
                  url,
                  content: crawlResult.data,
                }));
              } else {
                return {
                  error: result.error,
                  results: result.results.map(
                    ({ url, result: crawlResult }) => ({
                      url,
                      success: crawlResult.success,
                      content: crawlResult.success
                        ? crawlResult.data
                        : crawlResult.error,
                    }),
                  ),
                };
              }
            },
          },
        },
        onFinish: async ({ response }) => {
          // Merge the existing messages with the response messages
          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages: response.messages,
          });

          const lastMessage = messages[messages.length - 1];
          if (!lastMessage) {
            return;
          }

          // Save the complete chat history
          await upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: updatedMessages,
          });

          await langfuse.flushAsync();
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });
}
