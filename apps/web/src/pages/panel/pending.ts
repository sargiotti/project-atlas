import { createContext, useContext } from "react";

/** The Admin's pending count (the badge on the avatar and the Pending menu item). Memory only; refreshed from
 * /auth/me, decision responses and the Pending list total. Organizers always see 0. */
export const PendingContext = createContext<{ count: number; setCount: (n: number) => void }>({ count: 0, setCount: () => {} });
export const usePending = () => useContext(PendingContext);

/** The signed-in organizer's id (from /auth/me), for things scoped per account such as the Points draft key. */
export const MeContext = createContext<{ organizerId: string | null; displayName?: string }>({ organizerId: null });
export const useMe = () => useContext(MeContext);
