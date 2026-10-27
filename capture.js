import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  // Tentukan path binary Chromium yang baru diinstall
  executablePath: '/usr/bin/chromium-browser', 
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage'
  ]
});

const page = await browser.newPage();
await page.goto('https://developer.hashicorp.com/terraform/language/backend/pg', {
  waitUntil: 'networkidle2'
});

try {
  const acceptBtn = await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 3000 });
  if (acceptBtn) {
    await acceptBtn.click();
    // Tunggu animasi fade-out banner cookie selesai
    await new Promise(r => setTimeout(r, 1000));
  }
} catch (e) {
  // Jika tombol tidak ada/tidak sempat muncul, sembunyikan via CSS sebagai cadangan
  await page.addStyleTag({
    content: `
      #onetrust-banner-sdk, 
      #onetrust-consent-sdk, 
      .onetrust-pc-dark-filter,
      [id*="onetrust"] { display: none !important; visibility: hidden !important; }
    `
  });
}

await page.setViewport({ width: 1080, height: 1024 });


await page.screenshot({ 
      path: 'terraform-pg.png',
      type: 'jpeg',
      quality: 70,
//	# fullPage: true
      });

console.log('Screenshot berhasil disimpan!');
await browser.close();
