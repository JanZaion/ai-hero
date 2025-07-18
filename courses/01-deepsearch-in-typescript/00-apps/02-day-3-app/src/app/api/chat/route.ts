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

  // Create trace at the beginning
  const trace = langfuse.trace({
    name: "chat",
    userId: session.user.id,
  });

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

    // Span for creating new chat
    const createChatSpan = trace.span({
      name: "create-new-chat",
      input: {
        userId: session.user.id,
        chatId: newChatId,
        title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
        messageCount: messages.length,
      },
    });

    try {
      await upsertChat({
        userId: session.user.id,
        chatId: newChatId,
        title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
        messages: messages, // Only save the user's message initially
      });

      createChatSpan.end({
        output: {
          chatId: newChatId,
          success: true,
        },
      });
    } catch (error) {
      createChatSpan.end({
        output: {
          error: error instanceof Error ? error.message : "Unknown error",
          success: false,
        },
      });
      throw error;
    }

    currentChatId = newChatId;
  } else {
    // Span for verifying chat ownership
    const verifyChatSpan = trace.span({
      name: "verify-chat-ownership",
      input: {
        chatId: currentChatId,
        userId: session.user.id,
      },
    });

    try {
      // Verify the chat belongs to the user
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, currentChatId),
      });

      if (!chat || chat.userId !== session.user.id) {
        verifyChatSpan.end({
          output: {
            success: false,
            error: "Chat not found or unauthorized",
          },
        });
        return new Response("Chat not found or unauthorized", { status: 404 });
      }

      verifyChatSpan.end({
        output: {
          success: true,
          chatId: chat.id,
          chatTitle: chat.title,
        },
      });
    } catch (error) {
      verifyChatSpan.end({
        output: {
          error: error instanceof Error ? error.message : "Unknown error",
          success: false,
        },
      });
      throw error;
    }
  }

  // Update trace with sessionId now that we have the chatId
  trace.update({
    sessionId: currentChatId,
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

      const currentDate = new Date().toISOString();

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
        system: `You are a helpful AI assistant with access to real-time web search and web scraping capabilities. 

CURRENT DATE AND TIME: ${currentDate}

When answering questions:

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format
7. When users ask for "up to date" or "current" information, use the current date (${currentDate}) to determine what constitutes recent information
8. Pay attention to publication dates in search results and prioritize more recent information when available
9. If information seems outdated compared to the current date, mention this to the user

Available tools:
- searchWeb: Use this to search for current information on the web. Returns search results with titles, links, snippets, and publication dates when available.
- scrapePages: Use this to extract the full content of web pages. This is useful when you need detailed information from specific pages that search results don't provide enough detail about. The tool will crawl the pages, respect robots.txt, and return the full text content in markdown format.

Workflow:
1. Use searchWeb to find relevant pages for the user's question
2. If the search results don't provide enough detail, use scrapePages to get the full content of the most relevant pages
3. Provide comprehensive answers based on the scraped content, always citing sources with markdown links
4. When discussing time-sensitive information, reference the current date and publication dates of sources

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
                date: result.date,
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

          // Span for saving complete chat history
          const saveChatSpan = trace.span({
            name: "save-complete-chat-history",
            input: {
              chatId: currentChatId,
              userId: session.user.id,
              messageCount: updatedMessages.length,
              title: lastMessage.content.slice(0, 50) + "...",
            },
          });

          try {
            // Save the complete chat history
            await upsertChat({
              userId: session.user.id,
              chatId: currentChatId,
              title: lastMessage.content.slice(0, 50) + "...",
              messages: updatedMessages,
            });

            saveChatSpan.end({
              output: {
                success: true,
                chatId: currentChatId,
                totalMessages: updatedMessages.length,
              },
            });
          } catch (error) {
            saveChatSpan.end({
              output: {
                error: error instanceof Error ? error.message : "Unknown error",
                success: false,
              },
            });
            throw error;
          }

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
