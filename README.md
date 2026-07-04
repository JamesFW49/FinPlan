# FinPlan — Your Personal Financial Planner

A complete money tracker, debt tracker, investment tracker, and forecasting
dashboard that installs straight to your phone's home screen like a normal
app. No app store, no account, no subscription — just open it and add it
to your home screen.

## Install on iPhone (Safari)

1. Open the site link on your iPhone in **Safari** (it must be Safari, not Chrome, for the install option to appear).
2. Tap the **Share** icon (square with an arrow pointing up) in the bottom toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top right.
5. FinPlan now sits on your home screen with its own icon and opens full-screen, no browser bars.

## Install on Android (Chrome)

1. Open the site link on your Android phone in **Chrome**.
2. Tap the **⋮** menu (top right).
3. Tap **Add to Home screen** (or **Install app** — Chrome sometimes prompts this automatically with a banner).
4. Confirm by tapping **Add** / **Install**.
5. FinPlan appears on your home screen and app drawer like any other app.

## How your data is stored

Everything you enter is saved directly on your phone using the browser's
local storage — nothing is uploaded anywhere, there's no server, and no one
but you can see your numbers. This means:

- Your data persists between sessions automatically — close the app, reopen it days later, everything's still there.
- If you clear your phone's browser data/cache, or uninstall and reinstall, your data will be wiped. Use **Settings → Export backup** regularly to download a JSON file as a safety copy, and **Import backup** to restore it.
- Data does not sync between devices on its own. To move from phone to laptop, export on one and import on the other.

## What's inside

- **Dashboard** — net worth, cash, investments, and debt at a glance, plus a 36-month net worth forecast and supporting charts for spending mix and monthly cash flow.
- **Transactions** — log income and expenses with categories and recurrence (monthly, weekly, annual, one-off).
- **Debt** — track every debt's balance, APR, and payment; see total interest cost and payoff ETA per debt, plus a 60-month payoff projection.
- **Investments** — track holdings by type (stocks, ISA, pension, crypto, property, etc.) with a 10-year compounding forecast per holding.
- **Settings** — update your cash balance, see your monthly cash flow summary, export/import backups, reset to start fresh.

## Hosting this yourself

This is a static site — four files (`index.html`, `app.js`, `manifest.json`,
`sw.js`) plus two icons. To make the "Add to Home Screen" install option
appear, the files need to be served over **https** — phones won't offer to
install a PWA served over plain `http`.

Simplest free options:
- **Netlify Drop** (app.netlify.com/drop) — drag the unzipped folder onto the page, get an instant `https://` URL. No account needed for a one-off deploy; an account lets you redeploy to the same URL later.
- **GitHub Pages** — push these files to a repo, enable Pages in settings, get a free `https://yourname.github.io/...` URL.
- **Vercel / Cloudflare Pages** — similar drag-and-drop or git-based deploys.

Once it's live at an `https://` address, open that address on your phone
and follow the install steps above.

## Editing entries

Every income, expense, debt, and investment row now has a pencil icon next
to the delete icon \u2014 tap it to edit that entry in place rather than deleting
and re-adding it.

## Monthly tracking

The Dashboard now shows a live "This Month" panel comparing what you've
logged so far against your monthly plan, with a simple pace indicator. When
you open the app in a new calendar month, it automatically asks how much
cash you actually saved last month \u2014 that figure updates your cash balance
and gets logged to a permanent monthly history, shown as a chart on the
Dashboard. You can skip the prompt and it'll ask again next time you open
the app.

At the same time, every investment holding and debt also moves forward by
one real month: investments grow by their stated return and add their
monthly contribution, debts have interest added and a payment deducted \u2014
the same maths the forecast charts already use, just applied for real
rather than projected. If you don't open the app for a few months, it
correctly advances by however many months actually passed, not just one.

## Clickable Dashboard cards

The Investments, Total Debt, and Monthly Surplus cards on the Dashboard
are now tappable \u2014 tap any of them to jump straight to that page, while
the tabs at the top stay in place so you can navigate normally from there.

## Per-debt breakdown chart

The Debt page now shows two charts: the combined total-debt payoff
projection (as before), and a new chart breaking down each individual
debt's payoff trajectory as its own colour-coded line, with a legend \u2014
the same style as the Investments page already uses for individual
holdings.

## Interactive projection cards on Future and Debt

On the Future page, both "Projected in Xyr" cards are tappable, each opening
the same year picker used on Investments \u2014 pick any year independently for
each card, and the milestones table and charts extend to cover whichever
year you choose.

On the Debt page, the "Debt-Free ETA" card is tappable too. By default it
shows the automatically calculated payoff date. Tap it to instead pick a
specific year and see your remaining total debt balance at that point \u2014
useful if a debt won't be paid off within the normal forecast window. The
picker includes a "Back to automatic Debt-Free ETA" option to switch back.

## Adjustable projection horizon on Investments

The "10-yr Projection" card on the Investments page is now tappable \u2014 tap
it to open a picker with quick presets (5, 10, 15, 20, 25, 30 years) or
enter any custom number of years from 1 to 50. The chosen horizon applies
everywhere on the page: the projection figure, the chart, and the
projection column in the holdings table.

## Future tab — long-term projections

A new "Future" tab gives a dedicated view of where your finances are headed
over the long run: a 30-year net worth chart, a milestones table at 1, 2,
3, 5, 10, 15, 20, 25, and 30 years showing net worth, cash, investments,
and debt at each point, plus separate growth/payoff charts for investments,
debt, and cash individually. It uses the same forecast engine as the
Dashboard, assuming your current income, expenses, contributions, and
rates stay constant \u2014 a directional guide rather than a guarantee.

## Recurring entries carry forward automatically

A recurring monthly entry (Rent, Salary, subscriptions, anything marked
"Monthly") now counts toward every month's "This Month" totals from its
start date onward \u2014 not just the one date it was originally entered on.
You don't need to re-add or re-date anything each month; one-off entries
still only count toward the specific month you dated them.

## This Month, simplified

The Dashboard's "This Month" panel shows exactly what's been logged in
Transactions so far this month \u2014 income in, expenses out, and the net of
the two \u2014 plus a simple breakdown of spending by category. It deliberately
doesn't try to project or predict how the month will finish, since that
previously produced misleading "over budget" warnings that ignored your
actual monthly surplus. The real answer for how a month went comes from
the automatic monthly close-out prompt, where you tell the app directly
how much you saved \u2014 that's what updates your cash balance and gets
logged to history.

## Quick cash updates

Your cash balance is shown in two places \u2014 the top bar on every page, and
the Cash card on the Dashboard. Both are directly editable: tap the figure,
type the new amount, and tap away or press Enter to save. Handy for
keeping it current between monthly close-outs, e.g. right after checking
your bank balance.

## Device sync

In Settings, you can connect multiple devices (phone, iPad, computer) to the
same shared data using a sync code. Enter the same code on each device and
they'll update automatically within a couple of seconds of any change,
powered by a small free Firebase project behind the scenes. Your data
otherwise lives only on your own device — the sync feature is opt-in.

## App lock

In Settings, you can set a PIN to lock the app, and optionally register
Face ID or Touch ID (on supported devices/browsers) for one-tap unlock.
The lock is a local gatekeeper against casual access if someone picks up
your unlocked device — it is not encryption, and does not protect the data
itself if someone has direct access to the device's storage.

## Updating after a change

The service worker checks the network first for the page and app code, so
an update should reach your phone the next time you open the app with a
signal. If it ever seems stuck on an old version: on iPhone, go to
Settings → Safari → Advanced → Website Data, find the site, remove it,
then reopen and re-add to your home screen.

## Technical notes

- Built with React 18, loaded from a CDN at an exact pinned version (18.3.1). The script URL is constructed in JavaScript at runtime rather than written as a static HTML attribute, because the literal "react@18.3.1" text was being silently rewritten by automated processing somewhere in the hosting pipeline (anything that pattern-matches "name@version" as if it were an email address and obfuscates it). Building the URL at runtime avoids that entirely.
- The app itself (`app.js`) is plain JavaScript — no JSX, no Babel, no build step or in-browser compilation of any kind. This was a deliberate choice after an earlier version relied on in-browser JSX transformation, which proved unreliable.
- A service worker caches static assets after first load and checks the network first for the page and app code, so updates reach you without needing to clear data manually in most cases.
- All forecasts (net worth, debt payoff, investment growth) recalculate live from whatever you enter — there's no hidden data. Charts are rendered as plain SVG with no external charting library.
- If the app ever fails to load, you'll see an on-screen error message rather than a blank page, so the cause is visible rather than silent.
