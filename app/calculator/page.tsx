import type { Metadata } from 'next';
import CalculatorRedirect from './CalculatorRedirect';

export const metadata: Metadata = {
  title: 'Retirement picture · Research Library · DebtFreedomIQ',
  description: 'My retirement picture now sits with the library, in the "My retirement picture" tab.',
};

/** The projector moved onto the library page. Old links (including #plan= links) still work. */
export default function CalculatorPage() {
  return <CalculatorRedirect />;
}
