#!/usr/bin/env python3
"""Generate the NCLAT1 Agile status sheet for the Studio Rags capstone."""

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, LongTable,
    TableStyle,
)

OUT = "/Users/eman/Projects/studio_rags/docs/client/NCLAT1_Agile_Status_StudioRags.pdf"

INK = colors.HexColor("#2B2B2B")
ACCENT = colors.HexColor("#1F3A5F")
MUTED = colors.HexColor("#6E6E6E")
GREEN = colors.HexColor("#C6E0B4")
BAND = colors.HexColor("#E8EDF4")
TODO = colors.HexColor("#B4451F")
LINE = colors.HexColor("#9AA5B1")

ss = getSampleStyleSheet()

H1 = ParagraphStyle("H1", parent=ss["Normal"], fontName="Helvetica-Bold",
                    fontSize=17, leading=21, textColor=ACCENT, spaceAfter=2)
SUB = ParagraphStyle("SUB", parent=ss["Normal"], fontName="Helvetica",
                     fontSize=9.5, leading=13, textColor=MUTED, spaceAfter=10)
H2 = ParagraphStyle("H2", parent=ss["Normal"], fontName="Helvetica-Bold",
                    fontSize=11.5, leading=15, textColor=ACCENT,
                    spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("BODY", parent=ss["Normal"], fontName="Helvetica",
                      fontSize=9.5, leading=13.5, textColor=INK,
                      alignment=TA_LEFT, spaceAfter=5)
CELL = ParagraphStyle("CELL", parent=ss["Normal"], fontName="Helvetica",
                      fontSize=8.5, leading=11.6, textColor=INK)
CELLB = ParagraphStyle("CELLB", parent=CELL, fontName="Helvetica-Bold")
HEAD = ParagraphStyle("HEAD", parent=CELL, fontName="Helvetica-Bold",
                      fontSize=9.5, leading=12, textColor=colors.white)
FOOT = ParagraphStyle("FOOT", parent=ss["Normal"], fontName="Helvetica-Oblique",
                      fontSize=8.5, leading=11.5, textColor=MUTED,
                      spaceBefore=8)


def todo(text):
    return f'<font color="#B4451F"><b>[{text}]</b></font>'


def bullets(items):
    return "<br/>".join(f"•&nbsp;{i}" for i in items)


# --------------------------------------------------------------------------
# Table content: (agile item, response, member, shaded)
# --------------------------------------------------------------------------

ROWS = [
    (
        "Why Agile / Scrum",
        "Our client is not technical and discovers her requirements as we ask "
        "questions. The four-week Master Class only appeared in her second round "
        "of answers, after the first requirements draft was written. A fixed "
        "plan set in July would already be out of date.<br/><br/>"
        "Scrum suits this because:<br/>"
        + bullets([
            "We re-plan every two weeks, so a new requirement is absorbed at the "
            "next sprint instead of breaking the plan.",
            "Each sprint ends with something we can show her. She responds far "
            "better to working screens than to documents.",
            "Blockers surface daily, which matters because our biggest delays "
            "come from waiting on client answers.",
            "The two trimesters divide naturally into short sprints, each with a "
            "review and a deliverable for the client meeting.",
        ]),
        "Whole team",
        False,
    ),
    (
        "Product Owner and Product",
        "<b>Product:</b> the Studio Rags workshop booking and payment web "
        "application. It lets customers browse, book and pay for textile-art "
        "workshops on the studio's own website, and gives the owner a dashboard "
        "to manage workshops, dates, bookings and customers. It replaces the "
        "current Wix plus Eventbrite setup.<br/><br/>"
        "<b>Product Owner: Sajina.</b> She is the team's main point of contact "
        "with the client, owns and prioritises the product backlog, and brings "
        "client decisions back to the team.<br/><br/>"
        "<b>External stakeholder:</b> Rehana Usman, Founder of Studio Rags. She "
        "approves scope and signs off deliverables.",
        "Sajina",
        True,
    ),
    (
        "Scrum Master",
        "<b>Bishal.</b> Responsibilities:<br/>"
        + bullets([
            "Runs the daily standup and the sprint planning, review and "
            "retrospective meetings.",
            "Tracks blockers and chases outstanding client answers before they "
            "hold up a sprint.",
            "Maintains the change log, so that requirements added after sign-off "
            "are recorded with their effect on the schedule.",
            "Protects the sprint scope once planning is agreed.",
        ]),
        "Bishal",
        True,
    ),
    (
        "Team",
        bullets([
            "<b>Eman Ejaz</b> — Developer. Backend (NestJS, PostgreSQL), "
            "frontend (Next.js), database design, payment integration, "
            "deployment.",
            "<b>Sajina</b> — Product Owner. Client communication, "
            "requirements gathering, backlog prioritisation.",
            "<b>Bishal</b> — Scrum Master. Process, ceremonies, blockers, "
            "change control.",
            "<b>Waqas</b> — Quality and testing. Test cases, acceptance "
            "testing against the criteria in the requirements mapping, "
            "accessibility checks, browser and device testing.",
            "<b>Jannatin</b> — Documentation. SRS, requirements and "
            "deliverables mapping, meeting minutes, user guide, final report.",
        ])
        + "<br/><br/>" + todo("Team confirms these role assignments"),
        "All members",
        True,
    ),
    (
        "Product Backlog<br/>(what is to be developed)",
        "Ordered by priority. Full detail is in the SRS v1.0 and the "
        "Requirements and Deliverables Mapping v2.0.<br/><br/>"
        + bullets([
            "<b>1.</b> Accounts and access — register, log in, password "
            "reset, customer and admin roles.",
            "<b>2.</b> Workshop catalogue — the 9 offers, detail pages, "
            "photographs.",
            "<b>3.</b> Session calendar — dates, times, places remaining.",
            "<b>4.</b> Booking and payment — full payment via Stripe before "
            "a booking is confirmed; no overbooking.",
            "<b>5.</b> Automated emails — confirmation and reminders to the "
            "customer, notifications to the admin.",
            "<b>6.</b> Master Class enrolments — paid in advance, four "
            "sessions taken within six months.",
            "<b>7.</b> Customer account — profile and booking history.",
            "<b>8.</b> Admin dashboard — upcoming classes, calendar, "
            "bookings, customers, prices and class sizes.",
            "<b>9.</b> Gift cards — purchase and redemption.",
            "<b>10.</b> Reviews — submission and moderation.",
            "<b>11.</b> Marketing and privacy — tracking readiness, "
            "consent, privacy notice.",
            "<b>12.</b> Launch — deployment, domain, client training and "
            "handover.",
        ]),
        "Sajina<br/>(owns and orders the backlog)",
        False,
    ),
    (
        "Sprint Backlog<br/>(Sprint 1, two weeks)",
        "<b>Sprint goal:</b> a working foundation — the database holds the "
        "real business, and a person can create an account and log in.<br/><br/>"
        + bullets([
            "Set up the project repository, coding standards and automated "
            "checks.",
            "Design and build the database schema: users, workshops, sessions, "
            "bookings, payments, enrolments.",
            "Load the 9 confirmed offers as starting data.",
            "Customer registration with email address and password.",
            "Log in and log out.",
            "Forgotten password reset by email.",
            "Separate customer and administrator access levels.",
            "Set up the local email catcher so no test email can reach a real "
            "person.",
            "Prepare the plain-language explanation of MoSCoW and Meta ad "
            "tracking for the client meeting.",
        ]),
        "Eman (build)<br/>Waqas (test)<br/>Jannatin (docs)",
        False,
    ),
    (
        "Justification for the<br/>Sprint 1 backlog<br/>(why these first?)",
        bullets([
            "<b>Everything else depends on it.</b> A booking must belong to a "
            "customer, and the admin dashboard needs an administrator to log "
            "in. Neither can be built before accounts exist.",
            "<b>The database is the foundation.</b> Changing it later means "
            "reworking everything built on top, so it is cheaper to get it right "
            "first.",
            "<b>It is not blocked by the client.</b> Four questions are still "
            "open with her, including how the Master Class runs and the refund "
            "policy. None of them affect this sprint, so we make progress while "
            "we wait.",
            "<b>It is not blocked by the brand kit.</b> The fonts are still "
            "being sourced from the client's Canva account, so visual design "
            "cannot start yet. This work does not need them.",
            "<b>Security is easier early than late.</b> Password handling and "
            "access levels are difficult to retrofit safely.",
        ]),
        "Whole team<br/>(agreed at sprint planning)",
        False,
    ),
    (
        "Daily standup<br/>agenda<br/>(Sprint 1)",
        "<b>15 minutes, same time each day, standing.</b> Each member answers:"
        "<br/>"
        + bullets([
            "What did I complete since the last standup?",
            "What will I complete today?",
            "What is blocking me?",
        ])
        + "<br/><br/><b>Then, two standing items:</b><br/>"
        + bullets([
            "Are we waiting on anything from the client? If a question has been "
            "outstanding more than three days, the Scrum Master follows it up "
            "that day.",
            "Is the sprint goal still achievable? If not, we say so now rather "
            "than at the review.",
        ])
        + "<br/><br/>Problems are noted, not solved, in the standup. Anything "
        "needing discussion is taken separately afterwards by the people "
        "involved.",
        "Bishal (chairs)<br/>All members attend",
        False,
    ),
    (
        "Sprint review<br/>meeting agenda",
        "<b>Held at the end of each sprint, about one hour.</b><br/>"
        + bullets([
            "<b>Demonstration.</b> Eman shows what actually works. Working "
            "software only — nothing partly finished is presented as done.",
            "<b>Acceptance check.</b> Waqas confirms each completed item against "
            "the acceptance criteria in the Requirements and Deliverables "
            "Mapping. Anything failing goes back to the backlog.",
            "<b>Client feedback.</b> Where the client attends, Sajina walks her "
            "through it and records her comments.",
            "<b>Backlog update.</b> New requests are added to the change log "
            "with an estimate of what they cost in time and what would move to "
            "fit them.",
            "<b>Next sprint planning.</b> The team agrees the goal and the items "
            "for the following sprint.",
            "<b>Retrospective.</b> What went well, what did not, and one change "
            "we will make next sprint.",
        ])
        + "<br/><br/>Jannatin records the minutes and the decisions, and "
        "circulates them within one day.",
        "Bishal (chairs)<br/>Jannatin (minutes)<br/>All members attend",
        False,
    ),
]


def build():
    doc = BaseDocTemplate(
        OUT, pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.4 * cm, bottomMargin=1.4 * cm,
        title="NCLAT1 — Agile Status — Studio Rags Capstone Project",
        author="Studio Rags Capstone Team",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height,
                  id="body", leftPadding=0, rightPadding=0,
                  topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame])])

    story = []
    story.append(Paragraph("NCLAT1 &mdash; Agile Project Status", H1))
    story.append(Paragraph(
        "Studio Rags Capstone Project &nbsp;·&nbsp; 4 August 2026 &nbsp;·&nbsp; "
        "Team: Eman Ejaz, Sajina, Bishal, Waqas, Jannatin", SUB))

    story.append(Paragraph("1. Is the project agreement done?", H2))
    story.append(Paragraph(
        "Yes, the client engagement is agreed and active. Rehana Usman of Studio "
        "Rags is engaged as the client, has attended the kick-off meeting, and "
        "has confirmed the project scope in writing by email on 4 August 2026."
        "<br/><br/>"
        "The Software Requirements Specification version 1.0 was issued to her "
        "for formal sign-off on the same date. Her written approval is pending "
        "at the time of writing.<br/><br/>"
        + todo("Confirm with the supervisor whether a separate university "
               "client agreement form is required, and attach it if so"),
        BODY))

    story.append(Paragraph("2. Current status of the project", H2))
    story.append(Paragraph(
        "<b>Phase: requirements confirmed, about to begin Sprint 1.</b>", BODY))
    story.append(Paragraph(
        "<b>Completed</b><br/>"
        + bullets([
            "Kick-off meeting held with the client and her requirements "
            "recorded.",
            "SRS version 0.1 drafted, with six items marked for client "
            "confirmation.",
            "All six confirmed by the client on 4 August 2026. The workshop list "
            "is final at 9 offers, the business has an ABN so online payments "
            "can go live, and a four-week Master Class was added.",
            "SRS updated to version 1.0 and issued for sign-off.",
            "Requirements and Deliverables Mapping updated to version 2.0, "
            "expanded from 8 user stories to 26, each traceable to a requirement "
            "code.",
            "Technical decisions made and recorded: NestJS and PostgreSQL for "
            "the backend, Next.js for the website, Stripe for payments, hosting "
            "in Sydney.",
            "Project repository set up with the backend, frontend and "
            "documentation structure.",
            "Domain recommendation prepared for the client, pending supervisor "
            "endorsement.",
        ]), BODY))
    story.append(Paragraph(
        "<b>In progress</b><br/>"
        + bullets([
            "Awaiting the client's written approval of SRS v1.0.",
            "Awaiting four client answers: how the Master Class runs in the "
            "studio, the cancellation and refund policy, how online class "
            "materials are provided, and how the kids class is priced.",
            "Sourcing the brand fonts, which are held in the client's Canva "
            "account.",
        ]), BODY))
    story.append(Paragraph(
        "<b>Next</b><br/>"
        + bullets([
            "Sprint 1: database schema and customer accounts.",
            "Online meeting with the client to settle the refund policy and "
            "explain MoSCoW and ad tracking.",
            "Begin design work once the brand assets are complete.",
        ]), BODY))
    story.append(Paragraph(
        "<b>Risks being managed</b><br/>"
        + bullets([
            "New requirements appearing late. The Master Class was added after "
            "the first draft. Managed by a signed baseline plus a change log "
            "that states the schedule cost of each addition.",
            "One developer on a fixed deadline. Managed by keeping gift cards "
            "and reviews as the agreed first items to defer if time runs short.",
            "Client answers arriving slowly. Managed by working on items that "
            "are not blocked, and by chasing outstanding questions at every "
            "standup.",
        ]), BODY))

    story.append(Spacer(1, 6))
    story.append(Paragraph("3. Agile items", H2))

    data = [[Paragraph("Agile Items", HEAD),
             Paragraph("Student's Response", HEAD),
             Paragraph("Respective Member", HEAD)]]
    shaded = []
    for idx, (item, response, member, is_green) in enumerate(ROWS, start=1):
        data.append([Paragraph(item, CELLB),
                     Paragraph(response, CELL),
                     Paragraph(member, CELL)])
        if is_green:
            shaded.append(idx)

    table = LongTable(data, colWidths=[3.5 * cm, 11.3 * cm, 3.2 * cm],
                      repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for r in shaded:
        style.append(("BACKGROUND", (0, r), (0, r), GREEN))
    for r in range(1, len(data)):
        if r not in shaded:
            style.append(("BACKGROUND", (0, r), (0, r), BAND))
    table.setStyle(TableStyle(style))
    story.append(table)

    story.append(Paragraph(
        "Supporting documents: Software Requirements Specification v1.0; "
        "Requirements and Deliverables Mapping v2.0; client correspondence of "
        "4 August 2026. Items marked in red require confirmation before "
        "submission.", FOOT))

    doc.build(story)
    print("saved:", OUT)


if __name__ == "__main__":
    build()
