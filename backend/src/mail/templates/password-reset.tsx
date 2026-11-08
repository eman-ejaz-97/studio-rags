import { Button, Link, Section, Text } from '@react-email/components';
import { EmailLayout } from './layout';
import * as theme from './theme';

export const PASSWORD_RESET_TEMPLATE = 'password-reset';

export interface PasswordResetProps {
  firstName: string;
  /** The whole link, token included. A live credential: never log it. */
  resetUrl: string;
  /** How long the link works, for the wording. */
  expiresInMinutes: number;
}

export const passwordResetSubject = () => 'Reset your Studio Rags password';

/** "one hour", "30 minutes", "2 hours" */
function describeMinutes(minutes: number): string {
  if (minutes === 60) return 'one hour';
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

export function PasswordResetEmail({
  firstName,
  resetUrl,
  expiresInMinutes,
}: PasswordResetProps) {
  const lifetime = describeMinutes(expiresInMinutes);

  return (
    <EmailLayout
      title="Choose a new password"
      preview={`The link inside works for ${lifetime}.`}
    >
      <Text style={theme.text}>Hi {firstName},</Text>
      <Text style={theme.text}>
        Someone asked to reset the password for your Studio Rags account. If
        that was you, choose a new password with the button below.
      </Text>
      <Section style={{ margin: '8px 0 24px' }}>
        <Button href={resetUrl} style={theme.button}>
          Choose a new password
        </Button>
      </Section>
      <Text style={theme.text}>
        The link works once, and stops working after {lifetime}.
      </Text>
      <Text style={theme.muted}>
        If the button does not work, copy this link into your browser:{' '}
        <Link href={resetUrl} style={theme.link}>
          {resetUrl}
        </Link>
      </Text>
      <Text style={theme.text}>
        If you did not ask for this, you can ignore this email. Your password
        stays as it is.
      </Text>
      <Text style={{ ...theme.text, margin: 0 }}>
        Warm wishes,
        <br />
        Studio Rags
      </Text>
    </EmailLayout>
  );
}
