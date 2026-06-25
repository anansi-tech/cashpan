/**
 * Read-only LLM chat route.
 *
 * INVARIANT: the tool surface here is exactly the four read functions.
 * grep this file for signAndExecute, Transaction, owner_send, agent_send, withdraw → none present.
 *
 * The model can read state and answer; it cannot move money, by construction.
 */

import { streamText, tool, convertToModelMessages, jsonSchema, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getBalances, getEarnings, getAgentActivity, getConfig } from '@/lib/read-layer';

const SYSTEM_PROMPT = `You are the CashPan money assistant — warm, plain, and helpful for someone who is not crypto-savvy.

CashPan is a personal savings app on the Sui blockchain. It has two pockets:
- Spend pocket: liquid funds ready to use
- Savings pocket: funds earning yield automatically via the agent

The agent is an autonomous bot that sweeps excess funds to savings and tops up spending when it runs low.

Use plain language. Say "spend pocket" and "savings pocket" instead of "liquid" and "vault position". Values are in SUI (1 SUI = 1,000,000,000 MIST). Always call the read tools to get live data; never guess from memory.

If the user asks you to send, withdraw, move, or do anything that changes their vault: explain warmly that you can only read information right now. You have no ability to move money in this version — the write features come in a future update. Do not apologize excessively, just be clear and helpful.`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(3),
    tools: {
      getBalances: tool({
        description:
          'Get the current balances: liquid spend pocket, savings pocket value (principal + accrued interest), and total. All amounts are in SUI.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getBalances();
          const m = (s: string) => (Number(s) / 1e9).toFixed(6);
          return {
            spendPocketSui: m(raw.liquid),
            savingsPocketSui: m(raw.savingsValue),
            totalSui: m(raw.total),
            currentEpoch: raw.currentEpoch,
          };
        },
      }),

      getEarnings: tool({
        description: 'Get accrued interest earned so far (in SUI) and the yield rate in basis points per epoch.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getEarnings();
          return {
            accruedSui: (Number(raw.accrued) / 1e9).toFixed(6),
            rateBpsPerEpoch: raw.aprBps,
          };
        },
      }),

      getAgentActivity: tool({
        description:
          'Get recent on-chain events showing what the agent has been doing: sweeps to savings, topups to spending, withdrawals, sends.',
        inputSchema: jsonSchema<{ limit?: number }>({
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'How many recent events to return (default 10, max 50)',
            },
          },
          additionalProperties: false,
        }),
        execute: async ({ limit }: { limit?: number }) => {
          const events = await getAgentActivity(limit ?? 10);
          // amount fields are MIST; expose only the pre-formatted text to the model
          return events.map(({ text, type, direction, epochStr, timestampMs }) => ({
            text,
            type,
            direction,
            epochStr,
            timestampMs,
          }));
        },
      }),

      getConfig: tool({
        description:
          'Get vault configuration: buffer target, rebalance band, per-tx and daily caps, payout address. All SUI amounts shown in SUI.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getConfig();
          const m = (s: string) => (Number(s) / 1e9).toFixed(4);
          return {
            bufferSui: m(raw.buffer),
            bandSui: m(raw.band),
            perTxCapSui: m(raw.perTxCap),
            dailyCapSui: m(raw.dailyCap),
            outflowPerTxCapSui: m(raw.outflowPerTxCap),
            outflowDailyCapSui: m(raw.outflowDailyCap),
            payoutAddress: raw.payoutAddress,
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
