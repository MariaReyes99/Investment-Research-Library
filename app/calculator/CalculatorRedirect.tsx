'use client';
import { useEffect } from 'react';

export default function CalculatorRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'numbers');
    // The hash (a shared plan) never reaches the server, so it is carried over here, on the device.
    window.location.replace(`/?${params.toString()}${window.location.hash}`);
  }, []);
  return (
    <main className="page-main">
      <p>The wealth projector is now on the library page. <a href="/?tab=numbers">Open My numbers →</a></p>
    </main>
  );
}
