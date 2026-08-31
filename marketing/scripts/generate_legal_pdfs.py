"""
Generates the two legal PDFs served at /legal/terms-of-service.pdf and
/legal/privacy-policy.pdf. The PDFs under marketing/public/legal are BUILD
OUTPUT, not hand-edited files -- to change the wording, edit the
`tos_sections` / `privacy_sections` lists below and re-run this script;
never edit a .pdf directly.

Requires Python 3 + the `fpdf2` package (`pip install fpdf2`). This is a
one-off content-generation script run by hand when the legal text changes,
not part of `npm run build` -- the generated PDFs are checked in as static
files under public/legal, same as any other static asset in this project.

Usage (from the marketing/ directory):
    python scripts/generate_legal_pdfs.py
"""
import os
from fpdf import FPDF
from fpdf.enums import XPos, YPos

TEAL = (14, 107, 98)
INK = (42, 38, 32)
INK_SOFT = (107, 99, 87)
EFFECTIVE_DATE = "August 31, 2026"


class LegalPDF(FPDF):
    """A4-ish Letter-size PDF with a small "QUANTEX / <doc title>" running
    header, a page-number footer, and a few helper methods (title_block,
    h2, body, bullet) so the two documents below can be defined as plain
    data (see tos_sections / privacy_sections) rather than a wall of
    manual drawing calls."""

    def __init__(self, doc_title):
        super().__init__(format="Letter")
        self.doc_title = doc_title
        self.set_auto_page_break(auto=True, margin=22)
        self.set_margins(22, 20, 22)

    def header(self):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*TEAL)
        self.cell(60, 6, "QUANTEX", new_x=XPos.RIGHT, new_y=YPos.TOP)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*INK_SOFT)
        self.cell(0, 6, self.doc_title, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(*INK_SOFT)
        self.set_line_width(0.2)
        self.line(22, 16, self.w - 22, 16)
        self.ln(6)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*INK_SOFT)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def title_block(self, title, subtitle):
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(*INK)
        self.multi_cell(0, 10, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*INK_SOFT)
        self.multi_cell(0, 6, subtitle, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(4)

    def h2(self, text):
        self.ln(2)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(*TEAL)
        self.multi_cell(0, 8, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(1)

    def body(self, text):
        self.set_font("Helvetica", "", 10.5)
        self.set_text_color(*INK)
        self.multi_cell(0, 5.6, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def bullet(self, text):
        self.set_font("Helvetica", "", 10.5)
        self.set_text_color(*INK)
        x = self.get_x()
        self.cell(5, 5.6, chr(149), new_x=XPos.RIGHT, new_y=YPos.TOP)
        self.set_x(x + 5)
        self.multi_cell(0, 5.6, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def build(doc_title, subtitle, sections, out_path):
    """sections is a list of (heading, body_text_or_None, bullets_or_None)
    tuples, rendered top to bottom in order."""
    pdf = LegalPDF(doc_title)
    pdf.add_page()
    pdf.title_block(doc_title, subtitle)
    for heading, body_text, bullets in sections:
        pdf.h2(heading)
        if body_text:
            pdf.body(body_text)
        for b in bullets or []:
            pdf.bullet(b)
        if bullets:
            pdf.ln(2)
    pdf.output(out_path)
    print("wrote", out_path)


# ---------------------------------------------------------------------------
# Terms of Service
# ---------------------------------------------------------------------------
# NOTE ON SCOPE: this is template/placeholder legal content written for a
# personal hobby project (see the hobby-project-scope note in the repo's
# assistant memory) -- it is deliberately generic where a real, commercial
# custodial platform would need actual legal counsel to fill in specifics
# (governing law/jurisdiction, a registered entity name, precise liability
# caps, a real fee schedule). If this project is ever repositioned to take
# on real users depositing real money, this text needs a real legal review
# before it can be relied on -- it is not that today.
tos_sections = [
    ("1. Acceptance of these Terms",
     "By creating a Quantex account or using any part of the Quantex service, "
     "you agree to these Terms of Service. If you do not agree, do not create "
     "an account or use the service.", None),

    ("2. What Quantex Is",
     "Quantex is a custodial crypto trading platform. You deposit crypto into "
     "a Quantex-controlled wallet, and Quantex holds it on your behalf in a "
     "single pooled master exchange account. From there you can trade spot "
     "markets yourself, or deploy an automated bot (Grid, DCA, or Momentum) "
     "that trades on your behalf within the parameters you set. Quantex is "
     "not a bank, brokerage, or investment advisor, and nothing on this site "
     "or in the app is investment advice.", None),

    ("3. Eligibility",
     "You must be at least 18 years old to use Quantex. You are responsible "
     "for confirming that using a crypto trading platform is lawful where "
     "you live before you sign up.", None),

    ("4. Your Account",
     "You can register with an email and password or with Google sign-in. "
     "You are responsible for keeping your login credentials secure and for "
     "all activity that happens under your account.", None),

    ("5. Identity Verification (KYC)",
     "Depositing, creating a bot, and trading do not require identity "
     "verification. Before your first withdrawal, you will be asked to "
     "submit a government-issued ID (front and back) and a selfie. "
     "Submissions are reviewed manually; Quantex aims to review within a "
     "few business days but does not guarantee a specific turnaround time. "
     "Quantex may reject a submission or ask for a resubmission if it is "
     "unclear or does not appear genuine.", None),

    ("6. Risk Disclosure",
     "Cryptocurrency prices are volatile. Trading, whether done by you "
     "manually or by an automated bot, can result in the loss of some or "
     "all of the funds involved. Past performance of any strategy, including "
     "Grid, DCA, and Momentum bots, is not a guarantee of future results. "
     "Quantex does not guarantee a profit or protect against loss. You "
     "should only deposit funds you can afford to put at risk.", None),

    ("7. Fees",
     "Certain actions on Quantex, such as withdrawals, may carry a fee. "
     "Current fees are shown in the app at the time you take the relevant "
     "action, and may change over time.", None),

    ("8. Custody and Execution",
     "Deposits are pooled and traded from a single master exchange account "
     "under Quantex's control. Your in-app balance reflects your share of "
     "that pool, tracked internally as an append-only ledger. The API keys "
     "Quantex uses to trade on the underlying exchange are configured for "
     "trading only and never carry withdrawal permission on that exchange.", None),

    ("9. Prohibited Uses",
     "You agree not to use Quantex for money laundering, terrorist "
     "financing, market manipulation, or any other illegal activity, and "
     "not to attempt to circumvent identity verification or interfere with "
     "the platform's operation.", None),

    ("10. Suspension and Termination",
     "Quantex may suspend or close an account that violates these Terms, "
     "including a KYC submission that appears fraudulent. Quantex will make "
     "reasonable efforts to return any remaining balance to a suspended "
     "account holder, subject to completing identity verification.", None),

    ("11. Service Provided As Is",
     "Quantex is provided on an \"as is\" and \"as available\" basis, "
     "without warranties of any kind. To the maximum extent permitted by "
     "law, Quantex is not liable for indirect, incidental, or consequential "
     "damages arising from your use of the service, including trading "
     "losses.", None),

    ("12. Changes to These Terms",
     "Quantex may update these Terms from time to time. Continuing to use "
     "the service after an update means you accept the revised Terms.", None),

    ("13. Contact",
     "Questions about these Terms can be sent to support@onquantex.com.", None),
]

# ---------------------------------------------------------------------------
# Privacy Policy
# ---------------------------------------------------------------------------
privacy_sections = [
    ("1. Overview",
     "This policy explains what information Quantex collects, why, and how "
     "it is stored, for anyone who creates a Quantex account.", None),

    ("2. Information We Collect",
     "Quantex collects the following categories of information:", [
         "Account information: your email address, and either a password "
         "or a Google account identifier if you sign in with Google.",
         "Identity verification documents: a government-issued ID (front "
         "and back) and a selfie, submitted only when you choose to make "
         "your first withdrawal.",
         "Transaction data: deposits, withdrawals, bot configurations, "
         "and trading activity within your account.",
         "Basic technical data: standard information your browser sends "
         "to any website you visit, such as IP address and browser type.",
     ]),

    ("3. How We Use Your Information",
     "Quantex uses this information to operate your account: crediting "
     "deposits, running the bots you configure, processing withdrawals, "
     "reviewing identity verification submissions, sending you transactional "
     "emails and browser notifications (deposit confirmed, withdrawal "
     "approved, bot paused, KYC approved or rejected), and responding to "
     "support requests. Quantex does not sell your personal information.", None),

    ("4. How Identity Documents Are Stored",
     "ID documents and selfies are stored in a private, access-restricted "
     "storage bucket, separate from your regular account data. Only the "
     "review team can access them, through short-lived signed links "
     "generated at review time. They are not shared with the exchange "
     "Quantex trades on, since trading runs from a single pooled account "
     "rather than one connected per user.", None),

    ("5. Service Providers",
     "Quantex relies on a small number of service providers to operate: a "
     "database and authentication provider, an email provider for "
     "transactional messages, and the underlying exchange used for trade "
     "execution. These providers only receive the information needed to "
     "perform their specific function.", None),

    ("6. Data Retention",
     "Account and transaction data is kept for as long as your account is "
     "active and for a reasonable period after, to resolve disputes and "
     "meet basic recordkeeping needs. Identity documents are retained only "
     "as long as needed for the purpose they were collected for.", None),

    ("7. Your Choices",
     "You can update your account details in-app, and can ask Quantex to "
     "close your account and delete data that Quantex is not otherwise "
     "required to keep, by contacting support.", None),

    ("8. Security",
     "Exchange API keys used to trade on your behalf are configured for "
     "trading only and can never withdraw funds. Withdrawals from Quantex "
     "itself require identity verification before they can be requested. "
     "No method of storing or transmitting data is 100% secure, and Quantex "
     "cannot guarantee absolute security.", None),

    ("9. Children",
     "Quantex is not directed at, and does not knowingly collect "
     "information from, anyone under 18.", None),

    ("10. Changes to This Policy",
     "Quantex may update this policy from time to time. Material changes "
     "will be reflected by updating the effective date above.", None),

    ("11. Contact",
     "Questions about this policy can be sent to support@onquantex.com.", None),
]

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(script_dir, "..", "public", "legal")
    os.makedirs(out_dir, exist_ok=True)
    build(
        "Terms of Service",
        f"Effective {EFFECTIVE_DATE}",
        tos_sections,
        os.path.join(out_dir, "terms-of-service.pdf"),
    )
    build(
        "Privacy Policy",
        f"Effective {EFFECTIVE_DATE}",
        privacy_sections,
        os.path.join(out_dir, "privacy-policy.pdf"),
    )
