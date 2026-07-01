/**
 * Read-only + propose LLM chat route.
 *
 * INVARIANT: NO tool here signs or submits a transaction.
 * The propose tools return structured proposals only.
 * Execution is client-side via executeTransaction (zkLogin + Shinami sponsor).
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
  buildContactMap,
} from '@/lib/propose';
import { resolveVault } from '@/lib/resolve-vault';

function buildSystemPrompt(contactNames: string[]): string {
  const contactList =
    contactNames.length > 0
      ? `Saved contacts (these are the only valid labels for proposeSend): ${contactNames.join(', ')}.`
      : 'No contacts saved yet. If the user asks to send to someone by name, call proposeSend — it will return a "not_a_payee" block and you can suggest they add the contact in the Contacts tab.';

  return `You are the CashPan money assistant — warm, plain, and concise.

CashPan has two pockets:
- Spend: funds ready to use
- Save: funds earning yield

${contactList}

## Reading data
Call getBalances, getEarnings, getAgentActivity, or getConfig whenever you need live data. Never guess balances from memory.

## Proposing money moves
When the user's intent to move money is clear, immediately call the matching propose tool. These tools validate the move from fresh on-chain reads and return a proposal — they do NOT execute anything. A confirmation card appears in the UI for the user to tap.

- proposeSend({ amount, payeeLabel }) — "send mom $10", "pay Alex 5"
- proposeWithdrawToMe({ amount }) — "give me back $10", "withdraw to my wallet"
- proposeSweep({ amount? }) — "put aside $50", "save $20", "move to savings"
- proposeTopup({ amount }) — "move $20 to spending", "top up", "I need cash"

Amounts are human decimals in ${COIN_SYMBOL} (e.g. "10" = $10.00). Always speak dollars.

## After receiving a proposal result
- If blocked: explain the reason warmly in one or two sentences and suggest what the user can do.
- If not blocked: one sentence confirming what you've queued (e.g. "Queued a send of $10 to mom."). Do NOT say "tap Confirm" or "please confirm" — the card handles that. Don't repeat the numbers — the card shows them.

## When intent is unclear
If the user's message doesn't map to a balance read, a money move, or a clear question, reply warmly in one sentence and give a concrete example:
"I didn't quite get that — try something like 'send mom $5', 'put $20 in Save', or 'what's my balance?'"

## Hard rules
- All amounts are ${COIN_SYMBOL}. Speak in dollars ($10.00, $50, etc.), never in raw base units.
- Never sign or submit. The propose tools only compute; tapping Confirm is what executes.`;
}

export async function POST(req: Request) {
  const [reqForVault, reqForBody] = [req, req.clone()];
  const { messages } = await reqForBody.json();
  const vault = await resolveVault(reqForVault);
  const { vaultId } = vault;

  const contacts = vault.contacts ?? [];
  const contactMap = buildContactMap(contacts);
  const contactNames = contacts.map((c) => c.label);

  const result = streamText({
    model: openai('gpt-5-nano'),
    system: buildSystemPrompt(contactNames),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      // ── 3a reads ──────────────────────────────────────────────────────────

      getBalances: tool({
        description: 'Get current balances (spend pocket, savings pocket, total).',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getBalances(vaultId);
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
        description: 'Get accrued interest earned and yield rate (bps/epoch).',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getEarnings(vaultId, vault.savingsPrincipal ?? '0');
          return {
            [`accrued${COIN_SYMBOL}`]: baseToHuman(raw.accrued, 6),
            aprBps: raw.aprBps,
          };
        },
      }),

      getAgentActivity: tool({
        description: 'Get recent on-chain agent events (sweeps, topups, withdrawals, sends, deposits).',
        inputSchema: jsonSchema<{ limit?: number }>({
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max events to return (default 10, max 50)' },
          },
          additionalProperties: false,
        }),
        execute: async ({ limit }: { limit?: number }) => {
          const events = await getAgentActivity(limit ?? 10, vaultId);
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
        description: 'Get vault config: buffer, caps, payout address.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getConfig(vaultId);
          const b = (s: string) => baseToHuman(s, 4);
          return {
            buffer: raw.buffer,
            band: raw.band,
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
          'Propose sending to a named payee. Returns a proposal the user must confirm. Call this when the user says "send X to Y", "pay X", etc.',
        inputSchema: jsonSchema<{ amount: string; payeeLabel: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount as a decimal string, e.g. "10"' },
            payeeLabel: { type: 'string', description: 'Payee label (e.g. "mom"). Must match a known payee.' },
          },
          required: ['amount', 'payeeLabel'],
          additionalProperties: false,
        }),
        execute: async ({ amount, payeeLabel }: { amount: string; payeeLabel: string }) =>
          proposeSend(amount, payeeLabel, vaultId, contactMap),
      }),

      proposeWithdrawToMe: tool({
        description:
          'Propose withdrawing from the spend pocket to the owner\'s payout address. Call this for "give me back", "withdraw to my wallet", etc.',
        inputSchema: jsonSchema<{ amount: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount, e.g. "10"' },
          },
          required: ['amount'],
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount: string }) => proposeWithdrawToMe(amount, vaultId),
      }),

      proposeSweep: tool({
        description:
          'Propose moving money from Spend to Save (sweep). Call this for "put aside", "save", "move to savings". Amount is optional — omit to sweep all available Spend balance.',
        inputSchema: jsonSchema<{ amount?: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount (optional)' },
          },
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount?: string }) => proposeSweep(amount, vaultId),
      }),

      proposeTopup: tool({
        description:
          'Propose moving from savings to the spend pocket (topup). Call this for "move to spending", "top up", "I need cash".',
        inputSchema: jsonSchema<{ amount: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount, e.g. "10"' },
          },
          required: ['amount'],
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount: string }) => proposeTopup(amount, vaultId),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
