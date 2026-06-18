<p align="center">
  <img src="docs/banner.svg" alt="Scratch Pad — share your files, between your devices, with your friends. Fast. Easy. Private. Free." width="100%">
</p>

<h1 align="center">Scratch Pad</h1>

<p align="center">
  <strong>Share your files, between your devices, with your friends.</strong><br>
  Fast. Easy. Private. Free. No ads, no tracking, no data mining. Set it up once and go.
</p>

<p align="center">
  <a href="https://scratch-ellovee-s-projects.vercel.app"><img src="https://img.shields.io/badge/open_the_app-live-a8442e?style=flat-square" alt="Open the live app"></a>
  <img src="https://img.shields.io/badge/installable-PWA-6e4c2c?style=flat-square" alt="Installable PWA">
  <img src="https://img.shields.io/badge/license-MIT-1c1b1a?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/built_with-Next.js-1c1b1a?style=flat-square" alt="Built with Next.js">
</p>

---

## The problem

You snap a photo on your phone and need it on your laptop. Or you want to hand a note — a video, a file — to a friend standing right next to you. Today that means emailing it to yourself, signing into somebody's cloud, hunting for a cable, or installing one more app that wants your contacts.

It should be as easy as **writing it on a card and sliding it across the desk.**

## What it is

**Scratch Pad is a shared paper desk that lives on all your devices at once.** One big index card and three small ones. Drop in text, photos, videos, files, or links — and a second or two later it's on your other device too. Want to give a card to someone who doesn't have the app? Show them a **QR code** — they open it in any browser. No account, no install, nothing to sign.

Everything saves the moment you write it, right on the device, and mirrors to the rest. It looks like a 1950s library card catalog and works like a quiet little magic trick.

## What it does

- 🔄 **Cross-device sync** — write on your phone, see it on your laptop in about two seconds. And the reverse.
- 🖊️ **Just write** — every card is editable; tap **Save** to commit. Whatever you save last wins, cleanly.
- 📎 **Anything fits** — text, images, video (plays inline), files, and web/video links (YouTube & Vimeo embed).
- 🎤 **Dictate** — talk, and it types.
- ▦ **QR share** — hand any card to anyone with a scannable code; they get a clean, read-only page. No login.
- 📱 **It's an app** — add it to your home screen and it runs full-screen with its own icon.
- ⚡ **Local-first** — instant, works offline, catches up when you're back.

## Use it in 30 seconds

1. Open **[the app](https://scratch-ellovee-s-projects.vercel.app)** on your phone *and* your laptop.
2. Tap **connect**, enter your email, and type the code it sends. (Once per device — you stay signed in.)
3. Write something, drop in a photo, hit **save**. Watch it land on the other screen.
4. Use your browser's **Add to Home Screen** to turn it into a real app.

That's the whole setup. No accounts to manage, no settings to wrangle.

## Privacy, honestly

- **No ads. No trackers. No analytics. No data mining.** Nobody is watching you here.
- Your board is **local-first** — it lives on your device and loads instantly, even offline.
- To move things between your devices it uses a **minimal free backend** (Supabase), where your board is locked to your account. It's a quiet pipe between your own devices — not a profile to be sold.
- Shared cards live at an **unguessable private link** that only works if you choose to hand it out.

(So: not "no servers ever" — but no surveillance, no ads, and nothing about you for sale. That's the honest version.)

## Support the project

Scratch Pad is **free, and always will be** — no subscriptions, no upsells, no asterisks. It's built and looked after by one person. If it saved you a headache and you'd like to chip in, it genuinely helps — and is deeply appreciated:

- ☕ **Buy Me a Coffee** — [buymeacoffee.com/aSchellCompany](https://buymeacoffee.com/aSchellCompany)
- 💵 **Cash App** — `$Aircityryan`

No pressure, ever. Using it and telling a friend is support too. 🤎

## Under the hood

- **Next.js** (App Router) · **React** · **TypeScript** · **Tailwind CSS**
- **Supabase** (free tier) for sign-in, cross-device sync, and media storage
- Installable **PWA**, deployed on **Vercel**
- Local media copies in **IndexedDB**; QR codes generated on-device

## License

[MIT](LICENSE) — do what you like with it.

---

<p align="center"><em>Built with care — and a lot of joy — by Ryan, in partnership with Claude.</em></p>
