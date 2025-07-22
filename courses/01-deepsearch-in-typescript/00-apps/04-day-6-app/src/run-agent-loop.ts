import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/server/scraper";
import {
  SystemContext,
  getNextAction,
  type Action,
  type OurMessageAnnotation,
} from "~/system-context";
import { answerQuestion } from "./answer-question";

// Copy of the search function from deep-search.ts
async function searchWeb(query: string) {
  const results = await searchSerper({ q: query, num: 10 }, undefined);

  return results.organic.map((result) => ({
    title: result.title,
    link: result.link,
    snippet: result.snippet,
    date: result.date || "",
  }));
}

// Copy of the scrape function from deep-search.ts
async function scrapeUrl(urls: string[]) {
  const results = await bulkCrawlWebsites({ urls });

  if (!results.success) {
    return {
      error: results.error,
      results: results.results.map(({ url, result }) => ({
        url,
        success: result.success,
        data: result.success ? result.data : result.error,
      })),
    };
  }

  return {
    results: results.results.map(({ url, result }) => ({
      url,
      success: result.success,
      data: result.data,
    })),
  };
}

export async function runAgentLoop(
  userQuestion: string,
  writeMessageAnnotation?: (annotation: OurMessageAnnotation) => void,
): Promise<string> {
  // A persistent container for the state of our system
  const ctx = new SystemContext();

  // A loop that continues until we have an answer
  // or we've taken 10 actions
  while (!ctx.shouldStop()) {
    // We choose the next action based on the state of our system
    const nextAction = await getNextAction(ctx, userQuestion);

    // Send annotation about the action we're taking
    if (writeMessageAnnotation) {
      writeMessageAnnotation({
        type: "NEW_ACTION",
        action: nextAction,
      } satisfies OurMessageAnnotation);
    }

    // We execute the action and update the state of our system
    if (nextAction.type === "search") {
      const searchResults = await searchWeb(nextAction.query);
      ctx.reportQueries([
        {
          query: nextAction.query,
          results: searchResults.map((result) => ({
            date: result.date,
            title: result.title,
            url: result.link,
            snippet: result.snippet,
          })),
        },
      ]);
    } else if (nextAction.type === "scrape") {
      const scrapeResults = await scrapeUrl(nextAction.urls);
      if (scrapeResults.results) {
        ctx.reportScrapes(
          scrapeResults.results
            .filter((result) => result.success)
            .map((result) => ({
              url: result.url,
              result: result.data,
            })),
        );
      }
    } else if (nextAction.type === "answer") {
      return await answerQuestion(ctx, userQuestion, { isFinal: false });
    }

    // We increment the step counter
    ctx.incrementStep();
  }

  // If we've taken 10 actions and still don't have an answer,
  // we ask the LLM to give its best attempt at an answer
  return await answerQuestion(ctx, userQuestion, { isFinal: true });
}
