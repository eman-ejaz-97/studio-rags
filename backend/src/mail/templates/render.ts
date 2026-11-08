import { toPlainText } from '@react-email/components';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** What React Email's own render() puts first; Outlook renders it best. */
const XHTML_DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

export interface RenderedEmail {
  html: string;
  /** The plain-text part, for clients and readers that do not show HTML. */
  text: string;
}

/**
 * React Email components rendered with React's own static renderer rather
 * than React Email's render(). That one loads react-dom/server with a dynamic
 * import(), which Jest cannot run without an experimental Node flag, so the
 * templates could not be tested. These emails have no Suspense or data
 * loading, which is all the async renderer adds, and static markup is what
 * React recommends for email. toPlainText is React Email's: it drops the
 * hidden preview line and images, and keeps each link's address.
 */
export function renderEmail(element: ReactElement): RenderedEmail {
  const html = `${XHTML_DOCTYPE}${renderToStaticMarkup(element)}`;
  return { html, text: toPlainText(html) };
}
