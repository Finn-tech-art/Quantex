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


def send_email_sync(to: str, subject: str, html: str) -> None:
    """Identical to send_email() above, just synchronous — for callers that
    run inside a Celery worker task (a plain sync function, no event loop
    available), unlike send_email()'s callers so far (otp_service.py's
    async FastAPI route handlers). Same pattern as this codebase's other
    sync/async pairs (e.g. redis_client.get_redis / get_redis_sync) — kept
    as two small functions rather than one that detects its caller's
    context, so each stays trivial to read."""
    response = httpx.post(
        RESEND_API_URL,
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={
            "from": settings.resend_from_email,
            "to": [to],
            "subject": subject,
            "html": html,
        },
        timeout=10,
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


def render_deposit_confirmed_email(
    amount: str,
    asset_code: str,
    network_name: str,
    tx_hash: str,
    explorer_url: str | None,
    credited_at: str,
    new_balance: str,
) -> str:
    """Builds the full HTML body for the "your deposit was credited" email —
    sent from chain_watcher_service._credit_deposit the moment a deposit is
    actually credited (never for an unconfirmed/pending sighting; there is
    deliberately no separate "we've spotted it, hang on" email today, only
    this one). Reuses the exact same header/footer/color-token structure as
    render_otp_email above (same reasoning: one visual language, one place
    to update it) but replaces that template's big verification-code number
    with a big "+amount asset" figure, and its plain details table now
    carries deposit specifics instead of an OTP's context rows.

    amount / asset_code: e.g. "20.000000" / "USDT" — rendered together as
        the headline figure, so pass amount already formatted the way it
        should appear (this function does no rounding/formatting itself).
    network_name: human label, e.g. "Tron (TRC-20)" — the caller reads this
        from the `networks` table rather than this module hardcoding it, so
        it can never drift from what the rest of the app calls each network.
    tx_hash: shown truncated (first 10 / last 8 chars) since a full TRC-20
        hash is 64 hex chars — too long to read as a table value — with the
        untruncated value only living in explorer_url's link target.
    explorer_url: a ready-to-use block-explorer link for this exact
        transaction (e.g. Tronscan), or None to omit the link entirely —
        this function has no per-network knowledge of explorer URL formats,
        that lives in chain_watcher_service._EXPLORER_TX_URL instead, so a
        new network's explorer format only ever needs to change in one file.
    credited_at: already-formatted string (e.g. "2026-09-01 13:22 UTC") —
        this function does no timezone/formatting work itself.
    new_balance: the user's resulting balance for this asset, already
        formatted as a plain decimal string.
    """
    TEAL_BASE = "#0E6B62"
    INK_BASE = "#211D16"
    INK_SOFT = "#6B6152"
    CREAM_DEEP = "#EEE6D3"
    CREAM_LINE = "#E0D5BE"

    details = [
        ("Network", network_name),
        ("Transaction ID", f"{tx_hash[:10]}…{tx_hash[-8:]}"),
        ("Credited at", credited_at),
        ("New balance", f"{new_balance} {asset_code}"),
    ]
    detail_rows = "".join(
        f"""
        <tr>
          <td style="padding: 8px 0; color: {INK_SOFT}; font-size: 13px;">{_escape(label)}</td>
          <td style="padding: 8px 0; color: {INK_BASE}; font-size: 13px; font-weight: 600; text-align: right;">{_escape(value)}</td>
        </tr>
        """
        for label, value in details
    )

    # Omitted entirely (not just left blank) when explorer_url is None, so a
    # future network without a known explorer format never renders a dead
    # link — see this function's own docstring on explorer_url.
    explorer_html = ""
    if explorer_url:
        explorer_html = f"""
        <p style="margin: 16px 0 0;">
          <a href="{_escape(explorer_url)}" style="color: {TEAL_BASE}; font-size: 13px; font-weight: 600; text-decoration: none;">
            View transaction on-chain &rarr;
          </a>
        </p>
        """

    return f"""
    <div style="font-family: 'Space Grotesk', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
        <tr>
          <td style="padding-right: 10px;">
            <img src="{LOGO_URL}" alt="Quantex" width="28" height="28" style="display: block;" />
          </td>
          <td style="font-size: 18px; font-weight: 700; color: {TEAL_BASE};">Quantex</td>
        </tr>
      </table>

      <h2 style="font-size: 18px; color: {INK_BASE}; margin: 0 0 8px;">Deposit confirmed</h2>
      <p style="font-size: 14px; color: {INK_SOFT}; margin: 0 0 4px;">Your deposit has been credited to your balance:</p>

      <p style="font-size: 36px; font-weight: 700; color: {TEAL_BASE}; margin: 12px 0;">+{_escape(amount)} {_escape(asset_code)}</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background: {CREAM_DEEP}; border: 1px solid {CREAM_LINE}; border-radius: 12px; padding: 4px 16px; margin: 20px 0;">
        {detail_rows}
      </table>

      {explorer_html}

      <p style="font-size: 13px; color: {INK_SOFT}; margin: 20px 0 0;">
        If you weren't expecting this deposit, please reach out so we can look into it.
      </p>

      <div style="border-top: 1px solid {CREAM_LINE}; margin-top: 28px; padding-top: 16px;">
        <p style="font-size: 11px; color: {INK_SOFT}; margin: 0;">Quantex &middot; This is an automated message, please don't reply to it.</p>
      </div>
    </div>
    """


def render_withdrawal_approved_email(
    amount: str,
    asset_code: str,
    network_name: str,
    destination_address: str,
    fee_amount: str,
    net_amount: str,
    approved_at: str,
) -> str:
    """Builds the full HTML body for the "your withdrawal was approved" email
    — sent from withdrawal_service.approve_withdrawal the moment an admin
    approves a request (never for PENDING or REJECTED — see that function's
    own comment for why REJECTED gets only an in-app notification, no
    email). Same shared header/footer/color-token structure as
    render_deposit_confirmed_email above, just with the details this
    direction of money movement actually needs: where it's going and what
    was deducted, rather than a transaction hash to look up (there's no
    broadcast worker yet to produce one — see withdrawal_service.py's module
    docstring).

    amount / asset_code: the amount the user originally requested, before
        the fee below is taken out — e.g. "100.000000" / "USDT".
    network_name: human label (e.g. "Tron (TRC-20)"), read from the
        `networks` table the same way render_deposit_confirmed_email's
        caller does, so it can never drift from what the rest of the app
        calls each network.
    destination_address: shown in full (not truncated) — same convention
        render_otp_email's withdrawal-confirmation details table already
        uses, so a user can double check it against what they typed.
    fee_amount / net_amount: already-computed strings — this function does
        no arithmetic itself.
    approved_at: already-formatted string (e.g. "2026-09-01 13:22 UTC").
    """
    TEAL_BASE = "#0E6B62"
    INK_BASE = "#211D16"
    INK_SOFT = "#6B6152"
    CREAM_DEEP = "#EEE6D3"
    CREAM_LINE = "#E0D5BE"

    details = [
        ("Amount requested", f"{amount} {asset_code}"),
        ("Network", network_name),
        ("Destination", destination_address),
        ("Fee", f"{fee_amount} {asset_code}"),
        ("Net amount sent", f"{net_amount} {asset_code}"),
        ("Approved at", approved_at),
    ]
    detail_rows = "".join(
        f"""
        <tr>
          <td style="padding: 8px 0; color: {INK_SOFT}; font-size: 13px;">{_escape(label)}</td>
          <td style="padding: 8px 0; color: {INK_BASE}; font-size: 13px; font-weight: 600; text-align: right;">{_escape(value)}</td>
        </tr>
        """
        for label, value in details
    )

    return f"""
    <div style="font-family: 'Space Grotesk', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
        <tr>
          <td style="padding-right: 10px;">
            <img src="{LOGO_URL}" alt="Quantex" width="28" height="28" style="display: block;" />
          </td>
          <td style="font-size: 18px; font-weight: 700; color: {TEAL_BASE};">Quantex</td>
        </tr>
      </table>

      <h2 style="font-size: 18px; color: {INK_BASE}; margin: 0 0 8px;">Withdrawal approved</h2>
      <p style="font-size: 14px; color: {INK_SOFT}; margin: 0 0 4px;">Your withdrawal request has been approved and sent:</p>

      <p style="font-size: 36px; font-weight: 700; color: {TEAL_BASE}; margin: 12px 0;">-{_escape(net_amount)} {_escape(asset_code)}</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background: {CREAM_DEEP}; border: 1px solid {CREAM_LINE}; border-radius: 12px; padding: 4px 16px; margin: 20px 0;">
        {detail_rows}
      </table>

      <p style="font-size: 13px; color: {INK_SOFT}; margin: 20px 0 0;">
        If you weren't expecting this, please reach out so we can look into it.
      </p>

      <div style="border-top: 1px solid {CREAM_LINE}; margin-top: 28px; padding-top: 16px;">
        <p style="font-size: 11px; color: {INK_SOFT}; margin: 0;">Quantex &middot; This is an automated message, please don't reply to it.</p>
      </div>
    </div>
    """
