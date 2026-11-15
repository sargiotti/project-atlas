import { createContext, useContext } from "react";

/** The Admin's pending count (the badge on the avatar and the Pending menu item). Memory only; refreshed from
 * /auth/me, decision responses and the Pending list total. Organizers always see 0. */
export const PendingContext = createContext<{ count: number; setCount: (n: number) => void }>({ count: 0, setCount: () => {} });
export const usePending = () => useContext(PendingContext);
