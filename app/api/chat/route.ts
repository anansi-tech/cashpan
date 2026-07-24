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
import { COIN_SYMBOL, humanToBase } from '@/lib/coin-config';
import { formatMoney, floorToDecimals, floorCentsBase } from '@/lib/format';
import { getBalances, getEarnings, getAgentActivity, getConfig } from '@/lib/read-layer';
import {
  proposeSend,
  proposeWithdrawToMe,
  proposeSweep,
  proposeTopup,
  proposeRecurringSend,
  buildContactMap,
} from '@/lib/propose';
import { resolveVault } from '@/lib/resolve-vault';
import { guardNumericAmount, guardDrain, guardExactAmount } from '@/lib/propose-guard';
import { listPolicies } from '@/lib/db/policies';
import { scheduleSentence, nextRun, type PolicySchedule } from '@/lib/policy-schedule';
import { suiNetwork } from '@/lib/sui';

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
Call getBalances, getEarnings, getAgentActivity, or getConfig whenever you need live data. Never guess balances from memory. For "what are my standing orders?" / "what do I send automatically?" call getStandingOrders.

## Proposing money moves
When the user's intent to move money is clear, immediately call the matching propose tool. These tools validate the move from fresh on-chain reads and return a proposal — they do NOT execute anything. A confirmation card appears in the UI for the user to tap.

- proposeSend({ amount, payeeLabel }) — "send mom $10", "pay Alex 5"
- proposeWithdrawToMe({ amount }) — "give me back $10", "withdraw to my wallet"
- proposeSweep({ amount }) — "put aside $50", "save $20". Amount is REQUIRED and must be the number the user said.
- proposeSweepAll({}) — ONLY for "save everything", "sweep it all". Takes no amount.
- proposeTopup({ amount }) — "move $20 to spending", "top me up with $5". Amount is REQUIRED and must be the number the user said.
- proposeDrainSave({ keepInSave? }) — ONLY for "move everything/all/max to spend" (no arguments) or "keep $X in save, move the rest" (keepInSave). NEVER call this when the user names an amount to move — use proposeTopup. Never compute amounts from balances yourself.
- proposeRecurringSend({ amount, payeeLabel, frequency, dayOfWeek?, dayOfMonth?, dateUTC?, timeUTC? }) — "send mom $20 every Friday", "pay rent $50 on the 1st monthly". Amount is REQUIRED and must be the number the user said. This AUTHORS a standing order the user must confirm — it never executes or schedules anything itself.

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
  const vault = await resolveVault(reqForVault).catch(() => null);
  if (!vault) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const { vaultId } = vault;

  const contacts = vault.contacts ?? [];
  const contactMap = buildContactMap(contacts);
  const contactNames = contacts.map((c) => c.label);

  // Last user message text — the amount guards compare proposals against the
  // numbers the user actually typed.
  const lastUserText: string = (() => {
    const arr = messages as Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]?.role === 'user') {
        return (arr[i].parts ?? []).filter((p) => p.type === 'text').map((p) => p.text ?? '').join(' ');
      }
    }
    return '';
  })();

  // Every propose-tool call is logged: misparse incidents ("top me up with 5
  // dollars" → drain-all, 3x) are only diagnosable with the emitted args.
  const logTool = (name: string, args: unknown) =>
    console.log(`[chat:tool] ${name}`, JSON.stringify(args), '| user:', JSON.stringify(lastUserText.slice(0, 120)));

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
          'Propose moving a SPECIFIC amount from Spend to Save. Call this for "put aside $50", "save $20". ' +
          'The amount is REQUIRED and must be the number the user said. For "save everything" use proposeSweepAll.',
        inputSchema: jsonSchema<{ amount: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount the user named, e.g. "50"' },
          },
          required: ['amount'],
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount: string }) => {
          logTool('proposeSweep', { amount });
          const p = await proposeSweep(amount, vaultId);
          const guard = guardNumericAmount(lastUserText, amount, humanToBase(p.spendBalance));
          if (!guard.ok) {
            return { rejected: true, message: `The user said $${guard.userNumber} — call proposeSweep again with amount "${guard.userNumber}".` };
          }
          return p;
        },
      }),

      proposeSweepAll: tool({
        description:
          'Propose sweeping the ENTIRE Spend balance to Save. ONLY for "save everything", "sweep it all", "move all my money to savings". ' +
          'NEVER call this when the user names an amount — use proposeSweep.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          logTool('proposeSweepAll', {});
          const p = await proposeSweep(undefined, vaultId);
          const guard = guardDrain(lastUserText, humanToBase(p.spendBalance));
          if (!guard.ok) {
            return { rejected: true, message: `The user named $${guard.userNumber} — call proposeSweep with amount "${guard.userNumber}" instead.` };
          }
          return p;
        },
      }),

      proposeTopup: tool({
        description:
          'Propose moving a SPECIFIC amount from savings to the spend pocket. Call this for "move $20 to spending", "top me up with $5". ' +
          'The amount is REQUIRED and must be the number the user said. For "move everything" use proposeDrainSave.',
        inputSchema: jsonSchema<{ amount: string }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount the user named, e.g. "5"' },
          },
          required: ['amount'],
          additionalProperties: false,
        }),
        execute: async ({ amount }: { amount: string }) => {
          logTool('proposeTopup', { amount });
          const p = await proposeTopup(amount, vaultId);
          const guard = guardNumericAmount(lastUserText, amount, humanToBase(p.savingsSui));
          if (!guard.ok) {
            return { rejected: true, message: `The user said $${guard.userNumber} — call proposeTopup again with amount "${guard.userNumber}".` };
          }
          return p;
        },
      }),

      getStandingOrders: tool({
        description: 'List the user\'s standing orders (recurring/scheduled sends): what, to whom, when, next run, status.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          const policies = await listPolicies(vaultId, suiNetwork());
          if (policies.length === 0) return { standingOrders: [], note: 'No standing orders set up.' };
          return {
            standingOrders: policies.map((p) => {
              const s = p.schedule as PolicySchedule;
              const next = p.status === 'active' ? nextRun(s, new Date()) : null;
              return {
                sentence: `${scheduleSentence(s)}, send $${formatMoney(BigInt(p.amountBase))} to ${p.recipient.label}`,
                status: p.status,
                nextRun: next ? next.toISOString() : null,
              };
            }),
          };
        },
      }),

      proposeRecurringSend: tool({
        description:
          'AUTHOR a standing order (recurring send) for the user to confirm — never executes anything. ' +
          'Call for "send X to Y every <weekday>", "pay Y $X monthly on the Nth", "send Y $X on <date>". ' +
          'The amount is REQUIRED and must be the number the user said.',
        inputSchema: jsonSchema<{
          amount: string; payeeLabel: string;
          frequency: 'weekly' | 'monthly' | 'once';
          dayOfWeek?: number; dayOfMonth?: number; dateUTC?: string; timeUTC?: string;
        }>({
          type: 'object',
          properties: {
            amount: { type: 'string', description: 'Amount the user named, e.g. "20"' },
            payeeLabel: { type: 'string', description: 'Payee label (e.g. "mom"). Must match a known contact.' },
            frequency: { type: 'string', enum: ['weekly', 'monthly', 'once'] },
            dayOfWeek: { type: 'number', description: 'Weekly only. ISO: 1=Monday … 7=Sunday.' },
            dayOfMonth: { type: 'number', description: 'Monthly only. 1–31 (29–31 run on the last day of shorter months).' },
            dateUTC: { type: 'string', description: 'Once only. YYYY-MM-DD.' },
            timeUTC: { type: 'string', description: 'HH:MM 24h UTC. Omit unless the user named a time — defaults to 13:00 UTC.' },
          },
          required: ['amount', 'payeeLabel', 'frequency'],
          additionalProperties: false,
        }),
        execute: async ({ amount, payeeLabel, frequency, dayOfWeek, dayOfMonth, dateUTC, timeUTC }) => {
          logTool('proposeRecurringSend', { amount, payeeLabel, frequency, dayOfWeek, dayOfMonth, dateUTC, timeUTC });
          // Standing orders execute forever — strictest guard: the amount must
          // BE a number the user typed whenever their message contains one.
          const guard = guardExactAmount(lastUserText, amount);
          if (!guard.ok) {
            return { rejected: true, message: `The user said $${guard.userNumber} — call proposeRecurringSend again with amount "${guard.userNumber}".` };
          }
          // gpt-5-nano sends optional params as "" instead of omitting them —
          // blank means unset, never a validation error.
          const schedule: PolicySchedule = {
            kind: frequency,
            dayOfWeek, dayOfMonth,
            dateUTC: dateUTC?.trim() ? dateUTC.trim() : undefined,
            timeUTC: timeUTC?.trim() ? timeUTC.trim() : '13:00',
          };
          const active = await listPolicies(vaultId, suiNetwork());
          const activeTotal = active.filter((p) => p.status === 'active')
            .reduce((sum, p) => sum + BigInt(p.amountBase), 0n);
          const proposal = await proposeRecurringSend(amount, payeeLabel, schedule, vaultId, contactMap, {
            activePolicyTotalBase: activeTotal,
            autopilotOn: !!vault.autopilot?.enabled,
          });
          // A malformed schedule is the MODEL's error, not the user's — return
          // a rejection it can silently fix (same pattern as the amount guard)
          // instead of rendering developer-speak in a card. User-decision
          // blocks (not_a_payee, exceeds_per_tx_cap) still render as cards.
          if (proposal.blocked === 'invalid_schedule') {
            return { rejected: true, message: `Schedule invalid: ${proposal.blockedDetail ?? 'bad arguments'} — fix the arguments and call proposeRecurringSend again.` };
          }
          return proposal;
        },
      }),

      proposeDrainSave: tool({
        description:
          'Propose moving EVERYTHING from Save to Spend (drains savings to $0), or everything except keepInSave. ' +
          'ONLY for "move everything/all/max to spend" or "keep $X in save, move the rest". ' +
          'NEVER call this when the user names an amount to move — use proposeTopup.',
        inputSchema: jsonSchema<{ keepInSave?: string }>({
          type: 'object',
          properties: {
            keepInSave: { type: 'string', description: 'Amount to leave in Save; the rest moves to Spend. E.g. "19".' },
          },
          additionalProperties: false,
        }),
        execute: async ({ keepInSave }: { keepInSave?: string }) => {
          logTool('proposeDrainSave', { keepInSave });
          const p = await proposeTopup(undefined, vaultId, keepInSave);
          const guard = guardDrain(lastUserText, humanToBase(p.savingsSui), keepInSave);
          if (!guard.ok) {
            return { rejected: true, message: `The user said $${guard.userNumber} — that is a specific amount, not "everything". Call proposeTopup with amount "${guard.userNumber}".` };
          }
          return p;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
