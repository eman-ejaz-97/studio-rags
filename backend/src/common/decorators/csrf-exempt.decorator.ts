import { SetMetadata } from '@nestjs/common';

export const CSRF_EXEMPT_KEY = 'csrfExempt';

/**
 * Opts a route out of the global CSRF check (CsrfGuard). Only for a route no
 * browser calls, which proves who is calling some other way: the Stripe
 * webhook, which Stripe calls server to server with no cookie, and signs.
 */
export const CsrfExempt = () => SetMetadata(CSRF_EXEMPT_KEY, true);
