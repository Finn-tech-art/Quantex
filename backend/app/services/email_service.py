import html as html_module

import httpx

from app.config import settings

RESEND_API_URL = "https://api.resend.com/emails"

# The Quantex brand mark (the "Psi" glyph — see quantex-design-system-spec_2.md
# Section 2) as an absolute URL, since an <img> tag inside an EMAIL (unlike a
# webpage) can't reference a local/relative file — the recipient's mail
# client fetches it straight from the public internet, with no build step or
# bundler involved. Built from settings.frontend_origin (the same env var
# CORS already uses) rather than a hardcoded domain, so this automatically
# points at wherever the frontend is actually deployed — e.g. locally it'll
# resolve to http://localhost:5173/favicon.svg (a broken image in a test
# email, since nothing external can reach your dev machine, which is fine —
# it only matters once FRONTEND_ORIGIN is a real public domain in
# production). Swap this path if the logo file's name/location ever changes;
# nothing else below needs to change.
#
# Caveat worth knowing: Outlook's desktop app (not outlook.com's website)
# doesn't render SVG images in emails at all — it'll just show a blank
# space where the logo would be. Every other major client (Gmail, Apple
# Mail, the Outlook mobile app, outlook.com) renders it fine. Good enough
# for a personal project; if that gap ever matters, the fix is exporting a
# PNG version of favicon.svg and pointing this at that file instead.
LOGO_URL = f"{settings.frontend_origin}/favicon.svg"


async def send_email(to: str, subject: str, html: str) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.resend_from_email,
                "to": [to],
                "subject": subject,
                "html": html,
            },
        )
        response.raise_for_status()


def _escape(value: str) -> str:
    """Escapes a value before it goes into the HTML string below — every
    value rendered into this email (the OTP code is always digits so it's
    safe either way, but heading/details values can contain a user-chosen
    asset code or an arbitrary destination address) gets run through this
    first so nothing in it is ever interpreted as HTML/JS by the recipient's
    mail client. Just Python's stdlib html.escape — no extra dependency."""
    return html_module.escape(str(value))


def render_otp_email(code: str, heading: str, details: list[tuple[str, str]] | None = None) -> str:
    """Builds the full HTML body Resend sends for every OTP-code email this
    app has (email verification, withdrawal confirmation — see
    otp_service.generate_and_send_otp, the only caller). One shared template
    for both rather than two separate ones, so a branding tweak (logo,
    colors, footer text) only ever needs to change in this one place.

    code: the 6-digit code itself, rendered large and spaced out.
    heading: the one-line, per-purpose headline under the logo — e.g.
        "Verify your email" or "Confirm withdrawal of 50 USDT".
    details: optional list of (label, value) rows rendered as a plain
        key/value table between the heading and the code — e.g. a
        withdrawal's network/destination/fee. None (the default) renders no
        table at all, which is what plain email verification uses.

    Colors below are copy-pasted hex values, NOT var(--...) tokens from
    index.css — email HTML is sent to Resend as a standalone string with no
    build step and no access to the frontend's CSS at all, so the design
    system's CSS custom properties don't exist here. These exact hex values
    ARE those tokens' values (see quantex-design-system-spec_2.md Section 1)
    copied by hand; if a token's value ever changes there, update it here
    too to keep emails visually matching the app.
    """
    TEAL_BASE = "#0E6B62"    # --teal-base — heading text, code, table labels
    INK_BASE = "#211D16"     # --ink-base — body copy
    INK_SOFT = "#6B6152"     # --ink-soft — footer/fine-print text
    CREAM_DEEP = "#EEE6D3"   # --cream-deep — the details table's background
    CREAM_LINE = "#E0D5BE"   # --cream-line — borders/dividers

    # Renders nothing at all (empty string) when details is None/empty,
    # rather than an empty table — this is what keeps the plain email-
    # verification message exactly as simple as before, with no visual
    # leftover from this feature existing for withdrawals.
    details_html = ""
    if details:
        rows = "".join(
            f"""
            <tr>
              <td style="padding: 8px 0; color: {INK_SOFT}; font-size: 13px;">{_escape(label)}</td>
              <td style="padding: 8px 0; color: {INK_BASE}; font-size: 13px; font-weight: 600; text-align: right;">{_escape(value)}</td>
            </tr>
            """
            for label, value in details
        )
        details_html = f"""
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background: {CREAM_DEEP}; border: 1px solid {CREAM_LINE}; border-radius: 12px; padding: 4px 16px; margin: 20px 0;">
          {rows}
        </table>
        """

    return f"""
    <div style="font-family: 'Space Grotesk', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <!-- Logo + wordmark header — mark on the left, "Quantex" text beside
           it, matching the design system's horizontal lockup (Section 2's
           "Wordmark" note: mark left, wordmark right). A <table> here
           rather than flexbox: email clients (Outlook especially) have
           notoriously poor/inconsistent flexbox and even plain block/inline
           layout support, so table-based layout is the actual standard for
           HTML email, not a webpage-era leftover — the details table below
           uses the same approach for the same reason. -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
        <tr>
          <td style="padding-right: 10px;">
            <img src="{LOGO_URL}" alt="Quantex" width="28" height="28" style="display: block;" />
          </td>
          <td style="font-size: 18px; font-weight: 700; color: {TEAL_BASE};">Quantex</td>
        </tr>
      </table>

      <h2 style="font-size: 18px; color: {INK_BASE}; margin: 0 0 8px;">{_escape(heading)}</h2>
      <p style="font-size: 14px; color: {INK_SOFT}; margin: 0 0 4px;">Your verification code is:</p>

      <p style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: {TEAL_BASE}; margin: 12px 0;">{code}</p>

      {details_html}

      <p style="font-size: 13px; color: {INK_SOFT}; margin: 20px 0 0;">
        This code expires in 10 minutes. If you didn't request this, you can safely ignore this email —
        no changes will be made to your account.
      </p>

      <!-- Footer — plain copyright line, separated by a hairline border
           matching --cream-line. Update the year/copy here directly if it
           ever needs to change; nothing else in this file references it. -->
      <div style="border-top: 1px solid {CREAM_LINE}; margin-top: 28px; padding-top: 16px;">
        <p style="font-size: 11px; color: {INK_SOFT}; margin: 0;">Quantex &middot; This is an automated message, please don't reply to it.</p>
      </div>
    </div>
    """
