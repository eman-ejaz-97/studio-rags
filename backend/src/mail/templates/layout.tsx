import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';
import { colour, fonts, heading, muted } from './theme';

export interface EmailLayoutProps {
  /** The line inboxes show after the subject. Hidden in the email itself. */
  preview: string;
  title: string;
  children: ReactNode;
}

/**
 * The frame every Studio Rags email shares: the name in plum on cream paper,
 * one white rounded card holding the message, and a short footer.
 */
export function EmailLayout({ preview, title, children }: EmailLayoutProps) {
  return (
    <Html lang="en-AU" dir="ltr">
      <Head>
        {/* Our colours are chosen for a light ground. Saying so stops some
            clients inverting them into low-contrast pairs. */}
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{title}</title>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colour.paper,
          margin: 0,
          padding: '24px 0 32px',
        }}
      >
        <Container style={{ maxWidth: '560px', padding: '0 16px' }}>
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: '24px',
              lineHeight: '32px',
              fontWeight: 700,
              color: colour.plum,
              margin: '0 0 16px',
            }}
          >
            Studio Rags
          </Text>
          <Section
            style={{
              backgroundColor: colour.card,
              border: `1px solid ${colour.line}`,
              borderRadius: '20px',
              padding: '32px 28px',
            }}
          >
            <Heading as="h1" style={heading}>
              {title}
            </Heading>
            {children}
          </Section>
          <Text style={{ ...muted, margin: '20px 0 0', textAlign: 'center' }}>
            Studio Rags · Batik and textile workshops in Sefton Park, Adelaide
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
