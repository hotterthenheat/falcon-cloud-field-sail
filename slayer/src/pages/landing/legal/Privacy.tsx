/*
==================================================
  SLAYER TERMINAL - THE PRIVACY POLICY
  (pages/landing/legal/Privacy.tsx)

  Noah, 2026-10-05, with a competitor's privacy page:
  "i like how they use their words but make it in our
  format and use case". So: their concreteness — what
  is taken on its own, the list of uses, who it is
  shared with, the rights one by one, the reporting
  the exchanges require, where the data lives in the
  world — in OUR shape (a plain line first, then the
  text that governs) and only what is TRUE OF OUR
  BUILD: accounts and what a member makes with
  Supabase, payments with Stripe (we never hold a
  card number), sign-in through Google or Apple if
  chosen, the market data providers never learn who a
  member is, NO advertising pixels, NO text messages,
  NO AI assistant, preferences in the browser's own
  storage. THE ONE MEASUREMENT TOOL (2026-10-11): the
  visit count is Plausible, cookieless, and only on a
  build that names the site (core/analytics.ts) — this
  page reads the same switch, so it says what is true
  of the build it is on. Where a thing may come later
  (a campaign tag on a link) the page says "may" and
  promises to say so here first. Nothing lifted from
  theirs. Not legal advice.
==================================================
*/

import LegalPage, { B, L, LEGAL, Mail, P, To, type LegalSection } from './LegalPage';
import { ANALYTICS_ON } from '../../../core/analytics';

const UPDATED = 'October 5, 2026';

const SECTIONS: LegalSection[] = [
  {
    id: 'short',
    title: 'The short version',
    plain: 'We keep what we need to run your account, bill you and meet the exchanges’ rules. We do not sell it, and we do not use it for ads.',
    body: (
      <P>
        {LEGAL.name} ("Slayer", "we", "us") keeps the details of your account, what you make in the terminal, and the record of your plan. It uses them to run the service, to bill you, to answer you, and to meet the rules of the exchanges whose data it shows. It does not sell them, trade them, or use them to show you advertising. It shares them only with the few companies that run pieces of the service for us, with the exchanges and data providers to the extent their licences require, and with the law when the law requires it. Each of those is named below.
      </P>
    ),
  },
  {
    id: 'you-give',
    title: 'What you give us',
    plain: 'Your account details, your plan, what you make in the terminal, your answer about your status, and what you write to us.',
    body: (
      <L
        items={[
          <>
            <B>Your account.</B> Your email, your name and your handle, and a picture if you add one. Your password is kept hashed by our sign-in provider; we cannot read it. If you sign in with Google or Apple, they send us the email and the name on that account, and nothing else.
          </>,
          <>
            <B>Your plan.</B> Which plan you are on, its standing, your invoices, and the brand and last four digits of your card. Stripe holds the card itself and takes the payment. We never see the number.
          </>,
          <>
            <B>What you make.</B> Journal entries, notes and tags, scripts, drawings, watchlists, alerts, layouts and settings, kept with your account so they follow you between machines.
          </>,
          <>
            <B>Your status.</B> Your answer to whether you use market data as a professional, and when you gave it. The exchanges require us to ask and to keep the answer.
          </>,
          <>
            <B>What you post.</B> When the Community room opens, the posts you make there, with your name, handle and picture beside them.
          </>,
          <>
            <B>What you write to us.</B> Mail to <Mail /> is kept so a person can answer it, and so we can look back if the question returns.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'we-take',
    title: 'What we collect on our own',
    plain: ANALYTICS_ON
      ? 'Short-lived server logs, the browser you use, the rough location your address points to, and a visit count that sets no cookie. No pixels.'
      : 'Short-lived server logs, the browser you use, and the rough location your address points to. No trackers, no pixels.',
    body: (
      <>
        <L
          items={[
            <>
              <B>Logs.</B> When the terminal is used, our servers note the address the request came from, the browser and device, the page or feature asked for, and the time. They are kept for 30 days, for security and for finding faults.
            </>,
            <>
              <B>Where you are, roughly.</B> From the address we work out the country and region you are in. The exchanges' rules about who may see what depend on it, and a sign-in from somewhere new is one of the things that tells us an account may have been taken.
            </>,
            ANALYTICS_ON ? (
              <>
                <B>How the terminal is used.</B> Which pages are opened, how many people visit and where they came from, counted by Plausible, a measurement service that works without cookies and without a profile of you. It records the page, the site that sent you, your browser and device family and your country — never your name, your email or your address.
              </>
            ) : (
              <>
                <B>How the terminal is used.</B> Which pages and features are opened and for how long, read from our own logs. No outside company watches you do it.
              </>
            ),
            <>
              <B>The link you followed.</B> A link that brought you here may carry a tag saying which post or ad it came from. We may read it to know what brings people to the site. It names no one.
            </>,
          ]}
        />
        {ANALYTICS_ON ? (
          <P>Plausible is the one measurement tool we run. It sets no cookie and keeps no lasting identifier of you, which is why it runs without asking you first. We run no advertising pixel and no session recorder. If that ever changes, this page will say so first, and in places where the law requires your consent the tool will stay off until you give it.</P>
        ) : (
          <P>We run no analytics service, no advertising pixel and no session recorder. If we ever add a tool to measure the site, this page will say so first, and in places where the law requires your consent the tool will stay off until you give it.</P>
        )}
      </>
    ),
  },
  {
    id: 'why',
    title: 'What we use it for',
    plain: 'Running your account, billing you, the alerts you set, answering you, keeping the service safe, and the reporting the exchanges require.',
    body: (
      <>
        <L
          items={[
            'to sign you in and keep what you make with your account;',
            'to bill you, to show you your invoices, and to tell you before a price changes;',
            'to show the alerts you set, in the terminal and through your browser if you allow it;',
            'to answer you when you write to us;',
            'to keep the service safe: to find faults, to stop abuse and attacks, and to notice an account that has been taken;',
            'to meet our data licences: the exchanges and our data providers require us to keep each subscriber’s professional or non-professional status and to report how many subscribers we have, and may require a subscriber’s identity and location when they audit us;',
            'to enforce the Terms of Service and to meet our legal duties, including tax and accounting law;',
            'to tell you about changes to the service, to these pages or to your plan.',
          ]}
        />
        <P>We do not use your details to decide what to show you, we do not build a profile of you for advertising, and we do not sell them to anyone.</P>
      </>
    ),
  },
  {
    id: 'who',
    title: 'Who we share it with',
    plain: 'The companies that run pieces of the service, the exchanges to the extent their licences require, other members where you post, the law, and a buyer if the company is sold.',
    body: (
      <>
        <L
          items={[
            <>
              <B>Supabase</B>, which keeps the accounts and what you make, on servers in the United States, and sends the mail that confirms an address or resets a password.
            </>,
            <>
              <B>Stripe</B>, which takes payments, keeps the card and sends the receipts. Its own privacy policy covers what it holds.
            </>,
            <>
              <B>Google and Apple</B>, if you sign in through one of them, under their own terms.
            </>,
            <>
              <B>The email service that delivers our mail</B> about your account and the service, which receives your address and the message.
            </>,
            ...(ANALYTICS_ON
              ? [
                  <>
                    <B>Plausible</B>, which counts visits for us from servers in the European Union: the page, the site that sent you, your browser and device family and your country. It sets no cookie and is given no name, email or address.
                  </>,
                ]
              : []),
            <>
              <B>The exchanges and our market data providers.</B> They send us prices, positioning and the tape, and learn nothing about you from that. Under their licences we report subscriber counts and each subscriber's professional or non-professional status, and when they audit us they may require a subscriber's name and location as well.
            </>,
            <>
              <B>Other members</B>, when you post in the Community room once it opens: your name, your handle, your picture and the post are seen by the members there.
            </>,
            <>
              <B>The law</B>, when a court, a regulator or a legal process requires it, or when sharing is needed to protect the service, our members or others from harm.
            </>,
            <>
              <B>A buyer</B>, if {LEGAL.name} is sold, merged or financed, in which case what we hold goes with the business under this policy.
            </>,
          ]}
        />
        <P>Each company that works for us does so under a contract that limits what it may do with the data. None of them may use your details for its own purposes. We do not sell your personal information, and we do not share it for advertising.</P>
      </>
    ),
  },
  {
    id: 'storage',
    title: 'Cookies and your browser',
    plain: 'One token that keeps you signed in, and your preferences kept in your own browser. No third-party cookies.',
    body: (
      <>
        <P>The terminal keeps a sign-in token in your browser so you stay signed in, and it keeps preferences such as your theme, your layouts and your last choices in your browser's own storage. Those stay on your machine unless your account carries them.</P>
        <P>We set no advertising or tracking cookies, and no third party sets cookies through the site. Your browser's settings can clear what is stored; signing in again puts the token back.</P>
      </>
    ),
  },
  {
    id: 'how-long',
    title: 'How long we keep it',
    plain: 'As long as your account lives. Deleted within 30 days of your deleting it, except the records the law makes us keep.',
    body: (
      <>
        <P>Your account and what you make are kept for as long as your account exists. When you delete your account, they are deleted within 30 days, and the backups that held them are cycled out after that.</P>
        <P>Billing records are kept for as long as tax and accounting law require, usually seven years. The record of your professional status is kept for as long as the exchanges' licences require after your account ends. Server logs are kept for 30 days. Mail you sent us is kept until it is no longer needed to answer you. What is kept past the end of your account is kept for those reasons only, and where we can we keep it without your name on it.</P>
      </>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights and your choices',
    plain: 'See it, take a copy, correct it, delete it, and say no to marketing mail. Ask in Settings or by email, and we answer.',
    body: (
      <>
        <P>Wherever you live, you can:</P>
        <L
          items={[
            <>
              <B>see</B> what we hold about you, and <B>take a copy</B>: your journal, scripts, drawings and settings export from Settings in a form you can open elsewhere, and the rest we send on request;
            </>,
            <>
              <B>correct</B> your name, handle, picture and email from Settings › Account;
            </>,
            <>
              <B>delete</B> your account from Settings, or ask us to, and we delete what we hold except what the law or a data licence makes us keep;
            </>,
            <>
              <B>say no</B> to marketing mail, with the link in any such mail, and still receive the mail about your account and the service;
            </>,
            <>
              <B>take back</B> a permission you gave us, from the moment you take it back;
            </>,
            <>
              <B>use these rights without penalty</B>: no plan, price or feature changes because you did.
            </>,
          ]}
        />
        <P>
          To ask for anything Settings does not do, write to <Mail />. We may ask you to prove the account is yours before we act, and someone you authorise may ask for you where the law allows it. If we say no, you can write back and a different person will look again. We answer within a month, or within the time your local law sets if that is shorter.
        </P>
        <P>If you live in California: we do not sell personal information and we do not share it for advertising. If you live in the European Economic Area, the United Kingdom or Switzerland: you may also complain to your data protection authority, and we keep your data because we need it to run the agreement with you, to meet our legal duties, and for the interests above that do not override yours.</P>
      </>
    ),
  },
  {
    id: 'mail',
    title: 'The mail we send',
    plain: 'Mail about your account and the service, always. Marketing mail only if you ask for it, with a way out in every message.',
    body: (
      <>
        <P>We write to you about your account, your plan, a change to these pages, and anything that affects the service you pay for. Those are not marketing, and you cannot opt out of them while you have an account.</P>
        <P>We send marketing mail only to people who asked for it, for example by joining a list for a launch. Every such message carries a link that stops them. Stopping them does not stop the mail about your account.</P>
      </>
    ),
  },
  {
    id: 'sms',
    title: 'Text messages',
    plain: 'We send none. We do not ask for your phone number.',
    body: <P>The terminal does not send text messages, and no part of the service asks for a mobile number. Alerts reach you in the terminal and, if you allow it, through your browser. If that ever changes, you will be asked to opt in first, and this page will say what the messages are and how to stop them.</P>,
  },
  {
    id: 'children',
    title: 'Children',
    plain: 'The terminal is for adults. We do not knowingly keep anything about anyone under 18.',
    body: <P>The service is for people 18 and over. We do not knowingly collect anything from anyone younger. If you believe someone under 18 has an account, write to <Mail /> and we will delete it.</P>,
  },
  {
    id: 'abroad',
    title: 'Outside the United States',
    plain: 'We are in the United States and so is the data. Using the terminal from elsewhere means your details come here.',
    body: <P>{LEGAL.name} is based in the United States, and the companies that hold your details run their servers there. If you use the terminal from another country, what you give us and what we collect is sent to the United States and kept under this policy and United States law, which may protect data differently from the law where you live.</P>,
  },
  {
    id: 'security',
    title: 'Security',
    plain: 'Encrypted in transit and at rest by the companies that hold it. No system is perfect; tell us if something looks wrong.',
    body: (
      <>
        <P>Everything between your browser and the service travels encrypted. The companies that hold your details encrypt them at rest and control who can reach them. Only the people who run the service can reach account data, and only to run it.</P>
        <P>No system is perfect, and we cannot promise that nothing will ever go wrong. Keep your password to yourself. If you think your account has been reached by someone else, or you find a weakness in the service, write to <Mail /> and we will act on it.</P>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    plain: 'We post the new version with its date and email you about anything that matters.',
    body: <P>When this policy changes we post the new version here with a new date. For a change that matters to you, we also email the address on your account before it takes effect.</P>,
  },
  {
    id: 'contact',
    title: 'Contact',
    plain: 'One address, read by a person.',
    body: (
      <P>
        Questions about your data, or this policy: <Mail />. The <To to="/terms">Terms of Service</To> are the agreement this policy belongs to.
      </P>
    ),
  },
];

const Privacy = () => (
  <LegalPage
    kind="Privacy"
    title="Privacy Policy"
    updated={UPDATED}
    intro={
      <>
        <p>This page says what we keep about you, who sees it, how long we keep it, and how to take it with you or have it deleted.</p>
        <p>Each section opens with a plain line. It says what the section means. The text under it is what governs.</p>
      </>
    }
    sections={SECTIONS}
    sibling={{ to: '/terms', name: 'Terms of Service' }}
  />
);

export default Privacy;
