# FF-Test

An attack lab for [FastFlare](https://github.com/ArthWarrior3201/FastFlare)'s CAPTCHA.

1. **100 sloppy bots** fire at random: no proof-of-work, forged challenges, headless browsers, a filled honeypot, scripted mouse paths, invented time-on-page, replayed challenges.
2. **A patient human-like bot** then does everything a visitor's browser does (solves the proof-of-work, waits, reports believable signals and a synthesised curved mouse path) and attempts the puzzle if it is given one, guessing because it cannot see the picture.


The attack page shows live counters, a dot per request, the proof-of-work difficulty the bot had to pay, a log, and a verdict. The real FastFlare widget is on the page too.

## Use it

Open the site (GitHub Pages: Settings → Pages → Deploy from branch → `main` / root), enter your FastFlare server address and press **Attack**.

- The page is HTTPS, so your FastFlare server must be HTTPS too. On your server run `deploy/enable-https.sh` from the FastFlare repo; it gives you `https://<ip-with-dashes>.sslip.io`.
- The default site key is `ff_site_main`. Change it in the Site key field if your server's `config/sites.json` uses another name (`ff_demo_site` works only on a server with no `config/sites.json`).
- Only test servers you own.

Command line, no browser:

```sh
node scripts/simulate.mjs https://your-fastflare-host ff_site_main 100 15 burst
```
