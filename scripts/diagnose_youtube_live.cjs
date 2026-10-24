// Run with Orvix closed: uses the installed extension's saved pairing.
// Does not read or print the pairing secret. May open YouTube and play the requested song.
const { createYoutubeControl } = require('../electron/youtube-control.cjs');
const query = process.argv.slice(2).join(' ') || 'Ed Sheeran Shape of You official music video';
const control = createYoutubeControl();
(async () => {
  try {
    let result;
    for (let attempt = 0; attempt < 15; attempt++) {
      result = await control.execute({ action: 'search_and_play', query });
      if (result.status !== 'unavailable' || !/command channel is disconnected/.test(result.message || '')) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log('[Orvix YouTube] LIVE DIAGNOSIS', JSON.stringify(result));
    if (result.status !== 'ok' && result.status !== 'needs_selection') process.exitCode = 1;
  } finally { control.close(); }
})().catch(error => { console.error(error.message); control.close(); process.exitCode = 1; });
