/*
==================================================
  SLAYER TERMINAL - THE TERMS OF SERVICE
  (pages/landing/legal/Terms.tsx)

  Noah's decisions, 2026-10-05: the name is Slayer
  Terminal; disputes go to arbitration one at a time
  with a class-action waiver; NO REFUNDS; NO
  STREAMING; the plans are Book · Tape · Desk with
  the Seat off the page and one seam for a plan
  "paid once"; the address is info@slayerterminal.com.
  The state is LEGAL.state (LegalPage.tsx), empty
  until he names it.

  THE READING (Noah, later the same day, of a
  competitor's pages: "its nice and simple"): short
  sentences, one point a line, lists where things
  can be listed, no flourish — in OUR shape, a plain
  line first and the text that governs under it, and
  in our own words throughout.

  What is ours to say that a general template never
  has: the four words are descriptions; a Compass
  setup is the method applied, graded on paper, no
  track record; the backtest and the paper desk are
  modelled; scripts are yours and unreviewed; the
  Dossier's records are public filings; alerts are
  in-app and best-effort; your things are yours and we
  use them only to run your account; the exchanges'
  professional-status question is real.

  Not legal advice. A lawyer reads this before launch.
==================================================
*/

import LegalPage, { B, L, LEGAL, Mail, P, To, homeState, type LegalSection } from './LegalPage';

const UPDATED = 'October 5, 2026';

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    title: 'What you are agreeing to',
    plain: 'Use the site or the terminal and these terms apply to you, together with the Privacy Policy.',
    body: (
      <>
        <P>These terms are the agreement between you and {LEGAL.name} ("Slayer", "we", "us"). They apply when you use:</P>
        <L
          items={[
            <>the website at {LEGAL.site};</>,
            'the terminal it opens, on any device;',
            'the product pages;',
            'the Community room, when it opens;',
            'any mail or alert we send you.',
          ]}
        />
        <P>
          The <To to="/privacy">Privacy Policy</To> is part of these terms. Terms shown at checkout, or when a new feature opens, also apply, and for that purchase or feature they win if the two disagree.
        </P>
        <P>Every section below opens with a line in plain words. The plain line explains. The text under it governs.</P>
      </>
    ),
  },
  {
    id: 'what-it-is',
    title: 'What the terminal is, and is not',
    plain: 'A reading of the options market. It shows you where dealer hedging sits. It does not tell you what to trade.',
    body: (
      <>
        <L
          items={[
            <>
              <B>What it is.</B> {LEGAL.name} reads public market data, mostly options positioning, prices and the tape, and shows what it finds: the walls, the flip, the supreme, the book by strike and by expiry, the prints, the filings. It gives you places to practise. It is a tool for people who make their own decisions.
            </>,
            <>
              <B>What we are not.</B> A broker, an investment adviser, a commodity trading advisor, a futures commission merchant or an introducing broker. We are not registered as any of these with the SEC, the CFTC, FINRA, the NFA or any state.
            </>,
            <>
              <B>Nothing is tailored.</B> Everyone on a plan sees the same tools and the same readings. We do not know your finances, your goals or your appetite for risk, and the terminal does not ask.
            </>,
            <>
              <B>Nothing is advice.</B> Nothing in the terminal, on the site, in an alert or in our mail is advice to you, or a recommendation to buy, sell, hold or do anything with any stock, option, future or other instrument.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'readings',
    title: 'The readings, the four words and the setups',
    plain: 'Strong, good, caution and poor describe the book as it stands. A Compass setup is our method applied to today’s levels, not a tip.',
    body: (
      <L
        items={[
          <>
            <B>The four words.</B> The terminal describes a strike or a contract as strong, good, caution or poor. The word describes the shape of the dealer book around a price, and nothing else. It is not a rating of a security, not a forecast, and not a score of how a trade will go.
          </>,
          <>
            <B>Setups.</B> A Compass setup is our method applied to the day's levels: a contract that fits them, with a floor and targets that show the method. Setups are graded on paper so you can see how the method behaves. We publish no track record and claim no results, past or future.
          </>,
          <>
            <B>Estimates.</B> The readings come from a method of our own that estimates how dealers are positioned. We improve the method over time. A reading can change as the method changes, as the data changes, and as the day moves on.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'risk',
    title: 'The risk',
    plain: 'You can lose money. With options and futures you can lose more than you put in. Every trade is your decision.',
    body: (
      <L
        items={[
          'Trading stocks, options and futures can lose you money.',
          'Options can expire worth nothing. Futures, and some option positions, can lose more than the money you put up.',
          'Markets move fast, data arrives late, and a reading that was true at the open can be wrong by noon. Nothing in the terminal changes that.',
          'You decide what to trade, how much and when, and you carry the result.',
          'For advice about your own situation, talk to someone licensed to give it.',
        ]}
      />
    ),
  },
  {
    id: 'who',
    title: 'Who can use it',
    plain: 'Adults, with a lawful purpose, one person per account.',
    body: (
      <L
        items={[
          'You must be 18 or older and able to enter a contract.',
          'You may not use the terminal where the law forbids it, or if you are on a United States sanctions list or in a place under sanctions.',
          'You follow the laws that apply to you.',
          'An account belongs to one person. It may not be shared, lent, sold or passed on.',
        ]}
      />
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    plain: 'Keep your password to yourself, tell us if someone else gets in, and answer truthfully when we ask about your status.',
    body: (
      <L
        items={[
          'Keep your sign-in details private. Everything done with your account counts as done by you.',
          <>
            Write to <Mail /> as soon as you think someone else has used it.
          </>,
          'Keep the details on your account accurate.',
          'When we ask whether you use market data as a professional, answer truthfully. The exchanges require the question, and the answer decides what we may show you and at what price. A false answer breaks these terms and the exchanges’ rules.',
          'We may suspend, limit or close an account at our discretion when we believe these terms were broken, when an exchange or the law requires it, or when an account puts the service or other members at risk.',
        ]}
      />
    ),
  },
  {
    id: 'data',
    title: 'The market data and the public record',
    plain: 'The data comes from exchanges through our providers. It can be late, missing or wrong. Check before you act on it.',
    body: (
      <>
        <P>
          <B>The market data.</B>
        </P>
        <L
          items={[
            'Prices, quotes, option open interest, volume and the tape come from exchanges and data providers under licence. Some of it is delayed.',
            'Some of what you see is derived by us from that data. A derived figure is an estimate.',
            'We do not promise that any figure is accurate, complete, on time or available, or that the terminal is up when you need it. Verify what matters before you act on it.',
            'The exchanges set terms for their data, and you accept them as they apply to you: the data is for your personal use, it may not be passed on, and you tell us truthfully whether you are a professional or a non-professional subscriber.',
          ]}
        />
        <P>
          <B>The public record.</B>
        </P>
        <L
          items={[
            'The Dossier shows public records: filings by insiders, disclosures by members of Congress, earnings dates and news.',
            'A record can be filed late, amended or withdrawn. A listed trade is a trade, not an accusation.',
            'Headlines belong to the publishers that wrote them. Company names and logos belong to the companies and appear only to say which company is meant.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'practice',
    title: 'Practice: the paper desk, the backtest and the journal',
    plain: 'Pretend money, modelled fills, and a past that is not the future. The journal is your own record.',
    body: (
      <L
        items={[
          'The paper desk trades pretend money on real prices. The backtest replays a past session and fills at modelled prices.',
          'Neither knows how a real order would have filled, how far the price would have moved for your size, what fees you would have paid, or how you would feel with real money on the line.',
          'A good paper run or a good backtest describes the past under those conditions. It is not a forecast of anything.',
          'The journal keeps what you type and the trades the practice rooms close into it. We do not check your figures. Its totals are your own record, not a statement from us.',
          'There are no public leaderboards, and we publish no one’s results.',
        ]}
      />
    ),
  },
  {
    id: 'scripts',
    title: 'Your scripts and drawings',
    plain: 'What you draw and write on the charts is yours. We do not review scripts, and a script’s output is information, not advice.',
    body: (
      <L
        items={[
          'You may write scripts for the charts and draw on them. They are yours.',
          'We do not review a script before it runs, and we are not responsible for what it computes. A script’s output is subject to section 2 like everything else in the terminal.',
          'Scripts have limits by plan.',
          'We may stop a script that slows or harms the service.',
          'If we add a way to share scripts with other members, the terms for sharing come with it.',
        ]}
      />
    ),
  },
  {
    id: 'alerts',
    title: 'Alerts',
    plain: 'An alert is a best effort to tell you that something crossed a level. Do not build a trade around its timing.',
    body: (
      <L
        items={[
          'Alerts show in the terminal and, if you allow it, through your browser.',
          'They depend on data arriving, on your device and on your connection. An alert can be late, early, missed or repeated.',
          'An alert says that a condition you set was met, as far as our data could tell. It says nothing about what to do.',
          'We do not send text messages.',
        ]}
      />
    ),
  },
  {
    id: 'community',
    title: 'The Community room',
    plain: 'Coming soon. When it opens, be decent, keep your own words, and know that we can remove what breaks the rules.',
    body: (
      <L
        items={[
          'The Community room stands behind a "coming soon" wall.',
          'When it opens, what you post there stays yours under section 13, and you give us permission to show it to the other members.',
          'Do not post anything unlawful, abusive, false, infringing or private. Do not sell anything there. Do not present anything from the terminal as advice to others.',
          'We may remove posts and members at our discretion.',
          'Room rules may be added when it opens. They form part of these terms.',
        ]}
      />
    ),
  },
  {
    id: 'use',
    title: 'What you may do with what you see',
    plain: 'Use it yourself. Screenshots are fine with the mark on them. No streaming, no sharing accounts, no scraping, no copying the method.',
    body: (
      <>
        <P>While your plan is active we give you a personal, limited, non-transferable licence to use the terminal and what it shows, for your own use.</P>
        <P>
          <B>You may:</B>
        </P>
        <L
          items={[
            'take screenshots and share them, in commentary, in teaching, in your own notes and your own posts, as long as the Slayer mark and any words of caution in the picture stay visible;',
            'talk and write about what you see.',
          ]}
        />
        <P>When you share a picture, do not present it as advice or as our recommendation.</P>
        <P>
          <B>You may not:</B>
        </P>
        <L
          items={[
            'live-stream, screen-share, broadcast or mirror the terminal to anyone, on any platform, in a call or in a chat;',
            'give another person live access to your screen or your account;',
            'scrape, crawl, record or extract data from the terminal by any automated means;',
            'copy, redistribute, resell or republish the data or the readings, live or delayed;',
            'reverse-engineer, decompile or probe the terminal or our methods, including by systematic querying;',
            'use the terminal or its output to build or train a competing product, model or dataset;',
            'use the terminal for anything unlawful, including market manipulation or fraud;',
            'try to break into, overload or interfere with the service.',
          ]}
        />
        <P>Breaking this section ends your plan at once, without a refund.</P>
      </>
    ),
  },
  {
    id: 'ours-and-yours',
    title: 'What is ours and what is yours',
    plain: 'The terminal, its design, its methods and its names are ours. Your notes, scripts, drawings and journal are yours, and we use them only to run your account.',
    body: (
      <>
        <P>
          <B>Ours.</B>
        </P>
        <L
          items={[
            'The terminal, its software, its design, its words and its pictures.',
            'Its readings and its methods, including the way the dealer book is read and signed.',
            <>
              The names {LEGAL.name}, Pulse, Terrain, Trace, Dossier, Pinpoint, Compass, the Weigher and Practice, and the Slayer mark.
            </>,
            'Nothing in these terms gives you any of that beyond the licence in section 12.',
            'If you send us an idea or a suggestion, we may use it without owing you anything.',
          ]}
        />
        <P>
          <B>Yours.</B>
        </P>
        <L
          items={[
            'Everything you make in the terminal: journal entries, notes, tags, scripts, drawings, watchlists, settings, your name and your picture.',
            'You give us only the permission we need to keep those things, back them up and show them back to you on your devices.',
            'We will not use them to promote the service, and we will not hand them to anyone else except as the Privacy Policy says.',
            'You can export them at any time. They are deleted with your account, as the Privacy Policy describes.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'billing',
    title: 'Plans, billing and cancelling',
    plain: 'Book, Tape and Desk are monthly, charged by Stripe, renewing until you cancel. Cancel any time and keep access to the end of the month. No refunds.',
    body: (
      <L
        items={[
          <>
            <B>Three plans.</B> Book, Tape and Desk, priced in US dollars as the pricing page and the checkout show, plus any tax that applies where you are.
          </>,
          <>
            <B>Stripe takes the payment.</B> We never see your card number.
          </>,
          <>
            <B>Renewal.</B> A plan renews each month at its current price until you cancel. If a price changes, we tell you by email at least 30 days before it applies to you.
          </>,
          <>
            <B>Cancelling.</B> Cancel any time from Settings › Billing or from Stripe's billing portal. Cancelling stops the next charge. You keep access until the end of the period you paid for.
          </>,
          <>
            <B>Changing plans.</B> Moving up is charged at the difference for the rest of the period. Moving down takes effect at the next renewal.
          </>,
          <>
            <B>No refunds.</B> Payments are not refunded and unused time is not credited, except where the law requires it. Take your time before you subscribe.
          </>,
          <>
            <B>Promotions.</B> A code or an offer is subject to the terms shown with it and may be withdrawn at any time.
          </>,
          <>
            <B>Disputed charges.</B> If you dispute a charge with your bank before writing to us, we may suspend the account until it is settled.
          </>,
          <>
            <B>Other plans.</B> From time to time we may offer a plan paid once, or a plan priced with you. Its terms are shown when we offer it and apply alongside these.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'changes-to-service',
    title: 'Changes, betas and the roadmap',
    plain: 'Features change. One marked beta or coming soon may change again or go away. A date we mention is an aim, not a promise.',
    body: (
      <L
        items={[
          'We change the terminal often.',
          'A feature marked beta, preview or coming soon may be incomplete, may change, may be limited to a plan, or may be withdrawn.',
          'Anything we say about what is coming is a plan of ours, not a term of this agreement.',
          'We may change, limit or end the service. If we end it for good, we give you notice, and the time you paid for is honoured or the unused part refunded.',
        ]}
      />
    ),
  },
  {
    id: 'ending',
    title: 'Ending',
    plain: 'You can leave any time. We can close an account that breaks these terms. Some sections keep applying afterwards.',
    body: (
      <L
        items={[
          'You can stop using the terminal at any time and delete your account from Settings.',
          'We may suspend or end your access, with or without notice, if we believe you broke these terms, put the service or others at risk, or if the law or an exchange requires it.',
          'Sections 2, 3, 4, 7, 8, 12, 13, 17, 18, 19 and 20 continue to apply after your access ends.',
        ]}
      />
    ),
  },
  {
    id: 'no-promises',
    title: 'No promises about the service',
    plain: 'We give you the terminal as it is. We do not promise that it is right, complete, always on, or that it makes money.',
    conspicuous: true,
    body: (
      <>
        <P>The terminal, its data, its readings and everything in it are provided as they are and as available.</P>
        <P>To the fullest extent the law allows, we make no promise and give no warranty of any kind, spoken, written or implied, including any implied warranty of merchantability, fitness for a particular purpose, accuracy, timeliness or non-infringement.</P>
        <P>We do not promise that the service will be uninterrupted, free of errors or secure, or that anything in it will lead to any trading result.</P>
      </>
    ),
  },
  {
    id: 'liability',
    title: 'What we are liable for',
    plain: 'Not your trading losses. For anything else, no more than what you paid us in the last year or one hundred dollars, whichever is more.',
    conspicuous: true,
    body: (
      <>
        <P>
          To the fullest extent the law allows, {LEGAL.name} and the people who own it, work for it and supply it are not liable to you for trading or investment losses, lost profits, lost data, or any indirect, incidental, special, consequential, exemplary or punitive damages arising from the service or anything in it, however caused, even if we were told they could happen.
        </P>
        <P>For everything else, our total liability to you for all claims together will not exceed the greater of what you paid us in the twelve months before the claim and one hundred US dollars.</P>
        <P>Some places do not allow some of these limits, so some of them may not apply to you.</P>
      </>
    ),
  },
  {
    id: 'your-responsibility',
    title: 'Your responsibility to us',
    plain: 'If your use of the terminal, your trades or your posts bring a claim against us, you cover it.',
    body: (
      <P>
        You agree to defend {LEGAL.name}, and the people who own it, work for it and supply it, against claims, losses and costs, including reasonable legal fees, that arise from your use of the service, your trading, what you post, or your breach of these terms or of the law, and to cover what they cost us.
      </P>
    ),
  },
  {
    id: 'disputes',
    title: 'Disputes',
    plain: 'Write to us first. If it is not sorted in 30 days it goes to arbitration, one person at a time, not a class action. You can opt out of arbitration in your first 30 days.',
    body: (
      <L
        items={[
          <>
            <B>Talk first.</B> Before any claim, write to <Mail /> with what happened and what you want, and give us 30 days to resolve it with you.
          </>,
          <>
            <B>Arbitration.</B> Any dispute between you and {LEGAL.name} that is not resolved that way is settled by binding arbitration run by the American Arbitration Association under its Consumer Arbitration Rules, before one arbitrator, in {homeState()}, or by video or in writing where the rules allow. The arbitrator decides everything, including whether a claim can be arbitrated. The award can be entered in any court with jurisdiction. The Federal Arbitration Act governs this section.
          </>,
          <>
            <B>Small claims.</B> Either side may instead bring a claim in small-claims court if it qualifies there.
          </>,
          <>
            <B>One at a time.</B> Claims are brought as an individual only. There are no class actions, class arbitrations or representative claims, and the arbitrator may not combine one person's claims with another's.
          </>,
          <>
            <B>Opting out.</B> You may opt out of arbitration by writing to <Mail /> within 30 days of first agreeing to these terms, with the email on your account and a line saying you opt out. Disputes then go to the courts named below. The one-at-a-time rule still applies as far as the law allows.
          </>,
          <>
            <B>Law and courts.</B> These terms are governed by the laws of {homeState()} and the federal law of the United States, without regard to conflict-of-law rules. Any claim that is not arbitrated is brought in the state or federal courts of {homeState()}, and both sides accept their jurisdiction, except where the law gives you the right to go elsewhere.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'changes-to-terms',
    title: 'Changes to these terms',
    plain: 'We post the new version with its date and email you about anything that matters. Using the terminal after that means you accept it.',
    body: (
      <L
        items={[
          'When we change these terms we post the new version here with a new date.',
          'For a change that matters to you, we also email the address on your account before it takes effect.',
          'Using the terminal after that date means you accept the change. If you do not, cancel your plan and stop using the terminal before then.',
        ]}
      />
    ),
  },
  {
    id: 'rest',
    title: 'The rest',
    plain: 'This is the whole agreement. If a piece of it fails, the rest stands. You cannot hand it to someone else; we can, if the company changes hands.',
    body: (
      <>
        <L
          items={[
            <>
              These terms, the <To to="/privacy">Privacy Policy</To> and any feature or purchase terms are the whole agreement between you and {LEGAL.name} about the service.
            </>,
            'If a court finds a part of them unenforceable, the rest stays in force.',
            'If we let a breach pass once, we may still act on the next one.',
            'You may not transfer this agreement to anyone. We may transfer it if the business is sold or merged.',
            'Neither side is responsible for a delay caused by something outside its reasonable control, including an exchange, data provider, network or payment outage.',
          ]}
        />
        <P>
          Questions about these terms: <Mail />.
        </P>
      </>
    ),
  },
];

const Terms = () => (
  <LegalPage
    kind="Terms"
    title="Terms of Service"
    updated={UPDATED}
    intro={
      <>
        <p>These terms cover the website and the terminal. Use either and they apply to you.</p>
        <p>Each section opens with a plain line. It says what the section means. The text under it is what governs.</p>
        <p>Before anything else: the terminal shows where dealer hedging sits and what the tape did. It is not advice. We are not a broker or an adviser. Options and futures can lose you more than you put in.</p>
      </>
    }
    sections={SECTIONS}
    sibling={{ to: '/privacy', name: 'Privacy Policy' }}
  />
);

export default Terms;
