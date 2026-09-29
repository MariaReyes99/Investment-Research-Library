/**
 * Answer check for questions that ask for a personal recommendation
 * ("Should I sell…?", "Which ETF is best for me?").
 *
 * For these questions only, the answer TEXT is held back until it is complete,
 * checked for advice-style wording, rewritten once if needed, and replaced with
 * a safe fallback if the rewrite still fails. Tool activity (library searches
 * and projections) streams through straight away, so sources and charts still
 * appear while the answer is being checked. Other questions stream normally.
 */
import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';
import { outputRedFlags, SAFE_FALLBACK } from './advice';

export type GuardEvent =
  | { stage: 'passed' }
  | { stage: 'rewritten'; reasons: string[] }
  | { stage: 'fallback'; reasons: string[] };

export function adviceGuardTransform<TOOLS extends ToolSet>(opts: {
  /** Rewrite an answer that failed the check. Should not throw; errors fall back. */
  rewrite: (draft: string) => Promise<string>;
  onResult?: (event: GuardEvent) => void;
}): StreamTextTransform<TOOLS> {
  return () => {
    let draft = '';
    let released = false;

    async function checkedText(): Promise<string> {
      const reasons = outputRedFlags(draft);
      if (reasons.length === 0) {
        opts.onResult?.({ stage: 'passed' });
        return draft;
      }
      try {
        const rewritten = (await opts.rewrite(draft)).trim();
        if (rewritten && outputRedFlags(rewritten).length === 0) {
          opts.onResult?.({ stage: 'rewritten', reasons });
          return rewritten;
        }
      } catch {
        /* fall through to the safe fallback */
      }
      opts.onResult?.({ stage: 'fallback', reasons });
      return SAFE_FALLBACK;
    }

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(part, controller) {
        if (part.type === 'text-delta') {
          draft += part.textDelta; // hold back
          return;
        }
        if (part.type === 'finish' && !released) {
          released = true;
          const text = await checkedText();
          if (text) controller.enqueue({ type: 'text-delta', textDelta: text } as TextStreamPart<TOOLS>);
        }
        controller.enqueue(part); // tool calls, results, step markers, errors, finish
      },
      // If the stream ends without a normal finish (an error), unchecked text is
      // never released.
    });
  };
}
