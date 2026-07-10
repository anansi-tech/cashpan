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
import { COIN_SYMBOL } from '@/lib/coin-config';
import { formatMoney, floorToDecimals, floorCentsBase } from '@/lib/format';
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
- proposeTopup({ amount?, keepInSave? }) — "move $20 to spending", "top up", "I need cash". Omit amount for "move everything/all/max"; use keepInSave for "keep $X, move the rest". Never compute those amounts from balances yourself.

Amounts are human decimals in ${COIN_SYMBOL} (e.g. "10" = $10.00). Always speak dollars.

## After receiving a proposal result
- If blocked: explain the reason warmly in one or two sentences and suggest what the user can do.
- If not blocked: output NOTHING — no text at all, end your turn. The confirmation card shown in the UI IS the response; any narration ("Queued…", "I've set up…") duplicates it.

## When intent is unclear
If the user's message doesn't map to a balance read, a money move, or a clear question, reply warmly in one sentence and give a concrete example:
"I didn't quite get that — try something like 'send mom $5', 'put $20 in Save', or 'what's my balance?'"

## Hard rules
- All amounts are ${COIN_SYMBOL}. Speak in dollars ($10.00, $50, etc.), never in raw base units.
- Money values in tool results are pre-formatted display strings (e.g. "1,234.56"). Repeat them EXACTLY as given with a $ prefix — never recompute, reformat, or round them.
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
          // Pre-formatted to the cent, floored — identical to the dashboard.
          // Total = sum of floored pockets (same arithmetic as LiveDashboard),
          // so the three numbers always reconcile.
          const liquid = floorCentsBase(raw.liquid);
          const savings = floorCentsBase(raw.savingsValue);
          return {
            [`spendPocket${COIN_SYMBOL}`]: formatMoney(liquid),
            [`savingsPocket${COIN_SYMBOL}`]: formatMoney(savings),
            [`total${COIN_SYMBOL}`]: formatMoney(liquid + savings),
          };
        },
      }),

      getEarnings: tool({
        description: 'Get accrued interest earned and current yield rate.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const raw = await getEarnings(vaultId);
          // Same precision as the dashboard's earned chip (4dp, floored).
          return {
            [`accrued${COIN_SYMBOL}`]: floorToDecimals(raw.accrued, 4),
            apr: `${(Number(raw.aprBps) / 100).toFixed(1)}%`,
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
          // No epoch fields — internal jargon, not user-facing.
          return events.map(({ text, type, direction, timestampMs }) => ({
            text,
            type,
            direction,
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
          return {
            buffer: raw.buffer,
            band: raw.band,
            perTxCap: formatMoney(raw.perTxCap),
            dailyCap: formatMoney(raw.dailyCap),
            outflowPerTxCap: formatMoney(raw.outflowPerTxCap),
            outflowDailyCap: formatMoney(raw.outflowDailyCap),
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
          'Propose moving from savings to the spend pocket (topup). Call this for "move to spending", "top up", "I need cash". ' +
          'OMIT amount entirely when the user wants everything ("move all/everything/max to spend") — that drains Save exactly to $0. ' +
          'Use keepInSave (and omit amount) for "keep $X in save, move the rest". Never compute these amounts yourself.',
        inputSchema: jsonSchema<{ amount?: string; keepInSave?: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount, e.g. "10". Omit to move everything.' },
            keepInSave: { type: 'string', description: 'Amount to leave in Save; the rest moves to Spend. E.g. "19".' },
          },
          additionalProperties: false,
        }),
        execute: async ({ amount, keepInSave }: { amount?: string; keepInSave?: string }) =>
          proposeTopup(amount, vaultId, keepInSave),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
