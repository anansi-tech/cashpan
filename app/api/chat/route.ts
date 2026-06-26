/**
 * Read-only + propose LLM chat route.
 *
 * INVARIANT: NO tool here signs or submits a transaction.
 * The propose tools return structured proposals only.
 * /api/execute (a separate endpoint, NOT registered here) is the only signer.
 *
 * grep this file for signAndExecuteTransaction, Transaction, owner_send,
 * agent_send, withdraw → none present.
 */

import { streamText, tool, convertToModelMessages, jsonSchema, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { baseToHuman, COIN_SYMBOL } from '@/lib/coin-config';
import { getBalances, getEarnings, getAgentActivity, getConfig } from '@/lib/read-layer';
import {
  proposeSend,
  proposeWithdrawToMe,
  proposeSweep,
  proposeTopup,
  getPayeeMap,
} from '@/lib/propose';

function buildSystemPrompt(): string {
  const payees = getPayeeMap();
  const labels = Object.keys(payees);
  const payeeList =
    labels.length > 0
      ? `Known payees (these are the only valid labels for proposeSend): ${labels.join(', ')}.`
      : 'No payees are configured yet — proposeSend will always block with "not_a_payee" until the user adds entries to their PAYEES env config.';

  return `You are the CashPan money assistant — warm, plain, and concise.

CashPan has two pockets:
- Spend pocket: liquid funds ready to use
- Savings pocket: funds earning yield, managed automatically by the agent

The agent sweeps excess liquid to savings and tops up when the spend pocket runs low.

${payeeList}

## Reading data
Call getBalances, getEarnings, getAgentActivity, or getConfig whenever you need live data. Never guess balances from memory.

## Proposing money moves
When the user's intent to move money is clear, immediately call the matching propose tool. These tools validate the move from fresh on-chain reads and return a proposal — they do NOT execute anything. A confirmation card appears in the UI for the user to tap.

- proposeSend({ amount, payeeLabel }) — "send mom $10", "pay Alex 5"
- proposeWithdrawToMe({ amount }) — "give me back $10", "withdraw to my wallet"
- proposeSweep({ amount? }) — "put aside $50", "sweep everything", "move to savings"
- proposeTopup({ amount }) — "move $20 to spending", "top up my spend pocket"

Amounts are human decimals in ${COIN_SYMBOL} (e.g. "10" = $10.00). Always speak dollars.

## After receiving a proposal result
- If blocked: explain the reason warmly in one or two sentences and suggest what the user can do.
- If not blocked: one sentence confirming what you've queued (e.g. "Queued a send of $10 to mom."). Do NOT say "tap Confirm" or "please confirm" — the card handles that. Don't repeat the numbers — the card shows them.

## Hard rules
- All amounts are ${COIN_SYMBOL}. Speak in dollars ($10.00, $50, etc.), never in raw base units.
- Never sign or submit. The propose tools only compute; tapping Confirm is what executes.
- Owner cap, owner key: never referenced here. Agent cap only for chat moves.`;
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      // ── 3a reads ──────────────────────────────────────────────────────────

      getBalances: tool({
        description: 'Get current balances (spend pocket, savings pocket, total) in SUI.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getBalances();
          const h = (s: string) => baseToHuman(s, 6);
          return {
            [`spendPocket${COIN_SYMBOL}`]: h(raw.liquid),
            [`savingsPocket${COIN_SYMBOL}`]: h(raw.savingsValue),
            [`total${COIN_SYMBOL}`]: h(raw.total),
            currentEpoch: raw.currentEpoch,
          };
        },
      }),

      getEarnings: tool({
        description: 'Get accrued interest earned (in SUI) and yield rate (bps/epoch).',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getEarnings();
          return {
            [`accrued${COIN_SYMBOL}`]: baseToHuman(raw.accrued, 6),
            rateBpsPerEpoch: raw.aprBps,
          };
        },
      }),

      getAgentActivity: tool({
        description: 'Get recent on-chain agent events (sweeps, topups, withdrawals, sends).',
        inputSchema: jsonSchema<{ limit?: number }>({
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max events to return (default 10, max 50)' },
          },
          additionalProperties: false,
        }),
        execute: async ({ limit }: { limit?: number }) => {
          const events = await getAgentActivity(limit ?? 10);
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
        description: 'Get vault config: buffer, caps, payout address. All SUI amounts in SUI.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getConfig();
          // buffer/band are human decimals in .env; on-chain caps are base units
          const b = (s: string) => baseToHuman(s, 4);
          return {
            buffer: raw.buffer,      // already human decimal (e.g. "50")
            band: raw.band,          // already human decimal (e.g. "5")
            perTxCap: b(raw.perTxCap),
            dailyCap: b(raw.dailyCap),
            outflowPerTxCap: b(raw.outflowPerTxCap),
            outflowDailyCap: b(raw.outflowDailyCap),
            payoutAddress: raw.payoutAddress,
            symbol: COIN_SYMBOL,
          };
        },
      }),

      // ── 3b proposal tools (read + validate; no signing) ───────────────────

      proposeSend: tool({
        description:
          'Propose sending SUI to a named payee. Returns a proposal the user must confirm. Call this when the user says "send X to Y", "pay X", etc.',
        inputSchema: jsonSchema<{ amount: string; payeeLabel: string }>({
          type: 'object',
          properties: {
            amount: {
              type: 'string',
              description: 'Amount in SUI as a decimal string, e.g. "0.05"',
            },
            payeeLabel: {
              type: 'string',
              description: 'Payee label (e.g. "mom"). Must match a known payee.',
            },
          },
          required: ['amount', 'payeeLabel'],
          additionalProperties: false,
        }),
        execute: async ({ amount, payeeLabel }: { amount: string; payeeLabel: string }) =>
          proposeSend(amount, payeeLabel),
      }),

      proposeWithdrawToMe: tool({
        description:
          'Propose withdrawing SUI from the spend pocket to the owner\'s payout address. Call this for "give me back", "withdraw to my wallet", etc.',
        inputSchema: jsonSchema<{ amount: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount in SUI, e.g. "0.1"' },
          },
          required: ['amount'],
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount: string }) => proposeWithdrawToMe(amount),
      }),

      proposeSweep: tool({
        description:
          'Propose moving liquid SUI to the savings pocket (sweep). Call this for "put aside", "save", "move to savings". Amount is optional — omit to sweep as much as the per-tx cap allows.',
        inputSchema: jsonSchema<{ amount?: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount in SUI (optional)' },
          },
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount?: string }) => proposeSweep(amount),
      }),

      proposeTopup: tool({
        description:
          'Propose moving SUI from savings to the spend pocket (topup). Call this for "move to spending", "top up", "I need cash".',
        inputSchema: jsonSchema<{ amount: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount in SUI, e.g. "0.1"' },
          },
          required: ['amount'],
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount: string }) => proposeTopup(amount),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
