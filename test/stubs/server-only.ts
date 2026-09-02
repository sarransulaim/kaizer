/* `server-only` throws when imported outside a React Server Component. The
   modules under test import it as a guard rail; in a unit test there is no
   server boundary to protect, so it resolves to nothing. */
export {}
