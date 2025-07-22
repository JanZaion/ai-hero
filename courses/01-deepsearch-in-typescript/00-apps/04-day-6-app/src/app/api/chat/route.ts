import type { Message } from "ai";
import {
  createDataStreamResponse,
  appendResponseMessages,
  streamText,
} from "ai";
import { auth } from "~/server/auth";
import { upsertChat } from "~/server/db/queries";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { chats } from "~/server/db/schema";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { runAgentLoop } from "~/run-agent-loop";
import type { OurMessageAnnotation } from "~/system-context";
import { model } from "~/model";

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

      // Get the user's question from the latest message
      const userQuestion = messages[messages.length - 1]?.content || "";

      try {
        // Run the agent loop with annotation callback and full conversation history
        const result = await runAgentLoop(
          userQuestion,
          messages,
          (annotation: OurMessageAnnotation) => {
            dataStream.writeMessageAnnotation(annotation as any);
          },
        );

        // Stream the final answer
        const streamResult = streamText({
          model,
          prompt: result,
        });

        streamResult.mergeIntoDataStream(dataStream);

        // Wait for the stream to complete
        await streamResult.text;

        // Save the complete chat history
        const lastMessage = messages[messages.length - 1];
        if (lastMessage) {
          await upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: [
              ...messages,
              {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: result,
              },
            ],
          });
        }

        await langfuse.flushAsync();
      } catch (error) {
        console.error("Error in agent loop:", error);

        // Stream an error message
        const errorResult = streamText({
          model,
          prompt:
            "I apologize, but I encountered an error while processing your request. Please try again.",
        });

        errorResult.mergeIntoDataStream(dataStream);
      }
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });
}
