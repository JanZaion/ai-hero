// Note: You'll want to modify these evals, since they may be out of date.
// You should choose your own evals because we are actively testing for recency.

import type { Message } from "ai";
import { evalite } from "evalite";
import { runAgentLoop } from "~/run-agent-loop";
import { Factuality } from "~/factuality-scorer";

evalite("Arsenal Eval", {
  data: async (): Promise<{ input: string; expected: string }[]> => {
    return [
      {
        input: "Who is Arsenal's top scorer this season?",
        expected: `Arsenal's top scorer this season varies based on the current date, but typically includes players like Bukayo Saka, Gabriel Jesus, or Martin Ødegaard among the leading goal scorers.`,
      },
    ];
  },
  task: async (input) => {
    return runAgentLoop(input, () => {}); // no-op function for writeMessageAnnotation
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        // Regular expression to match markdown links [text](url)
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/;
        const containsLinks = markdownLinkRegex.test(output);
        return containsLinks ? 1 : 0;
      },
    },
    Factuality,
  ],
});
