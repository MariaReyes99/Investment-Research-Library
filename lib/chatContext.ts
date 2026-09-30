/**
 * Carries the numbers behind earlier projections into follow-up questions.
 *
 * The chat only sends text to the model, so without this a follow-up like
 * "given my plan above, what if I retire at 67?" can't see the ages, balances
 * and incomes that plan used. For the two most recent projections, the tool
 * inputs are re-checked against the projection schemas (anything invalid or
 * unknown is dropped) and attached as a short note to that answer.
 */
import { HouseholdInputSchema } from './finance/household';
import { ProjectionInputSchema } from './finance/projections';

const MAX_NOTE_CHARS = 6000;
const TOOLS = {
  projectHousehold: HouseholdInputSchema,
  projectWealth: ProjectionInputSchema,
} as const;

type Invocation = { toolName?: unknown; args?: unknown; state?: unknown };

/** A note describing the projection shown with an answer, or '' if there wasn't one. */
export function projectionNote(toolInvocations: unknown): string {
  if (!Array.isArray(toolInvocations)) return '';
  for (const inv of [...(toolInvocations as Invocation[])].reverse()) {
    const name = inv?.toolName;
    if (name !== 'projectHousehold' && name !== 'projectWealth') continue;
    if (inv.state !== undefined && inv.state !== 'result') continue;
    const parsed = TOOLS[name].safeParse(inv.args);
    if (!parsed.success) continue;
    const json = JSON.stringify(parsed.data);
    if (json.length > MAX_NOTE_CHARS) continue;
    return `\n\n[PREVIOUS PROJECTION shown with this answer. Tool: ${name}. Inputs: ${json}]`;
  }
  return '';
}
