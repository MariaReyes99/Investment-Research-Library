import type { Metadata } from 'next';
import CalculatorRedirect from './CalculatorRedirect';

export const metadata: Metadata = {
  title: 'Wealth projector · Investment Research Library',
  description: 'The wealth projector now sits with the library, in the "My numbers" tab.',
};

/** The projector moved onto the library page. Old links (including #plan= links) still work. */
export default function CalculatorPage() {
  return <CalculatorRedirect />;
}
