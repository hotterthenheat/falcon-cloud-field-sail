# Putting the terminal on the internet

*Written 2026-10-11 for Noah. One idea at a time. The site goes on Vercel; the accounts, the plans and the three
server functions stay in Supabase; the money stays in Stripe. Nothing secret ever goes into the site's build.*

## The four places, and what each one holds

| Place | What lives there | Who sets it up |
|---|---|---|
| **Vercel** | The site itself: the built files, served from a network of edge servers near each visitor. It also builds the site from GitHub every time the `v1` branch changes. | Noah, in the Vercel dashboard (this walk) |
| **Supabase** | The accounts, the profiles with their plans, the carried stores, the audit log, and the four Edge Functions (checkout, portal, webhook, account-delete). The Stripe secret key and the webhook signing secret live here, as the functions' secrets. | Already running on project `ncsigrsvvoroiplnjtam` |
| **Stripe** | Products and prices, customers, subscriptions, invoices. Test mode today, live mode at launch. | Already running; live mode is a launch step below |
| **Plausible** | The visit count, if we want one. Off until the build names the site. | Optional, at launch |

The build reads three publishable values and nothing else: the Supabase URL, the Supabase publishable key, and the
Stripe publishable key. All three are made to be seen by a browser. The service-role key, the Stripe secret key and
the webhook secret are not in the build, not in the repo, not in Vercel. They stay in Supabase's function secrets.

## The first deploy, step by step

1. **Connect GitHub to Vercel.** In Vercel: Add New → Project → Import Git Repository → install Vercel's GitHub app
   on the `Nuh00` account and pick `revamp`. Vercel reads the repo; it sees Vite and fills in the build on its own
   (`npm run build`, output `dist`). The repo's `vercel.json` adds the two things Vite does not say: every address
   opens the app (a deep link like `/settings/billing` must load `index.html`, not a 404), and the hashed files under
   `/assets` and the font are cached for a year.
2. **Set the production branch to `v1`.** Settings → Git → Production Branch. Every push to `v1` is a release from
   then on; every other branch and pull request gets its own private preview address.
3. **Add the three variables.** Settings → Environment Variables. Names and values from `.env.local`:

   | Name | Production | Preview and Development |
   |---|---|---|
   | `VITE_SUPABASE_URL` | the project URL | the same |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key | the same |
   | `VITE_STRIPE_PUBLISHABLE_KEY` | the **live** publishable key, once Stripe is live | the **test** publishable key |
   | `VITE_PLAUSIBLE_DOMAIN` | `slayerterminal.com`, when the count is wanted | leave empty |
   | `UNUSUAL_WHALES_API_KEY` | the Unusual Whales token | the same |

   `UNUSUAL_WHALES_API_KEY` is the one secret that does live on Vercel, and only because the site's `/api/uw` function
   reads it there. It must not start with `VITE_` — a `VITE_` name is copied into the browser. The function adds the
   token; the pages call `/api/uw` and never see it.
   A value that starts `sb_secret_`, `sk_`, or `whsec_` never goes here. If one is ever typed here by mistake, roll
   it in its own dashboard the same day.
4. **Deploy.** The first build takes a few minutes. The site is up at an address ending in `.vercel.app`. Open it, sign
   in, buy Book with the test card, open a walled room. Everything the dev server does, this does, from the edge.
5. **The domain.** Vercel → Settings → Domains → add `slayerterminal.com` and `www.slayerterminal.com`. If the name
   is bought through Vercel, the records are written for you; if it is bought elsewhere, Vercel shows the two DNS
   records to set at the registrar (an `A` record for the bare name, a `CNAME` for `www`). The certificate is
   issued on its own within minutes. Pick one of the two as the main address and let the other forward to it.

## Once the domain answers, in this order

Each of these is a setting that names the domain. None can be done before it exists.

1. **Supabase → Authentication → URL Configuration.** Site URL = `https://slayerterminal.com`. Redirect URLs: add
   `https://slayerterminal.com/**` and `https://www.slayerterminal.com/**`, and keep `http://localhost:5199/**` and
   `http://localhost:5173/**` for development. Without this the confirmation and reset mails still point at localhost.
2. **Google Cloud → the OAuth client.** Authorized JavaScript origins: add `https://slayerterminal.com`. The redirect
   stays Supabase's callback, unchanged. Then publish the app (Audience → Publishing status) so people outside the
   test-user list can sign in.
3. **Stripe → Settings → Payment methods → Payment method domains.** Register `slayerterminal.com` in the sandbox
   and again in live mode. This is what makes Google Pay and Apple Pay appear on the checkout page; on localhost they
   never will. Apple Pay also wants a file served from the site at
   `/.well-known/apple-developer-merchantid-domain-association` — Stripe hands it over on that page; it goes in the
   repo under `public/.well-known/` and ships with the next push.
4. **Stripe live mode.** Three parts, all in dashboards, none in the repo:
   - Products and prices in live mode with the same lookup keys (`book_month`, `book_year`, `tape_month`, `tape_year`,
     `desk_month`, `desk_year`) and the same tax code. The checkout function finds prices by lookup key, so nothing in
     the code changes.
   - A live webhook endpoint pointing at the same function address
     (`https://ncsigrsvvoroiplnjtam.supabase.co/functions/v1/stripe-webhook`) with the same events as the test one.
   - In Supabase → Edge Functions → Secrets: `STRIPE_SECRET_KEY` becomes the live secret key and
     `STRIPE_WEBHOOK_SECRET` the live endpoint's signing secret. In Vercel, the Production value of
     `VITE_STRIPE_PUBLISHABLE_KEY` becomes the live publishable key. Redeploy. Preview keeps the test keys, so a
     preview address never charges a real card.
5. **Mail from the domain.** Supabase's built-in sender is for development: a handful of mails an hour, from a
   Supabase address. Before anyone real signs up: Supabase → Authentication → SMTP Settings → a sender such as Resend or
   Postmark with `hello@slayerterminal.com`, and the sender's two or three DNS records at the registrar. The mail
   templates then carry our name.
6. **The visit count.** If wanted: a Plausible site for `slayerterminal.com`, then the `VITE_PLAUSIBLE_DOMAIN`
   variable in Vercel for Production only, then redeploy. The privacy page reads the same switch and says Plausible
   is running; with the variable empty it says there is no analytics service, which is also true.
7. **Two lines in the repo** to confirm before the first real visitor: the link-preview address in `index.html`
   (`og:url` and the `og:image` address) and the contact address in the legal pages, both written as
   `slayerterminal.com` on faith — change them if the domain is another.

## Google Pay and Apple Pay before launch, without touching the pre-launch page

Today `slayerterminal.com` is a one-file "coming soon" page on Netlify. It can stay exactly as it is. The wallets
need three things, and none of them is the apex domain: a page served over HTTPS, that page's address registered
in Stripe's payment method domains, and for Apple Pay a file served from that same address. So the test runs on an
address of its own:

1. Create the Vercel project from the repo (the first deploy above). Vercel gives it an address like
   `revamp-xxxx.vercel.app`. That address is public but unlinked, and the terminal is walled signed out.
2. Stripe → Settings → Payment methods → Payment method domains → add that exact address, in the sandbox. Stripe
   hands over the Apple file; it goes in the repo under `public/.well-known/` and ships with the next push. Register
   again once the file is live and Stripe can fetch it.
3. Open the checkout on that address. Google Pay shows in Chrome when a card is saved in Google Pay; Apple Pay shows
   in Safari on a Mac or iPhone with a card in Wallet. Test mode charges nothing.

At launch the apex moves from Netlify to Vercel (the two DNS records in step 5 of the first deploy), and the real
domain is registered in Stripe the same way, in sandbox and in live. If the vercel.app address being public at all
is unwelcome, the alternative is a subdomain such as `app.slayerterminal.com` pointed at Vercel with Vercel's
password protection on, which is a paid feature; or the wallets wait for launch day, since cards already work.

## Things to know

- **A push to `v1` is a release.** Your partner has push access. Either agree that `v1` is only pushed when the site
  should change, or move releases to a branch only you push to and set that as the production branch.
- **Preview addresses are private by default.** Vercel asks for a Vercel sign-in before showing a preview deployment,
  so a half-finished branch is never public. Production is public.
- **The sample journal is off on a built site.** The two sample paper accounts show only on a development server
  (`SAMPLE_JOURNAL` reads the build mode), so nobody's journal ships with trades they did not make. Films and stills
  are still shot against the dev server, where the sample stays.
- **The local map tiles never ship.** `public/tiles/nyc.pmtiles` (128 MB) is git-ignored and is referenced by nothing
  in the app any more; Vercel builds from git and never sees it. Nothing to do.
- **The content security policy is in report-only mode.** `vercel.json` sends a `Content-Security-Policy-Report-Only`
  header naming every outside address the site may talk to: Supabase, Stripe's script and frames, Plausible, Google's
  picture host for avatars, and nothing else. In report-only mode the browser allows everything and only writes a
  complaint to its console when something falls outside the list. After a week live with no complaints, rename the
  header to `Content-Security-Policy` and the same list becomes a wall: a script injected anywhere then does nothing.
  If a complaint names something real (a new Stripe address, say), add it to the list first.
- **What is not here yet, on purpose:** the Apple sign-in; the Terms' unnamed state.
