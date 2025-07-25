import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  appendResponseMessages,
} from "ai";
import { z } from "zod";
import { model } from "~/models";
import { auth } from "~/server/auth";
import { searchSerper } from "~/serper";
import {
  checkRateLimit,
  addUserRequest,
  upsertChat,
} from "~/server/db/queries";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Check rate limit
  const rateLimitResult = await checkRateLimit(session.user.id);

  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        message: `You have exceeded your daily limit of ${rateLimitResult.limit} requests. Please try again tomorrow.`,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Limit": rateLimitResult.limit.toString(),
        },
      },
    );
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId: string;
    isNewChat: boolean;
  };

  const { messages, chatId, isNewChat } = body;

  // Generate a chat title from the first user message
  const firstUserMessage = messages.find((msg) => msg.role === "user");
  const chatTitle = firstUserMessage?.content?.slice(0, 100) || "New Chat";

  // Create or update chat before starting the stream
  await upsertChat({
    userId: session.user.id,
    chatId: chatId,
    title: chatTitle,
    messages,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // Record the request
      await addUserRequest(session.user.id);

      // If this is a new chat, send the new chat ID to the frontend
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: chatId,
        });
      }

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
        onFinish({ text, finishReason, usage, response }) {
          const responseMessages = response.messages;

          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages,
          });

          // Save the complete conversation to the database
          upsertChat({
            userId: session.user.id,
            chatId: chatId,
            title: chatTitle,
            messages: updatedMessages,
          }).catch((error) => {
            console.error("Failed to save chat:", error);
          });
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
