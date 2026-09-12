import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = '/Users/eman/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const FILE = 'file://' + process.cwd() + '/directions.html';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const DIRECTIONS = [
  ['a', 'atelier'],
  ['b', 'indigo-vat'],
  ['c', 'fabric-fun'],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
});

async function shoot(page, { dir, screen, width, height, name, scale }) {
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.goto(FILE, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
  });

  await page.evaluate((d, s) => {
    document.getElementById('tab-' + d).click();
    document.querySelector(`.screens-row button[data-screen="${s}"]`).click();
  }, dir, screen);

  // Let the fonts settle and every lazy image decode before capturing.
  await page.evaluate(() => Promise.all(
    [...document.images].filter(i => !i.complete).map(i => i.decode().catch(() => {}))
  ));
  await new Promise(r => setTimeout(r, 700));

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(name);
}

const page = await browser.newPage();

for (const [dir, slug] of DIRECTIONS) {
  await shoot(page, { dir, screen: 'home', width: 1440, height: 1000, scale: 2, name: `${slug}-home-desktop` });
  await shoot(page, { dir, screen: 'home', width: 390,  height: 844,  scale: 3, name: `${slug}-home-phone` });
  await shoot(page, { dir, screen: 'auth', width: 1440, height: 1000, scale: 2, name: `${slug}-auth-desktop` });
}
await shoot(page, { dir: 'b', screen: 'auth', width: 390, height: 844, scale: 3, name: 'indigo-vat-auth-phone' });

await browser.close();
