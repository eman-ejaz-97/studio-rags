# Software Requirements Specification (SRS)

## Studio Rags — Workshop Booking Web Application

**Version:** 1.0 — for client sign-off
**Date:** 4 August 2026
**Client:** Rehana Usman, Founder — Studio Rags, Sefton Park, SA
**Team:** [TEAM NAMES]
**Course:** ICT Capstone Project — [UNIVERSITY]
**Supervisor:** [SUPERVISOR NAME]

**Replaces:** version 0.1 (draft, 2026-07-28)

---

## About this version

Version 0.1 was a draft. It had six items marked "to confirm."

Rehana answered those on 4 August 2026. This version applies her answers. It is
the version we are asking her to approve.

Once approved, this document is the agreed scope of the project. Anything added
after this point is a change request. Change requests are welcome. We will tell
her what each one costs in time, and what would need to move to fit it.

### What changed since version 0.1

| Change | Detail |
| --- | --- |
| Workshop list is final | 9 offers, confirmed. See section 2.2. |
| Master Class added | A four-week course, paid in advance, taken within 6 months. This was not in version 0.1. |
| Online classes confirmed | In scope. Batik and Shibori only. |
| Tie-dye and Chunri removed | Confirmed not needed. Also kids' tie-dye. |
| Council and school bookings removed | Confirmed not needed. Stays offline. |
| Peak season corrected | Version 0.1 said Adelaide Fringe. Fringe bookings go through the Fringe's own website. Her peak is spring and summer. |
| ABN confirmed | Studio Rags is a registered small business with an ABN. Online payments can go live. |
| Prices and class sizes | Removed as a requirement to gather. Rehana sets these herself in the dashboard. See FR-A11. |

---

## 1. Introduction

### 1.1 Purpose

This document sets out what the Studio Rags web application must do.

The application will let customers browse, book and pay for workshops on the
Studio Rags website. It will give Rehana a dashboard to manage her workshops,
dates, bookings and customers.

It replaces the current setup, which is a Wix site plus Eventbrite.

### 1.2 Scope

The system is a website. It works in a web browser. There is no phone app.

It is designed mobile-first. Most customers arrive from Facebook or Instagram on
a phone, so the phone version is designed first and the desktop version follows.

It covers the customer booking journey and the admin side.

It does not cover council, school or library bookings. Those stay offline by
phone and email. It does not include running advertising campaigns.

### 1.3 The problem today

Studio Rags advertises on Facebook and Instagram. Those ads send people to a
basic Wix site. To book, the customer then leaves that site and goes to
Eventbrite.

This causes four problems.

1. Customers leave the website part way through booking. Some do not come back.
2. There are too many steps.
3. Facebook cannot see which bookings came from which ad. Advertising cannot be
   measured.
4. Studio Rags does not build its own customer email list.

### 1.4 Definitions

**Workshop** — a type of class Studio Rags offers, for example Shibori.

**Session** — one specific date and time of a workshop, which a customer books.

**Master Class** — a four-week course. Paid in full up front. The four sessions
are taken within six months.

**Enrolment** — what a customer holds after buying a Master Class. It records how
many of the four sessions they have used and when it expires.

**Admin** — Rehana, who manages the system.

**Payment gateway** — the service that handles card payments securely. We are
using Stripe.

**Pixel** — a small piece of tracking code. It tells Facebook which bookings came
from which advert.

---

## 2. Overall description

### 2.1 About the client

Rehana Usman is originally from Pakistan. She holds a bachelor's degree in
Textile Design and has around 20 years in the textile industry. She has worked as
a fashion designer, a textile designer and a university lecturer.

She founded Studio Rags after moving to Australia, to keep traditional textile
crafts alive.

She is the only artist teaching Indonesian Batik in the Adelaide area.

She describes her own web and technical background as limited. The admin side of
this system must therefore be genuinely simple to use.

### 2.2 The offers — final list

There are **9 offers** across four types.

**One-off beginner workshops, in person**

1. Indonesian Batik
2. Japanese Shibori
3. Woodblock Printing

**Four-week Master Class, in person**

4. Batik Master Class
5. Shibori Master Class
6. Woodblock Printing Master Class

Paid in full in advance. The customer takes the four sessions within six months,
against the schedule Rehana publishes.

**Online**

7. Batik
8. Shibori

**Kids**

9. Kids & Parents Painting, for children aged 7 to 15

**Removed and confirmed out of scope:** regular tie-dye, kids' tie-dye, and
Chunri dyeing.

### 2.3 Who will use it

**Main customers:** women aged 50 and over.

**Other customers:** women aged 30 and over, booking for themselves or their
children.

The website is designed to work well for every age group. Rehana's customers
span a wide range and the design does not favour one group over another.

**Why they come:** to learn a new skill, for a creative experience, to make their
own fabric, and out of interest in traditional textile arts.

**Admin user:** Rehana.

### 2.4 Busy periods

Spring and summer are the busy season for Studio Rags workshops.

The Adelaide Fringe is a busy period for the business overall. However, Fringe
bookings are taken through the Fringe's own website, not through the Studio Rags
site. So Fringe does not add load to this system.

The system must handle the spring and summer increase in bookings.

### 2.5 User roles

| Role | What they can do |
| --- | --- |
| Guest | Browse workshops and details without an account. |
| Registered customer | Book, pay, see their booking history, leave reviews, buy gift cards. |
| Admin (Rehana) | Manage workshops, dates, prices, class sizes, bookings and customers. |

### 2.6 Assumptions and dependencies

- Rehana provides the brand assets: logo, colours, fonts and workshop
  photographs. Everything except the fonts has been received. The fonts are held
  in her Canva account and the team is helping to source them.
- Communication with the client is by email. This is her preference, for
  record-keeping.
- **Confirmed:** Studio Rags is a registered small business with an ABN. Online
  payments can therefore go live.
- A custom domain is required. It has not yet been purchased. The team has
  recommended `studiorags.com.au` and the supervisor has been asked to endorse
  this. The domain will be registered in Rehana's name, under her ABN.
- Rehana accepts that there are ongoing costs for the domain, hosting and payment
  processing.
- Rehana will run her own Facebook and Google advertising. The system will be
  built so that tracking works, but running the campaigns is her responsibility.

---

## 3. Functional requirements

Each requirement has an ID so it can be traced through design, build and testing.

Priority uses MoSCoW: **Must**, **Should**, **Could**.

- **Must** — the website does not work without it.
- **Should** — important, but the website still works without it.
- **Could** — desirable if time allows.

**We are aiming to deliver everything in this document.** If time becomes tight
near the end, the first things we would move to after launch are gift cards
(FR-C12, FR-P4) and reviews (FR-C11). We are flagging this now so it is not a
surprise later. Nothing marked Must would ever be dropped.

### 3.1 Customer side

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-C1 | View a list of available workshops. | Must |
| FR-C2 | View detailed information for each workshop. | Must |
| FR-C3 | View a calendar of available dates. | Must |
| FR-C4 | Register and log in to an account. | Must |
| FR-C5 | Reset a forgotten password. | Must |
| FR-C6 | Book a workshop date online. | Must |
| FR-C7 | Pay in full before the booking is confirmed. No deposits. | Must |
| FR-C8 | Receive an automatic booking confirmation email. | Must |
| FR-C9 | Receive automatic reminder emails before the workshop. | Must |
| FR-C10 | View own profile and booking history. | Should |
| FR-C11 | Leave and read customer reviews. | Should |
| FR-C12 | Buy gift cards on the website. | Should |
| FR-C13 | Use a contact page. | Must |
| FR-C14 | Use the website comfortably on a phone. | Must |
| FR-C15 | Book and attend online sessions. Batik and Shibori only. | Must |

### 3.2 Master Class (new in v1.0)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-C16 | Buy a four-week Master Class, paying in full in advance. | Must |
| FR-C17 | Book each of the four sessions against Rehana's published schedule, within six months of purchase. | Must |
| FR-C18 | See how many sessions remain and when the enrolment expires. | Must |
| FR-C19 | Receive a reminder email when the enrolment is close to expiring. | Should |

**Open point.** We have asked Rehana whether the four weeks are a fixed group
with dates set at purchase, or a flexible pass where the customer chooses any
four published dates. We have also asked what happens to unused sessions at the
six-month point. Her answer will be added here before build begins. See section 7.

### 3.3 Admin side

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-A1 | Secure admin login, separate from customer accounts. | Must |
| FR-A2 | Dashboard showing upcoming classes and bookings. | Must |
| FR-A3 | Create, edit and remove workshops. | Must |
| FR-A4 | Manage the calendar — add and edit dates. | Must |
| FR-A5 | Prevent double bookings and overbooking. | Must |
| FR-A6 | View and manage customers and their details. | Must |
| FR-A7 | View booking history and booking status. | Must |
| FR-A8 | View payment information for each booking. | Must |
| FR-A9 | Receive admin notification emails for new bookings and upcoming classes. | Should |
| FR-A10 | Dashboard laid out as a simpler version of ClassBento. Shows upcoming classes, calendar, dates, customer name, email and phone, booking status, and payment information. | Must |
| FR-A11 | Set the price and the number of places. Set a default for each workshop, and change it for an individual date if needed. Changing a price never changes what an existing customer already paid. | Must |
| FR-A12 | View and manage Master Class enrolments — who holds one, how many sessions they have used, and when it expires. | Must |

### 3.4 Payments

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-P1 | Use a secure payment gateway. Stripe has been selected. | Must |
| FR-P2 | Require full payment before a booking is confirmed. | Must |
| FR-P3 | No deposits or part payments. | Must |
| FR-P4 | Sell and redeem gift cards. | Should |
| FR-P5 | Card details are never stored on the Studio Rags system. They are handled entirely by Stripe. | Must |

### 3.5 Automatic emails

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-N1 | Booking confirmation to the customer. | Must |
| FR-N2 | Reminder to the customer before the workshop. | Must |
| FR-N3 | New booking notification to Rehana. | Should |
| FR-N4 | Upcoming class reminder to Rehana. | Should |

### 3.6 Marketing and tracking

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-M1 | Build the pages so a Facebook or Google tracking pixel can be added. | Should |
| FR-M2 | Collect customer email addresses, with their consent, for future marketing. | Should |
| FR-M3 | Include a privacy and cookie notice. | Should |

Setting up and running the advertising campaigns is Rehana's responsibility, not
part of this project.

### 3.7 Out of scope

Confirmed by the client and not part of this project:

- Online booking for councils, schools and libraries. These stay by phone and
  email, which Rehana is happy with.
- A phone app for iPhone or Android.
- Running or managing Facebook or Google advertising campaigns.
- Regular tie-dye, kids' tie-dye and Chunri dyeing workshops.

---

## 4. Non-functional requirements

These describe how well the system must work, rather than what it does.

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-1 | Ease of use | Simple and professional. Usable by customers who are not confident with technology, and by an admin who is not technical. |
| NFR-2 | Devices | Designed for phones first. Works on common browsers and devices. |
| NFR-3 | Speed | The main pages load in under about 3 seconds on a normal mobile connection. |
| NFR-4 | Security | Secure login. Payments handled by Stripe. No card details stored by us. Customer personal data protected. |
| NFR-5 | Reliability | No double bookings. Handles the spring and summer increase in traffic. |
| NFR-6 | Self-management | Rehana can manage workshops, dates, prices, class sizes and bookings herself, without needing a developer. |
| NFR-7 | Privacy | Personal data handled responsibly, with a privacy notice, in line with Australian privacy expectations. |
| NFR-8 | Branding | Matches the Studio Rags brand — logo, colours and fonts. |
| NFR-9 | Accessibility | Meets WCAG 2.2 Level AA. Readable text sizes, strong colour contrast, and full keyboard use. |

---

## 5. Current and proposed booking journey

**Today**

Facebook or Instagram → Wix site → Eventbrite → payment → confirmation.

The customer leaves the Studio Rags website. The booking cannot be tracked back
to the advert. No email address is captured for Studio Rags.

**Proposed**

Facebook or Instagram → Studio Rags website → browse → view details → check the
calendar → book → pay → confirmation.

The customer stays on the Studio Rags website throughout. The booking is tracked.
The email address is captured, with consent.

---

## 6. What success looks like

The project has succeeded if:

- Customers complete bookings on the Studio Rags website.
- Payments are secure.
- Facebook advertising can track which bookings came from which advert.
- Rehana can manage her workshops and calendar herself.
- Reminder emails are sent automatically.
- Master Class enrolments can be sold and tracked.
- Gift cards can be bought online.
- Customer details are collected for future marketing, with consent.
- The system supports the business as it grows.

---

## 7. Open points

Everything from version 0.1 has been resolved except where noted. These remain.

| # | Point | Why it matters | Who |
| --- | --- | --- | --- |
| 1 | **How the Master Class works.** Fixed group with set dates, or a flexible pass? Must the four weeks be taken in order? What happens to unused sessions after six months? | Decides how we build FR-C16 to FR-C19. | Client |
| 2 | **Cancellations and refunds.** If a customer cannot attend, what happens? A refund, a credit toward another date, or no refund after a certain point? This matters most for the Master Class, where payment is held for up to six months. | Needed before we build the booking system. | Client — to be discussed at the next meeting |
| 3 | **Online class delivery.** Live video or pre-recorded? Are materials posted to the student? If so we need a postal address at booking and a cut-off date. | Affects the booking form for offers 7 and 8. | Client |
| 4 | **Kids & Parents Painting tickets.** Does a parent attend? Does the parent pay separately, or is the price for the pair? | Affects how tickets are priced and sold. | Client |
| 5 | **Gift cards.** Still wanted? They were in version 0.1 and have not been mentioned since. | They are a significant piece of work. | Client |
| 6 | **Brand fonts.** Held in Canva. We need the font names so we can source them with the correct licence for website use. | Needed before visual design. | Client — send a screenshot |
| 7 | **Domain purchase.** `studiorags.com.au` recommended, pending supervisor endorsement. | Needed before launch. | Client, after supervisor confirms |

Points 1 and 2 are the ones that hold up building. The rest can be answered
alongside the work.

---

## 8. Document control

| Version | Date | Author | Notes |
| --- | --- | --- | --- |
| 0.1 | 28 July 2026 | [TEAM] | Initial draft from the kick-off meeting. Six items pending client confirmation. |
| 1.0 | 4 August 2026 | [TEAM] | Client confirmations applied. Master Class added. Workshop list finalised at 9 offers. Peak season corrected. ABN confirmed. Issued for sign-off. |

---

## 9. Sign-off

By approving this document, the client confirms that it describes the system to
be built.

Changes requested after this point are welcome. Each will be recorded, and the
team will advise what it costs in time and what would need to move to fit it.

| | |
| --- | --- |
| **Client name** | Rehana Usman |
| **Signature** | |
| **Date** | |

| | |
| --- | --- |
| **Team representative** | [NAME] |
| **Signature** | |
| **Date** | |

Approval by return email is acceptable and will be kept on file.
