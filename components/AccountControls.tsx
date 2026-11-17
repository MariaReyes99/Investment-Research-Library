'use client';

import Link from 'next/link';
import { SignInButton, UserButton, useAuth } from '@clerk/nextjs';

function ClerkAccountControls() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button type="button" className="account-link account-button">Log in</button>
      </SignInButton>
    );
  }
  return <UserButton />;
}

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Sign-in and plan links. Renders only the Plans link when Clerk isn't configured. */
export default function AccountControls({ showProjector = false }: { showProjector?: boolean }) {
  return (
    <div className="account-controls">
      {showProjector && <Link className="account-link only-mobile" href="/?tab=numbers">My retirement picture</Link>}
      <Link className="account-link" href="/pricing">Pricing</Link>
      {clerkEnabled && <ClerkAccountControls />}
    </div>
  );
}
