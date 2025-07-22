import { generateObject } from "ai";
import { z } from "zod";
import { model } from "~/model";

export type OurMessageAnnotation = {
  type: "NEW_ACTION";
  action: Action;
};

type QueryResultSearchResult = {
  date: string;
  title: string;
  url: string;
  snippet: string;
};

type QueryResult = {
  query: string;
  results: QueryResultSearchResult[];
};

type ScrapeResult = {
  url: string;
  result: string;
};

export interface SearchAction {
  title: string;
  reasoning: string;
  type: "search";
  query: string;
}

export interface ScrapeAction {
  title: string;
  reasoning: string;
  type: "scrape";
  urls: string[];
}

export interface AnswerAction {
  title: string;
  reasoning: string;
  type: "answer";
}

export type Action = SearchAction | ScrapeAction | AnswerAction;

export const actionSchema = z.object({
  title: z
    .string()
    .describe(
      "The title of the action, to be displayed in the UI. Be extremely concise. 'Searching Saka's injury history', 'Checking HMRC industrial action', 'Comparing toaster ovens'",
    ),
  reasoning: z.string().describe("The reason you chose this step."),
  type: z.enum(["search", "scrape", "answer"]).describe(
    `The type of action to take.
      - 'search': Search the web for more information.
      - 'scrape': Scrape a URL.
      - 'answer': Answer the user's question and complete the loop.`,
  ),
  query: z
    .string()
    .describe("The query to search for. Required if type is 'search'.")
    .optional(),
  urls: z
    .array(z.string())
    .describe("The URLs to scrape. Required if type is 'scrape'.")
    .optional(),
});

const toQueryResult = (query: QueryResultSearchResult) =>
  [`### ${query.date} - ${query.title}`, query.url, query.snippet].join("\n\n");

export class SystemContext {
  /**
   * The current step in the loop
   */
  private step = 0;

  /**
   * The history of all queries searched
   */
  private queryHistory: QueryResult[] = [];

  /**
   * The history of all URLs scraped
   */
  private scrapeHistory: ScrapeResult[] = [];

  shouldStop() {
    return this.step >= 10;
  }

  incrementStep() {
    this.step++;
  }

  getStep() {
    return this.step;
  }

  reportQueries(queries: QueryResult[]) {
    this.queryHistory.push(...queries);
  }

  reportScrapes(scrapes: ScrapeResult[]) {
    this.scrapeHistory.push(...scrapes);
  }

  getQueryHistory(): string {
    return this.queryHistory
      .map((query) =>
        [
          `## Query: "${query.query}"`,
          ...query.results.map(toQueryResult),
        ].join("\n\n"),
      )
      .join("\n\n");
  }

  getScrapeHistory(): string {
    return this.scrapeHistory
      .map((scrape) =>
        [
          `## Scrape: "${scrape.url}"`,
          `<scrape_result>`,
          scrape.result,
          `</scrape_result>`,
        ].join("\n\n"),
      )
      .join("\n\n");
  }
}

export const getNextAction = async (
  context: SystemContext,
  userQuestion: string,
): Promise<Action> => {
  const result = await generateObject({
    model,
    schema: actionSchema,
    prompt: `
You are a helpful AI assistant with access to real-time web search capabilities. The current date and time is ${new Date().toLocaleString()}.

Your goal is to help answer the user's question: "${userQuestion}"

You have three possible actions:
1. 'search' - Search the web for more information
2. 'scrape' - Scrape specific URLs to get detailed content
3. 'answer' - Answer the user's question when you have enough information

Guidelines:
- Always search the web for up-to-date information when relevant
- After finding relevant URLs from search results, scrape the most promising 4-6 URLs to get full content
- Choose diverse sources (news sites, blogs, official documentation, etc.)
- Prioritize official sources and authoritative websites
- Only answer when you have comprehensive information from multiple sources
- If you're unsure about something, search or scrape more sources to verify

Current context:

${context.getQueryHistory()}

${context.getScrapeHistory()}

Based on the above context and the user's question, what should be the next action?
    `,
  });

  return result.object as Action;
};
